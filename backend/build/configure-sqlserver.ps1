# Configures a LOCAL SQL Server instance so Wentox can actually connect to it, covering every
# manual step that otherwise has to be done by hand in SSMS + SQL Server Configuration Manager:
#   - LoginMode = 2 (mixed SQL + Windows auth; SQL Server is Windows-auth-only by default, so the
#     app's sa/password login is rejected outright until this changes)
#   - TCP/IP protocol enabled, and IPAll pinned to a static port 1433 with dynamic ports cleared
#     (SQL Server Express in particular installs on a dynamic port, so localhost:1433 refuses)
#   - sa login ENABLED (disabled by default even once mixed mode is on) with its password set to
#     the one the installer collected
# Run elevated. Idempotent — safe to re-run, and safe against an instance that's already correct.
#
# The sa work is done over Windows Integrated auth, which always succeeds for a local
# administrator regardless of how sa/mixed-mode is currently configured — that's what makes this
# able to repair an instance whose sa is disabled or has an unknown password.
#
# Everything is logged to $LogPath and every failure path writes the real error there, because
# this normally runs silently from the installer where an exit code alone says nothing.
[CmdletBinding()]
param(
  # Path to a file holding the sa password. Passed as a file rather than an argument so the
  # password never appears in the process command line, and so NSIS doesn't have to escape quotes
  # into a command string. The installer writes it into $PLUGINSDIR, which it wipes on exit.
  [Parameter(Mandatory = $true)][string]$PasswordFile,
  [string]$LogPath = "$env:ProgramData\Wentox\sqlserver-setup.log"
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
function Write-Log {
  param([string]$Message)
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line
}

# Always read/write the 64-bit registry view explicitly, rather than relying on this process's own
# bitness. NSIS is a 32-bit process, so the powershell.exe it launches is WOW64-redirected to the
# 32-bit one, which sees the WOW6432Node view — where SQL Server is NOT registered, since it
# registers in the 64-bit hive. Going through OpenBaseKey(..., Registry64) makes this correct no
# matter which PowerShell ends up running it.
function Open-HklmKey64 {
  param([string]$Path, [bool]$Writable = $false)
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::LocalMachine,
    [Microsoft.Win32.RegistryView]::Registry64)
  return $base.OpenSubKey($Path, $Writable)
}

try {
  $bits = [IntPtr]::Size * 8
  Write-Log "=== Wentox SQL Server configuration started (PowerShell $($PSVersionTable.PSVersion), $bits-bit process) ==="

  if (-not (Test-Path -LiteralPath $PasswordFile)) { throw "Password file not found: $PasswordFile" }
  # NSIS's FileWrite emits ANSI (FileWriteUTF16LE exists separately for UTF-16), so read it back
  # the same way rather than letting .NET guess an encoding.
  $saPassword = [IO.File]::ReadAllText($PasswordFile, [Text.Encoding]::Default).TrimEnd("`r", "`n")
  if ([string]::IsNullOrEmpty($saPassword)) { throw 'Password file was empty.' }

  # --- Locate the instance ---
  $instancesPath = 'SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
  $instKey = Open-HklmKey64 $instancesPath
  if (-not $instKey) { throw "No SQL Server instance is registered (missing HKLM\$instancesPath in the 64-bit registry view)." }

  $names = $instKey.GetValueNames()
  if (-not $names -or $names.Count -eq 0) { throw 'No SQL Server instance is registered on this machine.' }
  Write-Log ("found instances: {0}" -f ($names -join ', '))

  # Prefer the default instance (MSSQLSERVER) — it's what listens on 1433 with no extra config and
  # what the app defaults to; otherwise take whatever single instance exists.
  $instanceName = if ($names -contains 'MSSQLSERVER') { 'MSSQLSERVER' } else { $names[0] }
  $regId = $instKey.GetValue($instanceName)   # e.g. MSSQL16.MSSQLSERVER
  $isDefault = $instanceName -eq 'MSSQLSERVER'
  $serviceName = if ($isDefault) { 'MSSQLSERVER' } else { "MSSQL`$$instanceName" }
  $serverName = if ($isDefault) { '(local)' } else { "(local)\$instanceName" }
  Write-Log "configuring instance '$instanceName' (regId=$regId, service=$serviceName)"

  # --- Mixed-mode authentication ---
  $mssqlPath = "SOFTWARE\Microsoft\Microsoft SQL Server\$regId\MSSQLServer"
  $mssqlKey = Open-HklmKey64 $mssqlPath $true
  if (-not $mssqlKey) { throw "Expected registry key not found: HKLM\$mssqlPath" }
  $mssqlKey.SetValue('LoginMode', 2, [Microsoft.Win32.RegistryValueKind]::DWord)
  Write-Log '  mixed-mode authentication enabled (LoginMode=2)'

  # --- TCP/IP on a static port 1433 ---
  $tcpKey = Open-HklmKey64 "$mssqlPath\SuperSocketNetLib\Tcp" $true
  if ($tcpKey) {
    $tcpKey.SetValue('Enabled', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
    $ipAllKey = Open-HklmKey64 "$mssqlPath\SuperSocketNetLib\Tcp\IPAll" $true
    if ($ipAllKey) {
      # Dynamic ports must be cleared, not just overridden — a non-empty TcpDynamicPorts wins over
      # TcpPort, which is exactly why a default Express install ignores 1433.
      $ipAllKey.SetValue('TcpDynamicPorts', '', [Microsoft.Win32.RegistryValueKind]::String)
      $ipAllKey.SetValue('TcpPort', '1433', [Microsoft.Win32.RegistryValueKind]::String)
    }
    Write-Log '  TCP/IP enabled on static port 1433'
  } else {
    Write-Log "  WARNING: TCP registry key not found under $mssqlPath - skipping protocol config"
  }

  # --- Restart so LoginMode/TCP actually take effect ---
  Write-Log "  restarting service $serviceName ..."
  Restart-Service -Name $serviceName -Force
  # Restart-Service returns once the service reports Running, but the engine needs a moment more
  # before it accepts logins.
  Start-Sleep -Seconds 5
  Write-Log '  service restarted'

  # --- Enable sa and set its password ---
  # ALTER LOGIN takes no parameters for the password, so it has to be a literal; double up single
  # quotes so a password containing one can't terminate the string.
  $escaped = $saPassword.Replace("'", "''")
  $connStr = "Server=$serverName;Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=30"
  Write-Log "  connecting as current Windows user to $serverName ..."

  $conn = New-Object System.Data.SqlClient.SqlConnection $connStr
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    # CHECK_POLICY OFF so a simple shop-PC password isn't rejected by the machine's Windows
    # password policy, which would otherwise fail the whole install for a non-obvious reason.
    $cmd.CommandText = "ALTER LOGIN [sa] ENABLE; ALTER LOGIN [sa] WITH PASSWORD = N'$escaped', CHECK_POLICY = OFF;"
    $cmd.ExecuteNonQuery() | Out-Null
    Write-Log '  sa login enabled and password set'
  } finally {
    $conn.Dispose()
  }

  Write-Log '=== SQL Server configured successfully ==='
  exit 0
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  if ($_.Exception.InnerException) { Write-Log "INNER: $($_.Exception.InnerException.Message)" }
  Write-Log "AT: $($_.ScriptStackTrace)"
  Write-Log '=== SQL Server configuration FAILED ==='
  exit 1
}

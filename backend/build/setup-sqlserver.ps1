# One script that takes a Windows PC from "no database at all" to "Wentox can log in", so the
# installer only ever has to ask for a single password. Every step is idempotent and logged, and
# the whole thing ends with a real connection test rather than assuming success.
#
#   1. Find an existing SQL Server instance (64-bit registry view).
#   2. If there is none, install SQL Server Express from the bundled package.
#   3. Force the settings Wentox needs: mixed-mode auth, TCP/IP on a static port 1433.
#   4. Enable the sa login and set its password to the one given.
#   5. Create the application database if missing.
#   6. Verify by actually connecting as sa over TCP and running a query.
#
# Steps 3-4 are done over Windows Integrated auth, which always works for a local administrator no
# matter how sa/mixed-mode is currently configured — that's what lets this repair an existing
# instance whose sa is disabled or has a forgotten password, so one password always ends up valid.
[CmdletBinding()]
param(
  # File holding the sa password, rather than an argument, so it never appears in the process
  # command line and NSIS doesn't have to escape quotes into a command string.
  [Parameter(Mandatory = $true)][string]$PasswordFile,
  # Bundled SQLEXPR_x64_ENU.exe. Optional: if absent, an existing SQL Server is still configured.
  [string]$InstallerPath,
  [string]$DatabaseName = 'Wentox_db',
  [string]$LogPath = "$env:ProgramData\Wentox\sqlserver-setup.log",
  # Where the live backup database's files go, and where the app reads its settings from. This
  # script writes app-config.json itself rather than letting NSIS do it: it already holds the
  # exact password it is about to verify, and ConvertTo-Json escapes backslashes/quotes correctly,
  # whereas hand-rolled escaping in NSIS silently produced a config whose password did not match
  # the one actually set on sa — the script reported success and the app still got ELOGIN.
  [string]$BackupFolder = "$env:USERPROFILE\Documents\Wentox Backup",
  [string]$ConfigPath = "$env:APPDATA\Wentox\app-config.json"
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
function Write-Log {
  param([string]$Message)
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogPath -Value $line
}

# Always read/write the 64-bit registry view explicitly rather than relying on this process's
# bitness: SQL Server registers in the 64-bit hive, and a 32-bit PowerShell would see the
# WOW6432Node view where nothing is registered at all.
function Open-HklmKey64 {
  param([string]$Path, [bool]$Writable = $false)
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::LocalMachine,
    [Microsoft.Win32.RegistryView]::Registry64)
  return $base.OpenSubKey($Path, $Writable)
}

$INSTANCES_PATH = 'SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'

function Get-SqlInstance {
  $key = Open-HklmKey64 $INSTANCES_PATH
  if (-not $key) { return $null }
  $names = $key.GetValueNames()
  if (-not $names -or $names.Count -eq 0) { return $null }

  # Prefer the default instance — it's the one that listens on 1433 with no extra configuration.
  $name = if ($names -contains 'MSSQLSERVER') { 'MSSQLSERVER' } else { $names[0] }
  $isDefault = $name -eq 'MSSQLSERVER'
  [pscustomobject]@{
    Name    = $name
    RegId   = $key.GetValue($name)                                             # MSSQL16.MSSQLSERVER
    Service = if ($isDefault) { 'MSSQLSERVER' } else { "MSSQL`$$name" }
    Server  = if ($isDefault) { '(local)' } else { "(local)\$name" }
  }
}

try {
  $bits = [IntPtr]::Size * 8
  Write-Log "=== Wentox SQL Server setup started (PowerShell $($PSVersionTable.PSVersion), $bits-bit) ==="

  if (-not (Test-Path -LiteralPath $PasswordFile)) { throw "Password file not found: $PasswordFile" }
  # NSIS's FileWrite emits ANSI (FileWriteUTF16LE exists separately for UTF-16), so read it back
  # the same way rather than letting .NET guess an encoding.
  $saPassword = [IO.File]::ReadAllText($PasswordFile, [Text.Encoding]::Default).TrimEnd("`r", "`n")
  if ([string]::IsNullOrEmpty($saPassword)) { throw 'Password file was empty.' }
  # The password is embedded in setup.exe's command line below, which has no way to escape a
  # double quote — reject it clearly here rather than let setup fail with an opaque code.
  if ($saPassword.Contains('"')) { throw 'Password cannot contain a double-quote character.' }

  # Written up-front, before any install work, so that even if SQL Server setup fails the app still
  # has a valid config — the user can fix SQL Server by hand afterwards and Wentox will just work,
  # rather than also needing the config repaired. ConvertTo-Json handles all escaping, so a
  # backslash-laden Windows path and any password character survive intact.
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
  New-Item -ItemType Directory -Force -Path $BackupFolder | Out-Null
  $config = [ordered]@{
    dbServer       = 'localhost'
    dbPort         = '1433'
    dbName         = $DatabaseName
    dbUser         = 'sa'
    dbPassword     = $saPassword
    backupDbFolder = $BackupFolder
  }
  # UTF-8 without a BOM — Node's JSON.parse chokes on a leading BOM.
  [IO.File]::WriteAllText($ConfigPath, ($config | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Write-Log "wrote $ConfigPath (password length $($saPassword.Length), backup folder '$BackupFolder')"

  # ---------------------------------------------------------------------------------------------
  # 1/2. Install SQL Server Express if there is no instance at all
  # ---------------------------------------------------------------------------------------------
  $inst = Get-SqlInstance
  if ($inst) {
    Write-Log "existing instance found: $($inst.Name) - skipping installation"
  } else {
    Write-Log 'no SQL Server instance found on this machine'
    if (-not $InstallerPath -or -not (Test-Path -LiteralPath $InstallerPath)) {
      throw "No SQL Server installed, and the bundled installer was not found at: $InstallerPath"
    }

    # SQLEXPR_x64_ENU.exe is a SELF-EXTRACTING ARCHIVE, not setup itself. Setup parameters cannot
    # be passed to it directly — doing so fails with an opaque code (0x84C4000B). It must be
    # extracted with /x: first, then the extracted setup.exe run with the real parameters.
    # Extracted to a short root path deliberately: long paths are a known cause of setup failures.
    $extractDir = Join-Path $env:SystemDrive 'WentoxSQLTmp'
    if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Log "extracting installer to $extractDir ..."
    $p = Start-Process -FilePath $InstallerPath -ArgumentList "/q", "/x:`"$extractDir`"" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Extracting SQL Server Express failed (exit code $($p.ExitCode))." }

    $setupExe = Join-Path $extractDir 'setup.exe'
    if (-not (Test-Path -LiteralPath $setupExe)) { throw "Extraction produced no setup.exe at $setupExe" }
    Write-Log 'extraction complete, running setup...'

    # Resolve the Administrators group by its well-known SID rather than hardcoding the English
    # "BUILTIN\Administrators", which setup rejects on a localised Windows.
    $admins = (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate(
      [System.Security.Principal.NTAccount]).Value
    Write-Log "  sysadmin group resolves to: $admins"

    $setupArgs = '/Q /ACTION=Install /IACCEPTSQLSERVERLICENSETERMS /FEATURES=SQLEngine ' +
                 '/INSTANCENAME=MSSQLSERVER /SECURITYMODE=SQL /SAPWD="{0}" ' +
                 '/SQLSYSADMINACCOUNTS="{1}" /ADDCURRENTUSERASSQLADMIN ' +
                 '/TCPENABLED=1 /UPDATEENABLED=0 /SQLSVCSTARTUPTYPE=Automatic'
    $setupArgs = $setupArgs -f $saPassword, $admins

    Write-Log '  running SQL Server setup (this takes several minutes)...'
    $p = Start-Process -FilePath $setupExe -ArgumentList $setupArgs -Wait -PassThru
    Write-Log "  setup exit code: $($p.ExitCode)"
    # 3010 = success, reboot required. Treat as success; the service still starts.
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
      throw "SQL Server Express setup failed with exit code $($p.ExitCode). See the SQL Server setup logs under 'C:\Program Files\Microsoft SQL Server\*\Setup Bootstrap\Log\Summary.txt'."
    }

    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    $inst = Get-SqlInstance
    if (-not $inst) { throw 'SQL Server setup reported success but no instance is registered.' }
    Write-Log "  installed instance: $($inst.Name)"
  }

  # ---------------------------------------------------------------------------------------------
  # 3. Mixed-mode auth + TCP/IP on a static 1433
  # ---------------------------------------------------------------------------------------------
  $mssqlPath = "SOFTWARE\Microsoft\Microsoft SQL Server\$($inst.RegId)\MSSQLServer"
  $mssqlKey = Open-HklmKey64 $mssqlPath $true
  if (-not $mssqlKey) { throw "Expected registry key not found: HKLM\$mssqlPath" }
  $mssqlKey.SetValue('LoginMode', 2, [Microsoft.Win32.RegistryValueKind]::DWord)
  Write-Log 'mixed-mode authentication enabled (LoginMode=2)'

  $tcpKey = Open-HklmKey64 "$mssqlPath\SuperSocketNetLib\Tcp" $true
  if ($tcpKey) {
    $tcpKey.SetValue('Enabled', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
    $ipAllKey = Open-HklmKey64 "$mssqlPath\SuperSocketNetLib\Tcp\IPAll" $true
    if ($ipAllKey) {
      # Dynamic ports must be CLEARED, not just overridden — a non-empty TcpDynamicPorts wins over
      # TcpPort, which is exactly why a stock Express install ignores 1433.
      $ipAllKey.SetValue('TcpDynamicPorts', '', [Microsoft.Win32.RegistryValueKind]::String)
      $ipAllKey.SetValue('TcpPort', '1433', [Microsoft.Win32.RegistryValueKind]::String)
    }
    Write-Log 'TCP/IP enabled on static port 1433'
  } else {
    Write-Log "WARNING: TCP registry key missing under $mssqlPath - skipped protocol config"
  }

  Write-Log "restarting service $($inst.Service) ..."
  Restart-Service -Name $inst.Service -Force
  Start-Sleep -Seconds 5   # service reports Running before the engine accepts logins
  Write-Log 'service restarted'

  # ---------------------------------------------------------------------------------------------
  # 4/5. Enable sa, set its password, create the application database
  # ---------------------------------------------------------------------------------------------
  # ALTER LOGIN takes no parameter for the password, so it must be a literal; double up single
  # quotes so a password containing one can't terminate the string.
  $escapedPwd = $saPassword.Replace("'", "''")
  $escapedDb = $DatabaseName.Replace(']', ']]')

  $conn = New-Object System.Data.SqlClient.SqlConnection(
    "Server=$($inst.Server);Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=30")
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    # CHECK_POLICY OFF so a simple shop-PC password isn't rejected by the machine's Windows
    # password policy, which would otherwise fail everything for a non-obvious reason.
    $cmd.CommandText = "ALTER LOGIN [sa] ENABLE; ALTER LOGIN [sa] WITH PASSWORD = N'$escapedPwd', CHECK_POLICY = OFF;"
    $cmd.ExecuteNonQuery() | Out-Null
    Write-Log 'sa login enabled and password set'

    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "IF DB_ID(N'$($DatabaseName.Replace("'", "''"))') IS NULL CREATE DATABASE [$escapedDb];"
    $cmd.ExecuteNonQuery() | Out-Null
    Write-Log "database '$DatabaseName' present"
  } finally {
    $conn.Dispose()
  }

  # ---------------------------------------------------------------------------------------------
  # 6. Prove it actually works, the same way the app will connect
  # ---------------------------------------------------------------------------------------------
  Write-Log 'verifying sa login over TCP on localhost,1433 ...'
  $verify = New-Object System.Data.SqlClient.SqlConnection(
    "Server=localhost,1433;Database=$DatabaseName;User ID=sa;Password=$saPassword;TrustServerCertificate=True;Connect Timeout=30")
  try {
    $verify.Open()
    $cmd = $verify.CreateCommand()
    $cmd.CommandText = 'SELECT 1'
    $cmd.ExecuteScalar() | Out-Null
    Write-Log 'VERIFIED: connected as sa over TCP successfully'
  } finally {
    $verify.Dispose()
  }

  Write-Log '=== SQL Server setup completed successfully ==='
  exit 0
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  if ($_.Exception.InnerException) { Write-Log "INNER: $($_.Exception.InnerException.Message)" }
  Write-Log "AT: $($_.ScriptStackTrace)"
  Write-Log '=== SQL Server setup FAILED ==='
  exit 1
}

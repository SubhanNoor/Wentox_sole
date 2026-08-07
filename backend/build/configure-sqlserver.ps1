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
# This connects over Windows Integrated auth to do the sa work, which always succeeds for a local
# administrator regardless of how sa/mixed-mode is currently configured — that's what makes it
# able to repair an instance whose sa is disabled or has an unknown password.
[CmdletBinding()]
param(
  # Path to a file holding the sa password. Passed as a file rather than an argument so the
  # password never appears in the process command line, and so NSIS doesn't have to escape quotes
  # into a command string. The installer writes it into $PLUGINSDIR, which it wipes on exit.
  [Parameter(Mandatory = $true)][string]$PasswordFile
)

$ErrorActionPreference = 'Stop'

function Get-SqlInstance {
  $key = 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL'
  if (-not (Test-Path $key)) { throw 'No SQL Server instance is registered on this machine.' }

  $props = (Get-ItemProperty $key).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }
  if (-not $props) { throw 'No SQL Server instance is registered on this machine.' }

  # Prefer the default instance (MSSQLSERVER) since that's what listens on 1433 with no extra
  # config and what the app defaults to; otherwise take whatever single instance exists.
  $chosen = $props | Where-Object { $_.Name -eq 'MSSQLSERVER' } | Select-Object -First 1
  if (-not $chosen) { $chosen = $props | Select-Object -First 1 }

  $isDefault = $chosen.Name -eq 'MSSQLSERVER'
  [pscustomobject]@{
    Name    = $chosen.Name          # MSSQLSERVER | SQLEXPRESS | ...
    RegId   = $chosen.Value         # MSSQL16.MSSQLSERVER | ...
    Service = if ($isDefault) { 'MSSQLSERVER' } else { "MSSQL`$$($chosen.Name)" }
    Server  = if ($isDefault) { '(local)' } else { "(local)\$($chosen.Name)" }
  }
}

# NSIS's FileWrite emits ANSI (not UTF-16LE — FileWriteUTF16LE exists separately for that), so
# read it back the same way rather than letting .NET guess an encoding.
$saPassword = [IO.File]::ReadAllText($PasswordFile, [Text.Encoding]::Default)
$saPassword = $saPassword.TrimEnd("`r", "`n")
if ([string]::IsNullOrEmpty($saPassword)) { throw 'Password file was empty.' }

$inst = Get-SqlInstance
Write-Host "Configuring SQL Server instance '$($inst.Name)' (service $($inst.Service))..."

$base = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$($inst.RegId)\MSSQLServer"
if (-not (Test-Path $base)) { throw "Expected registry key not found: $base" }

# --- Mixed-mode authentication ---
Set-ItemProperty -Path $base -Name 'LoginMode' -Value 2 -Type DWord
Write-Host '  mixed-mode authentication enabled'

# --- TCP/IP on a static port 1433 ---
$tcp = Join-Path $base 'SuperSocketNetLib\Tcp'
if (Test-Path $tcp) {
  Set-ItemProperty -Path $tcp -Name 'Enabled' -Value 1 -Type DWord
  $ipAll = Join-Path $tcp 'IPAll'
  if (Test-Path $ipAll) {
    # Dynamic ports must be cleared, not just overridden — a non-empty TcpDynamicPorts wins over
    # TcpPort, which is exactly why a default Express install ignores 1433.
    Set-ItemProperty -Path $ipAll -Name 'TcpDynamicPorts' -Value '' -Type String
    Set-ItemProperty -Path $ipAll -Name 'TcpPort' -Value '1433' -Type String
  }
  Write-Host '  TCP/IP enabled on static port 1433'
} else {
  Write-Warning "  TCP registry key not found at $tcp - skipping protocol config"
}

# --- Restart so LoginMode/TCP actually take effect ---
Write-Host '  restarting SQL Server service...'
Restart-Service -Name $inst.Service -Force
# Restart-Service returns once the service reports Running, but the engine needs a moment more
# before it accepts logins.
Start-Sleep -Seconds 5

# --- Enable sa and set its password ---
# ALTER LOGIN takes no parameters for the password, so it has to be a literal; double up single
# quotes so a password containing one can't terminate the string.
$escaped = $saPassword.Replace("'", "''")
$connStr = "Server=$($inst.Server);Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=30"

$conn = New-Object System.Data.SqlClient.SqlConnection $connStr
try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  # CHECK_POLICY OFF so a simple shop-PC password isn't rejected by the machine's Windows password
  # policy, which would otherwise fail the whole install for a non-obvious reason.
  $cmd.CommandText = @"
ALTER LOGIN [sa] ENABLE;
ALTER LOGIN [sa] WITH PASSWORD = N'$escaped', CHECK_POLICY = OFF;
"@
  $cmd.ExecuteNonQuery() | Out-Null
  Write-Host '  sa login enabled and password set'
} finally {
  $conn.Dispose()
}

Write-Host 'SQL Server configured successfully.'

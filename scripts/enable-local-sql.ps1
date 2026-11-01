#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$tcp='HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.SQLEXPRESS\MSSQLServer\SuperSocketNetLib\Tcp'
$listener=Get-NetTCPConnection -State Listen -LocalPort 1433 -ErrorAction SilentlyContinue
$service=Get-CimInstance Win32_Service -Filter 'Name="MSSQL$SQLEXPRESS"'
if ($listener -and ($listener.OwningProcess | Where-Object {$_ -ne $service.ProcessId})) {throw 'Port 1433 is already used by another application.'}
if ((Get-ItemProperty $tcp).Enabled -ne 1 -or (Get-ItemProperty "$tcp\IPAll").TcpPort -ne '1433') {
 Set-ItemProperty $tcp -Name Enabled -Value 1
 Set-ItemProperty "$tcp\IPAll" -Name TcpDynamicPorts -Value ''
 Set-ItemProperty "$tcp\IPAll" -Name TcpPort -Value '1433'
 Restart-Service -Name 'MSSQL$SQLEXPRESS' -Force
}
Write-Host 'SQL Server TCP/IP ready on port 1433.'
Read-Host 'Press Enter to close'
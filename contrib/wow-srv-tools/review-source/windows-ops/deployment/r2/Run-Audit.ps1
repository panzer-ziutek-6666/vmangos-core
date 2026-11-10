. (Join-Path $PSScriptRoot 'Evidence.Common.ps1')
$r=Capture 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' @('-NoProfile','-File',(Join-Path $PSScriptRoot 'Audit-Migrations.ps1')) 'FRESH-MIGRATION-AUDIT-CORRECTED-PATH' 240000
if($r.ExitCode -ne 0){exit 1}

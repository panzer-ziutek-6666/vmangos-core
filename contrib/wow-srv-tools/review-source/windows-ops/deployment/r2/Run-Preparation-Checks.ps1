param([ValidateSet('Tests','Plan','Preflight','Endpoint','InputPlan')][string]$Check='Tests',[string]$Tag='PREPARATION-TESTS-R1')
. (Join-Path $PSScriptRoot 'Evidence.Common.ps1')
$file=switch($Check){'Tests'{'Test-FullProduction.ps1'};'Plan'{'Invoke-Deployment.ps1'};'Preflight'{'Preflight-Production.ps1'};'Endpoint'{'Test-Endpoint-Guard.ps1'};'InputPlan'{'Prepare-ExecutionInputs.ps1'}}
$tokens=@('-NoProfile','-File',(Join-Path $PSScriptRoot $file))
$r=Capture 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $tokens $Tag 240000
Write-Host ('NATIVE_EXIT='+$r.ExitCode)
if($r.ExitCode -ne 0 -or $null -eq $r.ExitCode){exit 1}

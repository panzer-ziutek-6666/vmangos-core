[CmdletBinding()]
param([ValidateSet('Plan','Execute')][string]$Mode='Plan',[Parameter(Mandatory=$true)][string]$DeploymentReceipt,[string]$Inputs,[string]$ApprovalReceipt)
. (Join-Path $PSScriptRoot 'Evidence.Common.ps1')
$tag='ROLLBACK-'+$Mode+'-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')
$tokens=@('-NoProfile','-File',(Join-Path $PSScriptRoot 'Rollback-FullCandidate.ps1'),'-Mode',$Mode,'-DeploymentReceipt',$DeploymentReceipt)
if($Mode -ceq 'Execute'){$tokens+=@('-Inputs',$Inputs,'-ApprovalReceipt',$ApprovalReceipt)}
$r=Capture 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $tokens $tag 7200000
Write-Host ('PROCESS_RECORD='+$Out+'\'+$tag+'.process.json')
if($null -eq $r.ExitCode -or $r.ExitCode -ne 0 -or !$r.StreamsCaptured){exit 1}

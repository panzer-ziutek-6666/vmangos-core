[CmdletBinding()]
param([ValidateSet('Plan','Execute')][string]$Mode='Plan',[string]$Inputs,[string]$ApprovalReceipt)
. (Join-Path $PSScriptRoot 'Evidence.Common.ps1')
$tag='DEPLOY-'+$Mode+'-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')
$tokens=@('-NoProfile','-File',(Join-Path $PSScriptRoot 'Deploy-FullCandidate.ps1'),'-Mode',$Mode)
if($Mode -ceq 'Execute'){$tokens+=@('-Inputs',$Inputs,'-ApprovalReceipt',$ApprovalReceipt)}
$r=Capture 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' $tokens $tag 7200000
Write-Host ('PROCESS_RECORD='+$Out+'\'+$tag+'.process.json')
# A timeout never terminates the child and never starts another Execute.
if($null -eq $r.ExitCode -or $r.ExitCode -ne 0 -or !$r.StreamsCaptured){exit 1}

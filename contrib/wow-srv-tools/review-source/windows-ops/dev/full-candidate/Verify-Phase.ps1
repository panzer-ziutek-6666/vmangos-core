param([Parameter(Mandatory=$true)][string]$ReceiptPath,[Parameter(Mandatory=$true)][string]$ProcessRecord,[Parameter(Mandatory=$true)][string]$ResultPath)
. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
. (Join-Path $PSScriptRoot 'Verifier.R2.ps1')
$result=Invoke-PhaseVerification $ReceiptPath $ProcessRecord $ResultPath
PutJson $ResultPath $result
Write-Host ('INDEPENDENT='+$result.Result)
if($result.Result -cne 'PASS'){Write-Host ('ERROR='+$result.Error);exit 1};exit 0
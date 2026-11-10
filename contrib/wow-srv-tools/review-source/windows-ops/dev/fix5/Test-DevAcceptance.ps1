[CmdletBinding()]
param([ValidateSet('Plan','Execute')][string]$Mode='Plan',[string]$ApprovalReceipt,[string]$Inputs)
. (Join-Path $PSScriptRoot 'Kit.Common.ps1')
. (Join-Path $PSScriptRoot 'Native.Driver.ps1')
. (Join-Path $PSScriptRoot 'Invoke-Job.ps1')
$okay=InvokeKitJob 'DevAccept' $Mode $ApprovalReceipt $Inputs
if(!$okay){exit 1}
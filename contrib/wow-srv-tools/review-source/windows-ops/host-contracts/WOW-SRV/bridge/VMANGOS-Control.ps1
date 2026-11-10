[CmdletBinding()]
param([ValidateSet('Status','Start-All','Stop-All','Restart-World','Planned-Reboot')][string]$Action='Status',[switch]$Json,[switch]$Boot,[switch]$Execute,[switch]$CheckOnly,[switch]$Run,[string]$RebootApprovalReceipt)
$ErrorActionPreference='Stop'
if(!($env:COMPUTERNAME -ceq 'WOW-SRV' -and $PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.ToString() -like '5.1.*' -and [Environment]::Is64BitProcess -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))){throw 'ROUTE_HOST_TOKEN_PS51'}
if($CheckOnly){$Action='Status'}
if($Run){$Action='Start-All';$Boot=$true}
$dispatcher='C:\ProgramData\VMANGOS\AdminPanelBridge\Invoke-R3Bundle.ps1'
if(!$Execute){[pscustomobject]@{Mode='Plan';Action=$Action;Boot=[bool]$Boot;Dispatcher=$dispatcher;Mutations=0}|ConvertTo-Json;'OK=True';'CHANGE_SCOPE=READ_ONLY_PLAN';'LOG=stdout captured by caller';'NEXT_STEP=Separate approved deployment required';return}
$tokens=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$dispatcher,'-Action',$Action,'-Execute');if($Json){$tokens+='-Json'};if($Boot){$tokens+='-Boot'};if($RebootApprovalReceipt){$tokens+=@('-RebootApprovalReceipt',$RebootApprovalReceipt)}
$global:LASTEXITCODE=$null
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' @tokens
if($null -eq $LASTEXITCODE){throw 'ROUTE_CHILD_RESULT_UNKNOWN'}
exit $LASTEXITCODE
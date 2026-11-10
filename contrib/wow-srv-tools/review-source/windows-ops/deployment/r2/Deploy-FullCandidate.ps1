[CmdletBinding()]
param([ValidateSet('Plan','Execute')][string]$Mode='Plan',[string]$Inputs,[string]$ApprovalReceipt)
. (Join-Path $PSScriptRoot 'FullProduction.ps1')
$run=NewKitRun 'Migrate' $Mode;$okay=$false
$run.Receipt.MainProcess=@{PID=$PID;CreatedUtc=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToString('o')}
try{
 AssertKitPins;Assert-FullCandidate $run
 if($Mode -ceq 'Plan'){PutJson (Join-Path $run.Out 'PLAN.json') @{Steps=@(Get-FullSteps);Plan=$run.Plan;Deployment='NOT_RUN';ApprovalRequired='MigrateFull + fresh NoDDL + private audit schema + two exact SQL';Rollback='Never automatic DB restore; see ROLLBACK-PLAN.md'};$run.Receipt.Result='PLAN_ONLY';$okay=$true}
 else{
  AssertApproval $run $ApprovalReceipt 'MigrateFull';Assert-FullApprovalTiming $run.State.Approval;AssertPrivate $Inputs;$i=GetJson $Inputs;EnterKitLocks $run $true
  # A unique durable claim bound to the approval prevents a second Execute with it.
  $claim=Join-Path (Split-Path $ApprovalReceipt) ('MigrateFull-'+(Hash $ApprovalReceipt)+'.claim.json');Need (!(Test-Path $claim)) 'APPROVAL_ALREADY_CLAIMED';DurableJson $claim @{Operation=$run.Id;PlanSHA256=$run.Receipt.PlanSHA256;StartedUtc=[DateTimeOffset]::UtcNow.ToString('o')}
  Add-Type -Path (Join-Path $PSScriptRoot 'dependencies\File.Identity.cs')
  $driver=New-FullDriver $run $i;[void](Invoke-KitSequence @(Get-FullSteps) $driver $run.Receipt);$okay=$true
 }
}catch{$run.Receipt.Error=$_.Exception.ToString();if($run.Receipt.Result -ceq 'PREPARED'){$run.Receipt.Result='FAIL_GUARD_NO_EXECUTION'};LogKit $run ('ERROR='+$_.Exception.Message)}
finally{LeaveKitLocks $run;FinishKit $run $okay $(if($okay -and $Mode -ceq 'Plan'){'Review package; separate explicit deployment approval + new NoDDL window'}elseif($okay){'Independent Verify-Deployment, no extra service cycle'}else{'Preserve state; inspect receipt. No automatic retry/rollback/DB restore/reboot'})}
if(!$okay){exit 1}

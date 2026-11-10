[CmdletBinding()]
param([ValidateSet('Plan','Execute')][string]$Mode='Plan',[Parameter(Mandatory=$true)][string]$DeploymentReceipt,[string]$ApprovalReceipt,[string]$Inputs)
. (Join-Path $PSScriptRoot 'FullProduction.ps1')
$run=NewKitRun 'Rollback' $Mode;$okay=$false
try{
 AssertKitPins;AssertPrivate $DeploymentReceipt;$prior=GetJson $DeploymentReceipt
 Need ($prior.Kind -ceq 'Migrate' -and $prior.Mode -ceq 'Execute' -and $prior.PlanSHA256 -ceq $run.Receipt.PlanSHA256 -and $prior.CandidateManifestSHA256 -ceq $run.Plan.FullCandidate.SHA256) 'ROLLBACK_EXACT_DEPLOYMENT_ONLY'
 $decision=Get-FullRollbackDecision $prior;$run.Receipt.RollbackDecision=$decision
 if($Mode -ceq 'Plan'){
  $run.Receipt.Result='PLAN_ONLY';PutJson (Join-Path $run.Out 'ROLLBACK-PLAN.json') @{Decision=$decision;ReceiptSHA256=(Hash $DeploymentReceipt);BeforeRelease=$prior.BeforeRegistry;FileBackup=$prior.FileBackup;DatabaseRestore='NEVER_AUTOMATIC';LeavesRuntime='Stopped; explicit controlled start/readiness/registry commit is a separately reviewed continuation';PostSQL='No Execute accepted by this script after any SQL attempt, including UNKNOWN'};$okay=$true
 }else{
  Need ($decision -ceq 'PRE_SQL_FILES_ONLY_SEPARATE_ROLLBACK_APPROVAL_REQUIRED') 'POST_SQL_ROLLBACK_BLOCKED_DATA_REVIEW_REQUIRED'
  AssertApproval $run $ApprovalReceipt 'Rollback';Assert-FullApprovalTiming $run.State.Approval;Need ($run.State.Approval.DeploymentReceiptSHA256 -ceq (Hash $DeploymentReceipt) -and $run.State.Approval.SchemaCompatibilityVerified -is [bool] -and $run.State.Approval.SchemaCompatibilityVerified) 'EXACT_ROLLBACK_CONSENT'
  AssertPrivate $Inputs;$i=GetJson $Inputs;Need ($i.DeploymentReceipt -ceq $DeploymentReceipt) 'EXACT_ROLLBACK_INPUT'
  EnterKitLocks $run $true;$claim=Join-Path (Split-Path $ApprovalReceipt) ('RollbackFull-'+(Hash $ApprovalReceipt)+'.claim.json');Need (!(Test-Path $claim)) 'ROLLBACK_APPROVAL_USED';DurableJson $claim @{Operation=$run.Id;Prior=$prior.Operation}
  Add-Type -Path (Join-Path $PSScriptRoot 'dependencies\File.Identity.cs')
  $driver=NewNativeDriver $run $i
  $driver.RestoreRoutes={RestoreBackupRows $run 'Routes';RestoreBackupRows $run 'Pointer';Ack}.GetNewClosure()
  [void](Invoke-KitSequence @(Get-KitSteps 'Rollback') $driver $run.Receipt);$okay=$true
 }
}catch{$run.Receipt.Error=$_.Exception.ToString();if($run.Receipt.Result -ceq 'PREPARED'){$run.Receipt.Result='FAIL_GUARD_NO_EXECUTION'};LogKit $run ('ERROR='+$_.Exception.Message)}
finally{LeaveKitLocks $run;FinishKit $run $okay 'Review exact current state; never restore DB automatically; no automatic retry or start'}
if(!$okay){exit 1}

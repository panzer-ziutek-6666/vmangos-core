[CmdletBinding()]
param([ValidateSet('Plan','Execute')][string]$Mode='Plan',[string]$ApprovalReceipt,[string]$VerifiedReceipt)
. (Join-Path $PSScriptRoot 'Kit.Common.ps1')
$run=NewKitRun 'CloseRebootClaim' $Mode;$okay=$false
try{
 if($Mode -ceq 'Plan'){$run.Receipt.Result='PLAN_ONLY';LogKit $run 'Only a verified completed operation may be archived; never clear a failed/unknown request automatically'}
 else{
  AssertApproval $run $ApprovalReceipt 'CloseRebootClaim';AssertPrivate $VerifiedReceipt;$v=GetJson $VerifiedReceipt;Need ($v.Result -ceq 'PASS_REAL_BOOT_VERIFIED' -and $v.PlanSHA256 -ceq $run.Receipt.PlanSHA256) 'VERIFIED_BOOT_RECEIPT_REQUIRED'
  Need (([DateTimeOffset]::new((Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime())) -eq ([DateTimeOffset]::Parse($v.CurrentBootUtc)).ToUniversalTime()) 'BOOT_CHANGED_AFTER_VERIFICATION'
  EnterKitLocks $run $true;$path=Join-Path $run.Plan.Maintenance 'planned-reboot-claim.json';AssertPrivate $path;Need ((Hash $path) -ceq $v.ClaimSHA256) 'CLAIM_CHANGED_SINCE_VERIFY';$c=GetJson $path;Need ($c.Operation -ceq $v.OperationId) 'CLAIM_OPERATION_MISMATCH'
  $archive=Join-Path $run.Plan.Maintenance ('completed-reboot-'+$c.Operation+'.json');Need (!(Test-Path $archive)) 'CLAIM_ALREADY_ARCHIVED';[IO.File]::Move($path,$archive);$run.Receipt.Result='PASS';$run.Receipt.Archive=$archive
 }
 $okay=$true
}catch{$run.Receipt.Result='FAIL_NO_RETRY';$run.Receipt.Error=$_.Exception.Message;LogKit $run ('ERROR='+$_.Exception.ToString())}finally{LeaveKitLocks $run;FinishKit $run $okay 'Review archived operation before separately planning a new reboot'}
if(!$okay){exit 1}

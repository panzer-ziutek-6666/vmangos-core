function InvokeKitJob([string]$Kind,[string]$Mode,[string]$ApprovalReceipt,[string]$InputsPath){
 $run=NewKitRun $Kind $Mode;$okay=$false
 try{
  if($Mode -ceq 'Plan'){
   AssertKitPins;$plan=GetPlanProjection $run;PutJson (Join-Path $run.Out 'PLAN.json') $plan;Write-Host ($plan|ConvertTo-Json -Depth 12);$run.Receipt.Result='PLAN_ONLY';$okay=$true
  }else{
   AssertApproval $run $ApprovalReceipt $Kind
   AssertPrivate $InputsPath;$inputs=GetJson $InputsPath
   EnterKitLocks $run ($Kind -cin @('Migrate','Rollback','Lifecycle'))
   Add-Type -Path (Join-Path $PSScriptRoot 'dependencies\File.Identity.cs')
   . (Join-Path $PSScriptRoot 'controller\World.Markers.ps1')
   $driver=NewNativeDriver $run $inputs
   [void](Invoke-KitSequence @(Get-KitSteps $Kind) $driver $run.Receipt);$okay=$true
  }
 }catch{$run.Receipt.Error=$_.Exception.Message;if($run.Receipt.Result -cin @('PREPARED','PLAN_ONLY')){$run.Receipt.Result='FAIL_GUARD_NO_EXECUTION'};LogKit $run ('ERROR='+$_.Exception.ToString())}
 finally{LeaveKitLocks $run;FinishKit $run $okay $(if($Mode -ceq 'Plan'){'Review exact plan/inputs; obtain separate approval before Execute'}elseif($okay){'Review receipt and evidence before any later stage'}else{'Stop; analyze full receipt; no automatic retry/rollback'})}
 return $okay
}

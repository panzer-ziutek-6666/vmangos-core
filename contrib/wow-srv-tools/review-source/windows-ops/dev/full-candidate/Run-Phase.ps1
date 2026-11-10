[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('DevMigrations','DevAccept')][string]$Kind,[Parameter(Mandatory=$true)][string]$InputsPath,[Parameter(Mandatory=$true)][string]$ApprovalPath)
. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
$run=NewKitRun $Kind 'Execute';$okay=$false
try{
 AssertApproval $run $ApprovalPath $Kind
 $a=$run.State.Approval
 Need ($a.CandidateManifestSHA256 -ceq $run.Plan.CandidateBinding.ManifestSHA256 -and $a.DevPlanSHA256 -ceq $run.Plan.CandidateBinding.DevPlanSHA256 -and ([DateTimeOffset]::Parse($a.IssuedUtc)) -le [DateTimeOffset]::UtcNow -and ([DateTimeOffset]::Parse($a.ExpiresUtc))-([DateTimeOffset]::Parse($a.IssuedUtc)) -le [TimeSpan]::FromHours(24) -and $a.SnapshotStrategy -ceq 'AllInnoDB' -and $a.AllowGlobalReadLock -is [bool] -and !$a.AllowGlobalReadLock) 'CANDIDATE_PHASE_APPROVAL'
 AssertPrivate $InputsPath;$inputs=GetJson $InputsPath;AssertDevNamespace $run;AssertCandidateInputs $run
 EnterKitLocks $run $false
 Add-Type -Path (Join-Path $PSScriptRoot 'dependencies\File.Identity.cs')
 LoadProduction $run
 $run.Receipt.LoaderProvenance=@(foreach($n in @('New-ProductionWorldDriver','Read-StopObservationFix3','DevServiceRecord','DevPortReady','DevSQL','InvokeNativeStep')){$c=Get-Command $n;[pscustomobject]@{Name=$n;File=$c.ScriptBlock.File;DefinitionSHA256=$(if($c.ScriptBlock.File){Hash $c.ScriptBlock.File}else{$null})}})
 $driver=NewNativeDriver $run $inputs
 [void](Invoke-KitSequence @(Get-KitSteps $Kind) $driver $run.Receipt)
 Need ($run.Receipt.Result -ceq 'PASS') 'SEQUENCE_NOT_PASS';$okay=$true
}catch{$run.Receipt.Error=$_.Exception.Message;$run.Receipt.ErrorDetail=$_.Exception.ToString();$run.Receipt.ErrorPosition=$_.InvocationInfo.PositionMessage;if($run.Receipt.Result -ceq 'PREPARED'){$run.Receipt.Result='FAIL_GUARD_NO_EXECUTION'};LogKit $run ('ERROR='+$_.Exception.Message)}
finally{$run.Receipt.FinishedUtc=[DateTimeOffset]::UtcNow.ToString('o');LeaveKitLocks $run;FinishKit $run $okay 'Independent verifier required. No retry/rollback/force kill.'}
Write-Host ('RECEIPT='+ (Join-Path $run.Out 'RECEIPT.json'))
if(!$okay){exit 1}
exit 0

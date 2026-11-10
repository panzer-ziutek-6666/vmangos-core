function AssertLiveBundle($Run){
 AssertPrivate $Run.Plan.BundlePointer;$b=GetJson $Run.Plan.BundlePointer
 Need ($b.Schema -eq 1 -and $b.Phase -ceq 'Live' -and $b.PlanSHA256 -ceq $Run.Receipt.PlanSHA256 -and $b.Release.id -ceq $Run.Plan.CandidateReference.id -and $b.Release.sha256 -ceq $Run.Plan.CandidateReference.sha256) 'ACTIVE_R3_BUNDLE_REQUIRED'
 foreach($f in $Run.Plan.Files|Where-Object Group -in @('Routes','Binaries')){Need ((Hash $f.Target) -ceq $f.SHA256) 'ACTIVE_R3_ROUTE_OR_BINARY_CHANGED'}
 foreach($f in $Run.Plan.VersionPins){Need ((Hash $f.Target) -ceq $f.SHA256) 'ACTIVE_R3_CONTROLLER_CHANGED'}
 $c=GetJson $Run.Plan.CollectorPointer;Need ($c.collectorVersion -ceq $Run.Plan.CollectorVersion -and $c.codeManifestSHA256 -ceq $Run.Plan.CollectorCodeSHA256) 'ACTIVE_COLLECTOR_CHANGED'
 $state=GetJson (Join-Path $Run.Plan.Registry 'state.json');Need ($state.phase -ceq 'stable' -and $state.active.id -ceq $b.Release.id -and $state.active.sha256 -ceq $b.Release.sha256) 'ACTIVE_R3_REGISTRY_REQUIRED'
 $cap=Join-Path $Run.Plan.VersionRoot 'REBOOT-CAPABILITY.json';Need ((Hash $cap) -ceq $b.CapabilitySHA256 -and (GetJson $cap).Approved) 'ACTIVE_CAPABILITY_REQUIRED'
 return $b
}
function VerifyRebootOutcome($Run,[string]$Scenario){
 [void](AssertLiveBundle $Run);LoadProduction $Run
 $path=Join-Path $Run.Plan.Maintenance 'planned-reboot-claim.json';AssertPrivate $path;$claim=GetJson $path
 Need ($claim.Schema -eq 2 -and $claim.Operation -cmatch '^[a-f0-9]{32}$') 'REBOOT_CLAIM_SCHEMA'
 Need ($claim.Phase -cin @('REQUEST_ACCEPTED_BOOT_NOT_VERIFIED','RESUMED_READY') -and $null -ne $claim.Request -and $claim.Request.ResultKnown -is [bool] -and $claim.Request.ResultKnown -and $null -ne $claim.Request.ExitCode -and $claim.Request.ExitCode -isnot [bool] -and $claim.Request.ExitCode -eq 0) 'REBOOT_REQUEST_RESULT_NOT_CONFIRMED'
 $evidence=Get-ControlBootEvidence $claim
 # Validate the original accepted request using actual R3 predicate. Do not edit the claim.
 $copy=($claim|ConvertTo-Json -Depth 20)|ConvertFrom-Json;$copy.Phase='REQUEST_ACCEPTED_BOOT_NOT_VERIFIED';$copy.Resume.Desired=$true
 $m=$Run.State.Module;& $m {param($c,$e)Assert-PlannedBoot $c $e} $copy $evidence
 $state=Read-ControlState $Run.Plan.Maintenance 'mangosd'
 if($Scenario -ceq 'RunningResume'){
  Need ($claim.Resume.Desired -and $claim.Phase -ceq 'RESUMED_READY' -and $state.Phase -ceq 'Stable' -and [DateTimeOffset]::Parse($claim.ResumeBootUtc) -eq [DateTimeOffset]::Parse($evidence.CurrentBootUtc)) 'ONE_TIME_RESUME_NOT_CONFIRMED'
  Need (Get-CurrentStatus).Ready 'RESUMED_STACK_NOT_READY';WaitKitSamples $Run $Run.Plan.CandidateReference
  $events=@(foreach($line in [IO.File]::ReadLines((Join-Path $Run.Plan.Maintenance 'journal.jsonl'))){$v=$line|ConvertFrom-Json;if($v.Event -ceq 'PLANNED_RESUME_ONCE_VERIFIED_NEW_BOOT' -and $v.Data.Operation -ceq $claim.Operation){$v}})
  Need ($events.Count -eq 1) 'RESUME_JOURNAL_COUNT'
 }else{
  Need (!$claim.Resume.Desired -and $state.Phase -ceq 'Maintenance') 'MANUAL_MAINTENANCE_NOT_PRESERVED'
  foreach($name in @('mangosd','realmd','VMANGOS-MySQL')){Assert-BackendQuiescent $name}
 }
 $Run.Receipt.OperationId=$claim.Operation;$Run.Receipt.Scenario=$Scenario;$Run.Receipt.SourceBootUtc=$claim.Resume.SourceBootUtc;$Run.Receipt.CurrentBootUtc=$evidence.CurrentBootUtc;$Run.Receipt.Result='PASS_REAL_BOOT_VERIFIED';$Run.Receipt.ClaimSHA256=Hash $path
}

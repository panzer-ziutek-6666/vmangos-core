param([Parameter(Mandatory=$true)][string]$TargetRoot,[Parameter(Mandatory=$true)][string]$RunTag,[switch]$Before,[switch]$OnlyBarrier)
. (Join-Path $TargetRoot 'Kit.Common.ps1')
. (Join-Path $TargetRoot 'Native.Driver.ps1')
$script:HarnessRoot=$TargetRoot
$script:Out='C:\GRY\wow\diagnostics\SHUTDOWN1053-DEV-MIGRATION-PREP-R2-FIX5-WOW-SRV-20261108-1818'
$script:RealCim=Get-Command Get-CimInstance -CommandType Cmdlet
$script:OriginalTransport=(Get-Command New-ProcessIdentityTransportFix2).ScriptBlock
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $TargetRoot 'Test-Production-Fix4.ps1'),[ref]$tokens,[ref]$errors)
Need (@($errors).Count -eq 0) 'HARNESS_SYNTAX'
foreach($node in $ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}){. ([scriptblock]::Create($node.Extent.Text.Replace('$PSScriptRoot','$script:HarnessRoot')))}
$script:BaseFixtureCim=(Get-Command Get-CimInstance).ScriptBlock
$script:BaseInitialize=(Get-Command InitializeCase).ScriptBlock
$script:BaseRequestStop=(Get-Command RequestFixtureStop).ScriptBlock
$script:Results=[Collections.Generic.List[object]]::new();$script:Skip=@{}
$script:TestsRoot=Join-Path $Out $RunTag;Need (!(Test-Path $script:TestsRoot)) 'NO_REPEAT_TEST';[void][IO.Directory]::CreateDirectory($script:TestsRoot)
$script:ResultName=$RunTag+'.json'
function Get-CimInstance([string]$ClassName,[string]$Filter,$ErrorAction){
 if($ClassName -ceq 'Win32_Service'){
  $name=[regex]::Match($Filter,"Name='([^']+)'").Groups[1].Value
  if($script:Models.ContainsKey($name) -and $script:Models[$name].StopRequests -gt 0 -and $script:FaultTarget -ceq $name -and $script:FaultKind -ceq 'Observation'){throw 'FIXTURE_OBSERVATION_FAILURE_AFTER_STOP'}
 }
 & $script:BaseFixtureCim $ClassName $Filter $ErrorAction
}
function RequestFixtureStop([string]$Name){
 if($Name -ceq $script:FaultTarget -and $script:FaultKind -cin @('Unknown','Timeout')){
  $m=$script:Models[$Name];$m.StopRequests++;Need ($m.StopRequests -eq 1) 'NO_SECOND_STOP';$m.State='Stop Pending'
  $script:Trace.Add([pscustomobject]@{Event='STOP_BOUNDARY';Name=$Name;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')});return
 }
 & $script:BaseRequestStop $Name
}
function Get-ScheduledTask([string]$TaskName,[string]$TaskPath,$ErrorAction){Need ($script:Tasks.ContainsKey($TaskName)) 'FIXTURE_TASK_ONLY';[pscustomobject]@{State='Ready';Settings=[pscustomobject]@{Enabled=[bool]$script:Tasks[$TaskName]}}}
function Enable-ScheduledTask([string]$TaskName,[string]$TaskPath,$ErrorAction){Need ($script:Tasks.ContainsKey($TaskName)) 'FIXTURE_TASK_ONLY';$script:Tasks[$TaskName]=$true}
function Disable-ScheduledTask([string]$TaskName,[string]$TaskPath,$ErrorAction){Need ($script:Tasks.ContainsKey($TaskName)) 'FIXTURE_TASK_ONLY';$script:Tasks[$TaskName]=$false}
function FixtureReleaseState($Context){[pscustomobject]@{phase='stable';active=[pscustomobject]@{id='fixture-before';sha256=('A'*64)};previous=$null;transaction=$null}}
function New-ProductionReleaseContextFix4($Run){InstallBoundaries;Set-Item Function:global:Get-ReleaseRegistryState (Get-Command FixtureReleaseState).ScriptBlock;[pscustomobject]@{Root=$Run.Plan.Registry;Runtime=$Run.Plan.Runtime;Snapshot=(Join-Path $Run.Out snapshot.json);Isolated=$true}}
function FixtureLogicalBackup($Run,[string]$Source){$script:Trace.Add([pscustomobject]@{Event='LOGICAL_BACKUP_BOUNDARY';AtUtc=[DateTimeOffset]::UtcNow.ToString('o')});throw 'FIXTURE_LOGICAL_BACKUP_FAILURE'}
function FixtureCapability{[pscustomobject]@{Approved=$true;SHA256=('A'*64)}}
function FixtureBootUtc{return '2026-11-07T00:00:00.0000000Z'}
function FixtureReboot($Context){$script:Reboots++;$script:Trace.Add([pscustomobject]@{Event='REBOOT_FIXTURE_ONLY';Operation=$Context.Operation;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')});[pscustomobject]@{ResultKnown=$true;ExitCode=[long]0;Fixture=$true}}
function InitializeCase([string]$Label,[string]$Kind,[string]$Scenario){
 $script:FaultTarget='';$script:FaultKind='';$script:Reboots=0
 & $script:BaseInitialize $Label $Kind 'Happy'
 $script:Tasks=@{};$script:Run.Plan.Tasks=@(foreach($i in 1..5){$n='Fixture-Task'+$i;$script:Tasks[$n]=($i -ne 5);[pscustomobject]@{Name=$n;Path='\'}})
 $script:Run.Receipt.Kind=$Kind;$script:Run.Receipt.Mode='Execute';$script:Run.Receipt.Operation=$script:Run.Id;$script:Run.Receipt.PlanSHA256=Hash (Join-Path $TargetRoot KIT-PLAN.json)
 $script:Run.Plan|Add-Member -NotePropertyName PreviousPlanSHA256 -NotePropertyValue (ReadJson (Join-Path $TargetRoot KIT-PLAN.json)).PreviousPlanSHA256
 $script:Run.State.Approval=[pscustomobject]@{SchemaCompatibilityVerified=$true}
 $source=Join-Path $script:CaseDir fixture-source.txt;[IO.File]::WriteAllText($source,'fixture-only')
 $script:Run.Plan.Files=@([pscustomobject]@{Id='fixture-file';Source=$source;Target=(Join-Path $script:CaseDir never-written-target.txt);Group='Fixture';SHA256=(Hash $source)})
 Set-Item Function:script:Get-ReleaseRegistryState (Get-Command FixtureReleaseState).ScriptBlock
 Set-Item Function:script:LogicalBackup (Get-Command FixtureLogicalBackup).ScriptBlock
 Set-Item Function:script:Assert-RebootCoreCapability (Get-Command FixtureCapability).ScriptBlock
 Set-Item Function:script:Get-ControlBootUtc (Get-Command FixtureBootUtc).ScriptBlock
 if(Get-Command Invoke-ControlRebootNativeFix4R2 -ErrorAction SilentlyContinue){Set-Item Function:script:Invoke-ControlRebootNativeFix4R2 (Get-Command FixtureReboot).ScriptBlock}
 $script:Run.State.ValidatedSourceDefaults=[pscustomobject]@{Path=$source;SHA256=(Hash $source)}
 CaptureControlTasksR2 $script:Run
 if($Scenario -match '^(mangosd|realmd)_(Nonzero|Unknown|Timeout|Observation)$'){
  $script:FaultTarget=$Matches[1];$script:FaultKind=$Matches[2]
  if($script:FaultKind -ceq 'Nonzero'){
   # Replace only the still-unused fixture generation; old child exits naturally.
   $old=$script:Models[$script:FaultTarget].Children[0];[IO.File]::WriteAllText($old.Signal,'SELF_EXIT');Need ($old.Process.WaitForExit(5000)) 'FIXTURE_INITIAL_EXIT'
   $script:Models[$script:FaultTarget].Children.Clear();[void](SpawnChild $script:FaultTarget 7);if($script:FaultTarget -ceq 'mangosd'){WriteWorldMarkers}
   $m=$script:Run.State.Module;& $m {param($c)$s=Get-ControlSnapshot $c;Set-ControlState $c Stable ExplicitStartConfirmedReady $s.Generation} $script:Run.State.Context
  }
 }
}
function Stack([string]$Action){
 $scope=$script:Run.State.MaintenanceScope;$scope.Operation=$null;$scope.Action=$null
 $script:WorldDriver.PollMilliseconds=50
 # Actual public wrappers and callbacks; only reboot-native boundary is substituted.
 if($Action -ceq 'Stop-All'){Invoke-StopAll -TimeoutSeconds 1}else{Invoke-PlannedAdministrativeReboot -TimeoutSeconds 1}
}
function MigrateFailureAndRollback([string]$Variant='Exact'){
 $d=NewNativeDriver $script:Run ([pscustomobject]@{});$failure=$null
 try{[void](Invoke-KitSequence @('Gate','BackupFiles','StopWorld','StopRealm','LogicalBackup') $d $script:Run.Receipt)}catch{$failure=$_.Exception.Message}
 Need ($failure -ceq 'FIXTURE_LOGICAL_BACKUP_FAILURE') ('MIGRATE_WRONG_FAILURE '+$failure)
 Need ($script:Run.Receipt.Completed -contains 'StopWorld' -and $script:Run.Receipt.Completed -contains 'StopRealm' -and $script:Run.Receipt.ControlBarrier -ceq 'ALL_FIVE_TASKS_DISABLED_VERIFIED' -and $null -eq $script:Run.Receipt.BarrierError) 'REAL_MIGRATE_BARRIER_FAILED'
 $receiptPath=Join-Path $script:Run.Plan.Maintenance deployment-receipt.json
 $module=$script:Run.State.Module;& $module {param($path,$r)Write-ControlAtomic $path $r} $receiptPath $script:Run.Receipt
 $prior=ReadJson $receiptPath
 switch($Variant){
  'OtherOperation'{$prior.Operation=[guid]::NewGuid().ToString('N')}
  'ManualDecision'{& $module {param($c)Set-ControlState $c Maintenance ManualDecision $null} $script:Run.State.Context}
  'Generation'{$script:Models.mangosd.State='Running';[void](SpawnChild mangosd)}
  'Unknown'{$prior.WorldMaintenanceProof.Completion.ProcessExits[0].Measurement='UNKNOWN';$prior.WorldMaintenanceProof.Completion.ProcessExits[0].NativeExit=$null}
  'Nonzero'{$prior.WorldMaintenanceProof.Completion.ProcessExits[0].NativeExit=7}
 }
 if($Variant -cne 'Exact'){& $module {param($path,$r)Write-ControlAtomic $path $r} $receiptPath $prior}
 $script:Run.Kind='Rollback';$script:Run.Id=[guid]::NewGuid().ToString('N');$script:Run.State=@{Approval=[pscustomobject]@{SchemaCompatibilityVerified=$true}};$script:Run.Receipt=[ordered]@{Kind='Rollback';Mode='Execute';Operation=$script:Run.Id;PlanSHA256=(Hash (Join-Path $TargetRoot KIT-PLAN.json));Result='PREPARED';Phase='';Completed=@();MutationBegun=$false;Error=$null;BarrierError=$null;ObservationError=$null;WrittenHashes=@{}}
 LoadProduction $script:Run;InstallBoundaries;Set-Item Function:global:Get-ReleaseRegistryState (Get-Command FixtureReleaseState).ScriptBlock
 $inputs=[pscustomobject]@{DeploymentReceipt=$receiptPath};$driver=NewNativeDriver $script:Run $inputs
 $e=$null;try{[void](Invoke-KitSequence @('Guard') $driver $script:Run.Receipt)}catch{$e=$_.Exception.Message}
 if($Variant -ceq 'Exact'){
  Need ($null -eq $e -and $script:Run.Receipt.AdoptedWorldStopProof.NoNewStop) ('ROLLBACK_DID_NOT_ADOPT '+$e);Assert-BackendQuiescent mangosd
  if(!$Before){RunSequence @('StopWorld','StopRealm');Need ($script:Models.mangosd.StopRequests -eq 1 -and $script:Models.realmd.StopRequests -eq 1 -and $script:Run.Receipt.'ReusedBackendStopProof_realmd'.NoNewStop) 'ROLLBACK_REPEATED_PREVIOUS_STOP'}
 }
 else{Need ($null -ne $e -and $script:Models['VMANGOS-MySQL'].StopRequests -eq 0 -and $script:Reboots -eq 0) ('ROLLBACK_ACCEPTED_'+$Variant)}
}
if(!$OnlyBarrier){Case 'StopAll_full_actual_chain' 'Migrate' 'Happy' {
 [void](Stack Stop-All)
 Need ($script:Models.mangosd.StopRequests -eq 1 -and $script:Models.realmd.StopRequests -eq 1 -and $script:Models['VMANGOS-MySQL'].StopRequests -eq 1) 'FULL_STOP_CHAIN_NOT_COMPLETED'
 Need ($script:Opened -eq 4 -and $script:Disposed -eq 4) 'HANDLES_NOT_RETAINED_OR_DISPOSED'
}}
Case 'Migrate_failure_real_barrier_then_new_rollback' 'Migrate' 'Happy' {MigrateFailureAndRollback}
if(!$Before){
 Case 'PlannedReboot_actual_chain_checkpoint_once_fixture_request' 'Migrate' 'Happy' {
  [void](Stack Planned-Reboot)
  $claim=ReadJson (Join-Path $script:Run.Plan.Maintenance planned-reboot-claim.json)
  Need ($script:Reboots -eq 1 -and $claim.Phase -ceq 'REQUEST_ACCEPTED_BOOT_NOT_VERIFIED' -and $claim.Resume.Desired -and (Test-Path $claim.Checkpoint.Path)) 'REBOOT_CLAIM_CHECKPOINT_OR_REQUEST'
  $e=$null;try{[void](Stack Planned-Reboot)}catch{$e=$_.Exception.Message};Need ($e -and $script:Reboots -eq 1) 'REBOOT_REPEATED'
 }
 foreach($action in @('Stop-All','Planned-Reboot')){foreach($target in @('mangosd','realmd')){foreach($fault in @('Nonzero','Unknown','Timeout','Observation')){
  $script:RequestedAction=$action
  Case ($action+'_'+$target+'_'+$fault) 'Migrate' ($target+'_'+$fault) {
   $e=$null;try{[void](Stack $script:RequestedAction)}catch{$e=$_.Exception.Message}
   Need ($null -ne $e -and $script:Models['VMANGOS-MySQL'].StopRequests -eq 0 -and $script:Reboots -eq 0 -and $script:Opened -eq $script:Disposed) 'FAIL_ADVANCED_OR_HANDLE_LEAK'
   if($script:FaultTarget -ceq 'mangosd'){Need ($script:Models.realmd.StopRequests -eq 0) 'WORLD_FAILURE_ADVANCED'}
  }
 }}}
 foreach($variant in @('OtherOperation','ManualDecision','Generation','Unknown','Nonzero')){$script:Variant=$variant;Case ('FailureBarrier_rollback_refuses_'+$variant) 'Migrate' 'Happy' {MigrateFailureAndRollback $script:Variant}}
}
$failed=@($script:Results.ToArray()|Where-Object Result -cne 'PASS')
$tested=@(foreach($f in @('controller\VMANGOS-Control.ps1','controller\Maintenance.psm1','controller\Production.Driver.ps1','Production.ps1','Safety.R2.ps1','Native.Driver.ps1','Workflow.psm1','Test-Integration-Fix4R2.ps1')){[pscustomobject]@{Path=$f;SHA256=(Hash (Join-Path $TargetRoot $f))}})
SaveJson $script:ResultName @{Result=$(if($failed.Count){'FAIL'}else{'PASS'});Tests=$script:Results.ToArray();Total=$script:Results.Count;Passed=$script:Results.Count-$failed.Count;Target=$TargetRoot;Before=[bool]$Before;TestedFiles=$tested;Boundary='Actual loader, public controller wrappers, Invoke-ControlStack/Invoke-ControlledStop, dependency validator, retained engine, NewNativeDriver/Invoke-KitSequence, real Gate/task state handling/file backup/Driver.Barrier/adoption/receipt Guard. Individual SCM/CIM/listener and scheduled task calls, SQL/dump function and registry-state read are explicit fixtures. Reboot-native seam only fixture. Processes/handles are actual self-terminating owned cmd copies. No service controls, real SQL or OS request.';PS=$PSVersionTable.PSVersion.ToString();Edition=$PSVersionTable.PSEdition;X64=[Environment]::Is64BitProcess}
if($failed.Count){exit 1}

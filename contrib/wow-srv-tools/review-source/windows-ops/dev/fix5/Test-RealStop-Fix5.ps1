param([string]$TargetRoot=$PSScriptRoot,[string]$RunTag='REAL-STOP-FINAL-R3',[switch]$Before,[switch]$OnlyMigration)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $TargetRoot Kit.Common.ps1)
. (Join-Path $TargetRoot Native.Driver.ps1)
$script:HarnessRoot=$TargetRoot
$script:Out='C:\GRY\wow\diagnostics\SHUTDOWN1053-DEV-MIGRATION-PREP-R2-FIX5-WOW-SRV-20261108-1818'
$script:RealCim=Get-Command Get-CimInstance -CommandType Cmdlet
$script:OriginalTransport=(Get-Command New-ProcessIdentityTransportFix2).ScriptBlock
$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $TargetRoot Test-Production-Fix4.ps1),[ref]$t,[ref]$e)
foreach($f in $ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}){. ([scriptblock]::Create($f.Extent.Text.Replace('$PSScriptRoot','$script:HarnessRoot')))}
$script:BaseInitialize=(Get-Command InitializeCase).ScriptBlock
$script:BaseSpawn=(Get-Command SpawnChild).ScriptBlock
$writerCommand=Get-Command Write-StopProcessExitFix5 -ErrorAction SilentlyContinue
$script:ActualProcessWriter=$(if($null -ne $writerCommand){$writerCommand.ScriptBlock}else{$null})
$script:ActualStageWriter=(Get-Command Write-StopStageFix3).ScriptBlock
$script:Results=[Collections.Generic.List[object]]::new();$script:Skip=@{}
$script:TestsRoot=Join-Path $Out $RunTag;Need (!(Test-Path $TestsRoot)) 'UNIQUE_TEST_RUN_REQUIRED';[void][IO.Directory]::CreateDirectory($TestsRoot)
function SpawnChild([string]$Name,[int]$Code=0){
 $c=& $script:BaseSpawn $Name $Code
 $c|Add-Member -NotePropertyName KnownExited -NotePropertyValue $false
 $c|Add-Member -NotePropertyName LauncherReleased -NotePropertyValue $false
 return $c
}
function Get-CimInstance([string]$ClassName,[string]$Filter,$ErrorAction){
 if($ClassName -ceq 'Win32_OperatingSystem'){return [pscustomobject]@{LastBootUpTime=[DateTime]::UtcNow.AddHours(-1)}}
 if($ClassName -ceq 'Win32_Service'){
  $name=[regex]::Match($Filter,"Name='([^']+)'").Groups[1].Value;Need ($script:Models.ContainsKey($name)) 'FIXTURE_SERVICE_ONLY'
  $m=$script:Models[$name]
  if($name -ceq 'mangosd' -and $m.StopRequests -gt 0 -and $script:Scenario -ceq 'ObservationError'){throw 'INJECTED_SCM_OBSERVATION_ERROR_AFTER_EXIT'}
  $live=@($m.Children|Where-Object {!$_.KnownExited});$number=$(if($live.Count){[uint32]$live[0].PID}else{[uint32]0})
  $image=$(if($name -ceq 'VMANGOS-MySQL'){$m.Exe+' --defaults-file='+$m.Config+' '+$name}else{$m.Exe+' -s run -c '+$m.Config})
  return [pscustomobject]@{Name=$name;State=$(if(!$live.Count){'Stopped'}else{$m.State});ProcessId=$number;StartMode=$m.Mode;PathName=$image;StartName='LocalSystem';ExitCode=$m.Win32;ServiceSpecificExitCode=$m.Specific}
 }
 Need ($ClassName -ceq 'Win32_Process') 'CIM_CLASS_ALLOWLIST'
 # Actual Win32_Process query. Restrict ONLY to own fixture PIDs; do not filter by
 # HasExited, synthesize rows, rewrite dates or hide retained CIM records.
 $clauses=@($script:AllChildren|ForEach-Object {'ProcessId='+$_.PID})
 if(!$clauses.Count){return}
 $actualFilter='('+($clauses -join ' OR ')+') AND ('+$Filter+')'
 $data=@(& $script:RealCim Win32_Process -Filter $actualFilter -ErrorAction Stop)
 $script:ActualCimReads++
 if($Filter -ceq "Name='mangosd.exe'" -and $null -ne $script:DelayedCim -and $script:DelayedCim.Remaining -gt 0){
  $script:DelayedCim.Remaining--
  $script:Trace.Add([pscustomobject]@{Event='DELAYED_DELIVERY_ACTUAL_CIM_SNAPSHOT';AcquiredUtc=$script:DelayedCim.AcquiredUtc;DeliveredUtc=[DateTimeOffset]::UtcNow.ToString('o');FreshQueryCount=$data.Count;RowsUnmodified=$true})
  return $script:DelayedCim.Rows
 }
 return $data
}
function ReleaseLauncher($Child){
 if($Child.LauncherReleased){return}
 Need ($Child.Process.WaitForExit(5000)) 'FIXTURE_SELF_EXIT_WAIT'
 $code=[uint32]0;Need ([AfterBootRepairR2.Native]::GetExitCodeProcess($Child.Handle,[ref]$code)) 'FIXTURE_LAUNCHER_NATIVE_UNKNOWN'
 $prefix=Join-Path $script:CaseDir ('launcher-'+$Child.PID)
 [IO.File]::WriteAllText(($prefix+'.stdout.log'),$Child.OutTask.GetAwaiter().GetResult())
 [IO.File]::WriteAllText(($prefix+'.stderr.log'),$Child.ErrTask.GetAwaiter().GetResult())
 PutJson ($prefix+'.process.json') @{PID=$Child.PID;ExitCode=[long]$code;MeasuredBeforeDispose=$true;Channel='Fixture launcher, independent of coordinator measurement'}
 $Child.KnownExited=$true;$Child.Process.Dispose();$Child.LauncherReleased=$true
}
function RequestFixtureStop([string]$Name){
 $m=$script:Models[$Name];$m.StopRequests++;Need ($m.StopRequests -eq 1) 'NO_SECOND_STOP'
 $m.State='Stop Pending';$script:Trace.Add([pscustomobject]@{Event='STOP_BOUNDARY';Name=$Name;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')})
 if($Name -ceq 'mangosd' -and $script:Scenario -ceq 'TimeoutUnknown'){return}
 foreach($c in $m.Children){
  $captured=@(& $script:RealCim Win32_Process -Filter ('ProcessId='+$c.PID) -ErrorAction Stop)
  $capturedUtc=[DateTimeOffset]::UtcNow.ToString('o');Need ($captured.Count -eq 1) 'REAL_CIM_BEFORE_EXIT_REQUIRED'
  [IO.File]::WriteAllText($c.Signal,'SELF_EXIT');Need ($c.Process.WaitForExit(5000)) 'SAFE_SELF_EXIT'
  # Release the harness's own launcher handle. Only coordinator leases remain.
  ReleaseLauncher $c
  $retained=@(& $script:RealCim Win32_Process -Filter ('ProcessId='+$c.PID) -ErrorAction Stop)
  $script:Witness.Add([pscustomobject]@{Name=$Name;PID=$c.PID;FreshCimAfterExitCount=$retained.Count;ActualEarlierCimRecordRetained=$true;Path=$captured[0].ExecutablePath;CreatedUtc=$captured[0].CreationDate.ToUniversalTime().ToString('o');CapturedUtc=$capturedUtc;CoordinatorOwnHandleStillOpen=($script:Opened -gt $script:Disposed);AtUtc=[DateTimeOffset]::UtcNow.ToString('o')})
  if($Name -ceq 'mangosd' -and ($Before -or $script:Scenario -ceq 'DelayedCim')){
   # Explicit response-delivery fault injection, NOT a claim that this provider
   # naturally enumerates an ended process. Use the unmodified real CIM object.
   $script:DelayedCim=[pscustomobject]@{Rows=$captured;AcquiredUtc=$capturedUtc;Remaining=$(if($Before){5}else{1})}
  }
 }
 $m.State='Stopped'
 if($Name -ceq 'mangosd' -and $script:Scenario -in @('NewGeneration','ForeignProcess')){
  if($script:Scenario -ceq 'ForeignProcess'){
   $originalExe=$m.Exe;$foreign=Join-Path $script:CaseDir foreign;[void][IO.Directory]::CreateDirectory($foreign);$m.Exe=Join-Path $foreign mangosd.exe;Copy-Item C:\Windows\System32\cmd.exe $m.Exe
  }
  [void](SpawnChild $Name);$m.State='Stopped'
  if($script:Scenario -ceq 'ForeignProcess'){$m.Exe=$originalExe}
 }
}
function CountingTransport {
 @{
  Open={param($n)$script:Opened++;& ((& $script:OriginalTransport).Open) $n}
  Read={param($p)& ((& $script:OriginalTransport).Read) $p}
  Dispose={param($p)$number=$p.Id;$script:Disposed++;$p.Dispose();if($script:Scenario -ceq 'CleanupError' -and $script:WorldPids -contains $number){throw 'INJECTED_DISPOSE_ERROR_AFTER_ACTUAL_CLOSE'}}
 }
}
function Write-StopProcessExitFix5([string]$Path,$Row){
 if($script:Scenario -ceq 'EvidenceError' -and $script:WorldPids -contains $Row.PID){throw 'INJECTED_PROCESS_EVIDENCE_WRITE_ERROR'}
 & $script:ActualProcessWriter $Path $Row
}
function Write-StopStageFix3([string]$Path,$Row){
 if($script:Scenario -ceq 'StageWriteError' -and $Row.Name -ceq 'mangosd'){throw 'INJECTED_STAGE_WRITE_ERROR'}
 & $script:ActualStageWriter $Path $Row
}
function InitializeCase([string]$Label,[string]$Kind,[string]$Scenario){
 $script:ActualCimReads=0;$script:Witness=[Collections.Generic.List[object]]::new();$script:WorldPids=@();$script:DelayedCim=$null
 & $script:BaseInitialize $Label $Kind $Scenario
 $script:WorldPids=@($script:Models.mangosd.Children.PID)
 # Production loader reinstalls functions: instrument just file-write boundaries
 # after its return; preserve real producer, callbacks and observer.
 if(!$Before){
  $script:ActualProcessWriter=(Get-Command Write-StopProcessExitFix5).ScriptBlock
  $script:ActualStageWriter=(Get-Command Write-StopStageFix3).ScriptBlock
  Set-Item Function:script:Write-StopProcessExitFix5 ${function:FixtureProcessWriter}
  Set-Item Function:script:Write-StopStageFix3 ${function:FixtureStageWriter}
 }
 $factory=Get-Command New-ProductionWorldDriver
 if(!$Before){Need ($factory.ScriptBlock.File -ceq (Join-Path $TargetRoot 'controller\Production.Driver.ps1')) 'POST_LOADER_FACTORY_ORIGIN'}
 $callbacks=@(foreach($n in @('Read','Stop','Disable','Ready','DeferStopWait')){
  if($script:Run.State.WorldDriver.ContainsKey($n)){$s=$script:Run.State.WorldDriver[$n];[pscustomobject]@{Name=$n;Source=$s.File;Body=$s.ToString()}}
 })
 if(!$Before){foreach($c in $callbacks){Need ($c.Source -ceq (Join-Path $TargetRoot 'controller\Production.Driver.ps1')) ('CALLBACK_ORIGIN '+$c.Name)}}
 PutJson (Join-Path $CaseDir LOADER-PROVENANCE.json) @{FactorySource=$factory.ScriptBlock.File;FactorySHA256=(Hash (Join-Path $TargetRoot 'controller\Production.Driver.ps1'));Callbacks=$callbacks;AfterCompleteLoaderReturn=$true;ControllerEntryExecuted=$false}
}
function FixtureProcessWriter([string]$Path,$Row){
 if($script:Scenario -ceq 'EvidenceError' -and $script:WorldPids -contains $Row.PID){throw 'INJECTED_PROCESS_EVIDENCE_WRITE_ERROR'}
 & $script:ActualProcessWriter $Path $Row
}
function FixtureStageWriter([string]$Path,$Row){
 if($script:Scenario -ceq 'StageWriteError' -and $Row.Name -ceq 'mangosd'){throw 'INJECTED_STAGE_WRITE_ERROR'}
 & $script:ActualStageWriter $Path $Row
}
function FinishCase {
 foreach($c in $script:AllChildren){if(!$c.LauncherReleased){[IO.File]::WriteAllText($c.Signal,'CLEANUP_SELF_EXIT');ReleaseLauncher $c}}
 foreach($c in $script:AllChildren){Need (@(& $script:RealCim Win32_Process -Filter ('ProcessId='+$c.PID)).Count -eq 0) 'FIXTURE_PROCESS_OR_HANDLE_REMAINS'}
 PutJson (Join-Path $CaseDir REAL-CIM-RETAINED-WITNESS.json) $script:Witness.ToArray()
 PutJson (Join-Path $CaseDir BOUNDARY-TRACE.json) $script:Trace.ToArray()
}
function TestCase([string]$Label,[string]$Route,[string]$Scenario){
 $errorText=$null;$testError=$null;$opError=$null;$world=$null
 try{
  InitializeCase $Label Migrate $Scenario
  try{
   if($Route -ceq 'StopAll'){$scope=$script:Run.State.MaintenanceScope;$scope.Operation=$null;$scope.Action=$null;$script:WorldDriver.PollMilliseconds=50;[void](Invoke-StopAll -TimeoutSeconds 2)}
   else{RunSequence @('StopWorld','StopRealm','StopMySQL')}
  }catch{$opError=$_;$errorText=$_.Exception.Message}
  $mustFail=$Before -or $Scenario -cnotin @('Happy','DelayedCim')
  Need ($mustFail -eq ($null -ne $errorText)) ('WRONG_OPERATION_RESULT '+$Label+' '+$errorText)
  if($mustFail){Need ($script:Models.realmd.StopRequests -eq 0 -and $script:Models['VMANGOS-MySQL'].StopRequests -eq 0) 'DEPENDENCY_NOT_BLOCKED'}
  else{Need ($script:Models.mangosd.StopRequests -eq 1 -and $script:Models.realmd.StopRequests -eq 1 -and $script:Models['VMANGOS-MySQL'].StopRequests -eq 1) 'FULL_CHAIN_NOT_STOPPED'}
  Need ($script:Opened -eq $script:Disposed) 'HANDLE_COUNT_MISMATCH'
  $outcomes=@(Get-ChildItem $script:CaseDir -Recurse -Filter OUTCOME.json|ForEach-Object {ReadJson $_.FullName}|Where-Object Name -ceq 'mangosd')
  Need ($outcomes.Count -eq 1) 'WORLD_OUTCOME_MISSING'
  $world=$outcomes[0]
  if($Scenario -ceq 'TimeoutUnknown'){Need ($world.ProcessExits[0].Measurement -ceq 'UNKNOWN' -and $null -eq $world.ProcessExits[0].NativeExit) 'UNKNOWN_REWRITTEN'}
  else{Need ($world.ProcessExits[0].Measurement -ceq 'MEASURED' -and $world.ProcessExits[0].NativeExit -eq $(if($Scenario -ceq 'Nonzero'){7}else{0})) 'ACTUAL_NATIVE_RESULT_NOT_RETAINED'}
  if(!$mustFail){Need ($world.TerminalObservationAfterRelease -and [DateTimeOffset]::Parse($world.MeasuredBeforeDisposeUtc) -le [DateTimeOffset]::Parse($world.OwnHandlesReleasedUtc) -and [DateTimeOffset]::Parse($world.OwnHandlesReleasedUtc) -le [DateTimeOffset]::Parse($world.PostReleaseObservationUtc)) 'MEASURE_RELEASE_CONFIRM_ORDER'}
  if($Scenario -ceq 'NewGeneration'){Need ($errorText -match 'PROCESS_GENERATION_CHANGED') 'NEW_GENERATION_GUARD_NOT_EXERCISED'}
  if($Scenario -ceq 'ForeignProcess'){Need ($errorText -match 'FOREIGN_IMAGE_PROCESS') 'FOREIGN_PROCESS_GUARD_NOT_EXERCISED'}
  if($Before){Need ($errorText -match 'WORLD_OBSERVATION_AMBIGUOUS_BUDGET_EXHAUSTED' -and $world.ProcessExits[0].NativeExit -eq 0 -and $Witness.Count -gt 0) 'OLD_REGRESSION_NOT_REPRODUCED'}
 }catch{$testError=$_.Exception.ToString()+' '+$_.InvocationInfo.PositionMessage}
 finally{try{FinishCase}catch{if($null -eq $testError){$testError=$_.Exception.ToString()}}}
 $script:Results.Add([pscustomobject]@{Name=$Label;Result=$(if($testError){'FAIL'}else{'PASS'});TestError=$testError;OperationError=$errorText;OperationResult=$(if($null -ne $errorText){'FAIL'}else{'PASS'});Opened=$script:Opened;Disposed=$script:Disposed;WorldStops=$script:Models.mangosd.StopRequests;RealmStops=$script:Models.realmd.StopRequests;MySQLStops=$script:Models['VMANGOS-MySQL'].StopRequests;RealCimReads=$ActualCimReads;WitnessCount=$Witness.Count;WorldOutcome=$world;Route=$Route;Fixture=$CaseDir})
 Write-Host ($script:Results[$script:Results.Count-1].Result+' '+$Label+' '+$testError)
 PutJson (Join-Path $Out ($RunTag+'.json')) @{Result='IN_PROGRESS';Tests=$script:Results.ToArray()}
 Need (!$testError) ('TEST_CASE_FAILED '+$Label)
}
if($Before){TestCase Old_delayed_actual_CIM_native0_deadlock Migrate Happy}
else{
 foreach($route in @('Migrate','StopAll')){
  foreach($scenario in @('Happy','DelayedCim','Nonzero','TimeoutUnknown','ObservationError','NewGeneration','ForeignProcess','EvidenceError','CleanupError','StageWriteError')){TestCase ($route+'_'+$scenario) $route $scenario}
 }
}
$files=@(foreach($n in @('Production.ps1','controller\Production.Driver.ps1','controller\Maintenance.psm1','controller\VMANGOS-Control.ps1','Native.Driver.ps1','Workflow.psm1','Test-RealStop-Fix5.ps1')){$p=Join-Path $TargetRoot $n;if(Test-Path $p){[pscustomobject]@{Path=$n;SHA256=(Hash $p)}}})
PutJson (Join-Path $Out ($RunTag+'.json')) @{Result='PASS';Total=$Results.Count;Passed=$Results.Count;Tests=$Results.ToArray();TestedFiles=$files;PS=$PSVersionTable.PSVersion.ToString();Edition=$PSVersionTable.PSEdition;X64=[Environment]::Is64BitProcess;Boundary='Real own cmd.exe copies, real Get-CimInstance Win32_Process and native handles/GetExitCodeProcess. Query restricted to fixture PIDs, never HasExited-filtered. DelayedCim and BEFORE explicitly delay delivery of an unmodified earlier actual CIM snapshot; fresh post-exit counts are recorded and may be zero. This is controlled read-delivery instrumentation, not a claim of natural provider retention. SCM, tasks/registry/SQL controls are fixture. Full real loader, driver, observer, Maintenance, Stop-All and migration sequencer. File writes/Dispose fault-injected only in named cases. No kill or live controls.'}
"OK=True";'CHANGE_SCOPE=REAL_PROCESS_BOUNDARY_ISOLATED';'LOG='+$Out;'NEXT_STEP=Task baseline tests and read-only migration preflight'

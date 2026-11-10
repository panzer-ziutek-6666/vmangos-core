function Import-ProductionFunctionsFix4([string]$Relative){
 Need ($Relative -cin @('controller\VMANGOS-Control.ps1','controller\Production.Driver.ps1','controller\World.Markers.ps1','dependencies\Collector.Repair.ps1','dependencies\ReadCollector.R2.ps1')) 'PRODUCTION_IMPORT_ALLOWLIST'
 $path=Join-Path $PSScriptRoot $Relative;$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($path,[ref]$t,[ref]$e);Need (@($e).Count -eq 0) 'PRODUCTION_IMPORT_SYNTAX'
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($node in $ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}){
  Need ($node.Name -cmatch '^[A-Za-z][A-Za-z0-9_-]*$' -and $seen.Add($node.Name)) 'PRODUCTION_IMPORT_NAME'
  # Preserve File/Extent for param-block functions (notably the real factory and
  # its callbacks). Header-parameter functions must retain their parameter list.
  if($null -ne $node.Parameters -and $node.Parameters.Count -gt 0){
   $definition=[regex]::Replace($node.Extent.Text,'^function\s+'+[regex]::Escape($node.Name)+'\b',('function script:'+$node.Name),1)
   . ([scriptblock]::Create($definition))
  }else{Set-Item -LiteralPath ('Function:script:'+$node.Name) -Value $node.Body.GetScriptBlock()}
 }
}
function New-ProductionReleaseContextFix4($Run){New-ReleaseContext $Run.Plan.Registry $Run.Plan.Runtime 'C:\ProgramData\VMANGOS\AdminPanelTelemetry\snapshot.json'}
function LoadProduction($Run){
 Import-ProductionFunctionsFix4 'controller\VMANGOS-Control.ps1'
 Import-ProductionFunctionsFix4 'controller\Production.Driver.ps1'
 Import-ProductionFunctionsFix4 'controller\World.Markers.ps1'
 $script:Runtime=$Run.Plan.Runtime;$script:MySqlRoot=[IO.Path]::GetDirectoryName($Run.Plan.MySQLBin);$script:MySqlExe=Join-Path $Run.Plan.MySQLBin 'mysqld.exe';$script:MySqlClient=Join-Path $Run.Plan.MySQLBin 'mysql.exe';$script:MangosdExe=Join-Path $Run.Plan.Runtime 'mangosd.exe';$script:RealmdExe=Join-Path $Run.Plan.Runtime 'realmd.exe';$script:MangosdConf=Join-Path $Run.Plan.Runtime 'mangosd.conf';$script:MySqlService='VMANGOS-MySQL';$script:RealmdService='realmd';$script:MangosdService='mangosd';$script:Log=$Run.Log;$script:Json=$true;$script:StartedThisRun=[Collections.Generic.List[string]]::new()
 $module=Import-Module (Join-Path $PSScriptRoot 'controller\Maintenance.psm1') -PassThru -Force -Global
 $scope=@{Operation=$Run.Id;Action=$Run.Kind;Root=$Run.Plan.Maintenance;Permit=$null;StartAuthorized=$false}
 $driver=New-ProductionWorldDriver -RuntimeRoot $Run.Plan.Runtime -LogPath (Join-Path $Run.Plan.Runtime 'logs\Server.log') -MaintenanceScope $scope -ObservationLog (Join-Path $Run.Out 'world-observations.jsonl')
 $Run.State.MaintenanceScope=$scope
 $script:MaintenanceRoot=$Run.Plan.Maintenance;$script:WorldDriver=$driver;$script:Diagnostics=$Run.Out;$Run.State.Module=$module;$Run.State.WorldDriver=$driver;$Run.State.Context=[pscustomobject]@{Root=$Run.Plan.Maintenance;Service='mangosd';Driver=$driver;Action=$Run.Kind;Operation=$Run.Id;Timeout=900;PollMs=2000;StopRequests=[Collections.Generic.HashSet[string]]::new()}
 Import-Module (Join-Path $PSScriptRoot 'dependencies\Release.Contract.psm1') -Force -Global -DisableNameChecking
 $Run.State.Release=New-ProductionReleaseContextFix4 $Run
 Import-ProductionFunctionsFix4 'dependencies\Collector.Repair.ps1';Import-ProductionFunctionsFix4 'dependencies\ReadCollector.R2.ps1'
 $script:CollectorReadTraceR2=$null
}
function ProductionStopWorld($Run){
 $m=$Run.State.Module;& $m {param($c)[void](Enter-ControlMaintenance $c 'MigrationOrLifecycleStop')} $Run.State.Context
}
function ProductionStartWorld($Run){
 $m=$Run.State.Module;$world=& $m {param($c)Start-ControlWorld $c $true} $Run.State.Context
 $status=Get-CurrentStatus -ExpectedWorldGeneration $world.Generation;Need ($status.Ready -is [bool] -and $status.Ready) 'WORLD_FINAL_READY'
 $Run.State.WorldGeneration=$world.Generation
}
function WaitKitSamples($Run,$Reference){
 $seen=New-Object Collections.Generic.HashSet[string];$timer=[Diagnostics.Stopwatch]::StartNew()
 do{
  try{$read=ReadCollector}catch{if($_.Exception.Message -notmatch 'stable receipt|RELEASE_TRANSITION|COLLECTOR_READ_TRANSIENT_TIMEOUT|Collector section|RELEASE_STALE|RELEASE_WORLD_UNAVAILABLE'){throw};$read=$null}
  if($null -ne $read){
   Need ($read.ReleaseState.active.id -ceq $Reference.id -and $read.ReleaseState.active.sha256 -ceq $Reference.sha256) 'COLLECTOR_RELEASE_MISMATCH'
   $collected=([DateTimeOffset]::Parse($read.Sample.collectedAtUtc)).ToUniversalTime();$world=Get-CimInstance Win32_Service -Filter "Name='mangosd'";$proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$world.ProcessId)
   Need ($read.Sample.world.processId -eq $proc.ProcessId -and ([DateTimeOffset]::Parse($read.Sample.world.createdUtc)).ToUniversalTime() -eq [DateTimeOffset]::new($proc.CreationDate.ToUniversalTime())) 'COLLECTOR_GENERATION_CHANGED'
   Need ($collected -ge ([DateTimeOffset]::Parse($Run.Receipt.StartedUtc)).ToUniversalTime() -and ([DateTimeOffset]::UtcNow-$collected).TotalSeconds -le 30) 'COLLECTOR_NOT_FRESH_FOR_OPERATION'
   if($seen.Add($collected.ToString('o'))){PutJson (Join-Path $Run.Out ('COLLECTOR-SAMPLE-'+$seen.Count+'.json')) $read}
   if($seen.Count -ge 2){break}
  }
  Need ($timer.Elapsed.TotalSeconds -lt 180) 'COLLECTOR_SAMPLES_TIMEOUT';Start-Sleep -Seconds 2
 }while($true)
 $Run.State.FreshSamples=2
}
function SetControlTasks($Run,[bool]$Restore){SetControlTasksR2 $Run $Restore}
function BackupKitFiles($Run){
 $dir=Join-Path $Run.Plan.BackupRoot ($Run.Id+'-files');NewPrivate $dir
 $rows=@(foreach($f in $Run.Plan.Files){$exists=Test-Path $f.Target;$target=Join-Path $dir ($f.Id+'.bak');$h=$null;$sddl=$null;$identity=$null
  if($exists){$h=Hash $f.Target;$sddl=(Get-Acl -LiteralPath $f.Target).Sddl;$identity=[AdminInstallV1.Files]::Identity($f.Target);[IO.File]::Copy($f.Target,$target,$false);Need ((Hash $target) -ceq $h -and (Hash $f.Target) -ceq $h) 'FILE_BACKUP_RACE'}
  [pscustomobject]@{Id=$f.Id;Target=$f.Target;BeforeExists=$exists;Backup=$target;BeforeSHA256=$h;BeforeSDDL=$sddl;BeforeFileId=$identity;ExpectedNewSHA256=$f.SHA256;Source=$f.Source}
 })
 $Run.Receipt.FileBackup=[pscustomobject]@{Root=$dir;Files=$rows};DurableJson (Join-Path $dir 'BACKUP-MANIFEST.json') $Run.Receipt.FileBackup
 $Run.Receipt.BeforeRegistry=Get-ReleaseRegistryState $Run.State.Release
}
function WriteBoundFile($Run,$File){
 NoReparse $File.Source;NoReparse $File.Target;Need ((Hash $File.Source) -ceq $File.SHA256) 'BOUND_FILE_SOURCE'
 if(Test-Path $File.Target){
  $acl=(Get-Acl -LiteralPath $File.Target).Sddl;$identity=[AdminInstallV1.Files]::Identity($File.Target)
  $s=[IO.File]::Open($File.Source,'Open','Read','Read');$t=[IO.File]::Open($File.Target,'Open','Write','None');try{$t.SetLength(0);$s.CopyTo($t);$t.Flush($true)}finally{$t.Dispose();$s.Dispose()}
  Need ((Get-Acl -LiteralPath $File.Target).Sddl -ceq $acl -and [AdminInstallV1.Files]::Identity($File.Target) -ceq $identity) 'FILE_ID_OR_ACL_CHANGED'
 }else{[IO.File]::Copy($File.Source,$File.Target,$false)}
 Need ((Hash $File.Target) -ceq $File.SHA256) 'BOUND_FILE_WRITE_HASH'
}
function SetProductionBarrier($Run){
 $errors=[Collections.Generic.List[string]]::new()
 try{SetControlTasksR2 $Run $false}catch{$errors.Add($_.Exception.Message)}
 try{RetainWorldBarrierR2 $Run}catch{$errors.Add($_.Exception.Message)}
 Need ($errors.Count -eq 0) ('PRODUCTION_BARRIER_INCOMPLETE '+($errors -join ' | '))
 # No STOP/START/DB restore/OS request in failure handling.
}function ProductionRetainedStop($Run,[string]$Name,[ValidateRange(1,900)][int]$TimeoutSeconds=180){
 if($Run.State.ContainsKey('Context')){
  $limit=[int]$Run.State.Context.Timeout;Need ($limit -ge 1 -and $limit -le 900) 'STOP_CONTEXT_TIMEOUT_RANGE'
  $TimeoutSeconds=[Math]::Min($TimeoutSeconds,$limit)
 }
 if($Name -cne 'mangosd'){
  $current=Get-BackendStopObservation $Name
  if($current.Terminal){
   Need ($Run.Kind -ceq 'Rollback' -and $Run.State.ContainsKey('AdoptedFailureBarrier')) 'BACKEND_STOPPED_WITHOUT_BOUND_NATIVE_PROOF'
   $binding=$Run.Receipt.AdoptedWorldStopProof.FailureBarrierBinding
   $sealed=Read-WorldFailureBarrierFix4R2 $binding $Run.State.MaintenanceScope.Permit
   $result=Get-StopFieldFix3 $sealed.BackendStopProofs $Name
   Need ($null -ne $result -and $result.ControlOperation -ceq $sealed.Operation) 'BACKEND_PRIOR_STOP_OPERATION'
   Assert-DependencyStopResult $result $Name;Assert-BackendQuiescent $Name
   $definition=Get-BackendStopDefinitionFix3 $Name
   foreach($p in $result.ExpectedProcesses){Need ($p.Path -ceq $definition.Exe) 'BACKEND_PRIOR_STOP_IMAGE'}
   $Run.Receipt['ReusedBackendStopProof_'+$Name]=[pscustomobject]@{SourceOperation=$sealed.Operation;FailureBarrier=$binding;MeasuredResult=$result;NoNewStop=$true;CurrentTerminal=$current}
  }else{$result=Stop-BackendService $Name $TimeoutSeconds -EvidenceBase $Run.Out;Assert-DependencyStopResult $result $Name;$result|Add-Member -NotePropertyName ControlOperation -NotePropertyValue $Run.Id -Force}
  if(!$Run.Receipt.Contains('BackendStopProofs')){$Run.Receipt.BackendStopProofs=@{}};$Run.Receipt.BackendStopProofs[$Name]=$result;return
 }
 $existing=Get-BackendStopObservation $Name
 if($existing.Terminal -and $Run.State.ContainsKey('MaintenanceScope') -and $null -ne $Run.State.MaintenanceScope.Permit){
  $permit=$Run.State.MaintenanceScope.Permit
  Assert-BackendQuiescent $Name;Assert-DependencyStopResult $permit.Completion.Outcome $Name
  $Run.Receipt.WorldMaintenanceProof=$permit;return
 }
 if($Run.State.ContainsKey('Context')){
  $initial=Get-BackendStopObservation $Name;$expected=$null
  if($initial.State -ceq 'Running'){$row=@($initial.Processes|Where-Object PID -eq $initial.PID);Need ($row.Count -eq 1) 'WORLD_INITIAL_GENERATION_REQUIRED';$expected=[string]$initial.PID+'|'+$row[0].CreatedUtc}
  $Run.State.Context|Add-Member -NotePropertyName ExpectedStopGeneration -NotePropertyValue $expected -Force
 }
 $strict={param($j)Get-BackendStopObservation $Name -Journal $j}.GetNewClosure()
 $transition={param($j,$expected)Get-BackendStopObservation $Name -Transition -Expected $expected -Journal $j}.GetNewClosure()
 $request={ProductionStopWorld $Run}.GetNewClosure()
 $scope=$null;if($Run.State.ContainsKey('MaintenanceScope')){$scope=$Run.State.MaintenanceScope;$scope.OuterRetainedCoordinator=$true}
 try{$result=Invoke-RetainedStopFix3 $Name $strict $transition $request {} $Run.Out (Join-Path $Run.Out ($Name+'-ACTUAL-STOP.json')) $TimeoutSeconds}
 finally{if($null -ne $scope){$scope.OuterRetainedCoordinator=$false};if($Run.State.ContainsKey('Context')){$Run.State.Context.ExpectedStopGeneration=$null}}
 if($Run.State.ContainsKey('MaintenanceScope') -and $null -ne $Run.State.MaintenanceScope.Permit){
  $permit=$Run.State.MaintenanceScope.Permit
  if(@($result.ProcessExits).Count -gt 0){
   Need ((Test-WorldMaintenancePermitFix4 (Get-BackendStopDefinitionFix3 $Name)) -and @($result.ProcessExits).Count -eq 1 -and $result.ProcessExits[0].PID -eq $permit.PID -and $result.ProcessExits[0].Path -ceq $permit.Exe -and ([DateTimeOffset]::Parse($result.ProcessExits[0].CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($permit.CreatedUtc)).UtcTicks -and $result.ProcessExits[0].Measurement -ceq 'MEASURED' -and $null -ne $result.ProcessExits[0].NativeExit -and $result.ProcessExits[0].NativeExit -eq 0) 'WORLD_MAINTENANCE_NATIVE_PROOF'
   Assert-DependencyStopResult $result 'mangosd'
   $permit.Completion=[pscustomobject]@{Result='PASS';ProcessExits=$result.ProcessExits;AtUtc=$result.AtUtc;Outcome=$result}
  }
  Need ($null -ne $permit.Completion) 'WORLD_MAINTENANCE_COMPLETION_UNKNOWN'
  $Run.Receipt.WorldMaintenanceProof=$permit
 }
}
function Adopt-WorldMaintenanceProofFix4($Run,$Prior){
 $svc=Get-CimInstance Win32_Service -Filter "Name='mangosd'" -ErrorAction Stop
 if($svc.StartMode -cne 'Disabled'){return}
 Need ($Run.Kind -ceq 'Rollback' -and $null -ne $Prior.PSObject.Properties['WorldMaintenanceProof']) 'ROLLBACK_DISABLED_WORLD_WITHOUT_PROOF'
 $p=$Prior.WorldMaintenanceProof;$state=Read-ControlState $Run.Plan.Maintenance 'mangosd'
 Need ($p.Operation -ceq $Prior.Operation -and $p.Name -ceq 'mangosd' -and $p.Root -ceq $Run.Plan.Maintenance -and $p.Exe -ceq (Join-Path $Run.Plan.Runtime mangosd.exe) -and $p.Config -ceq (Join-Path $Run.Plan.Runtime mangosd.conf) -and $state.Phase -ceq 'Maintenance' -and $null -ne $p.Completion -and $p.Completion.Result -ceq 'PASS') 'ROLLBACK_MAINTENANCE_PROOF_BINDING'
 $binding=$null
 if($null -ne $Prior.PSObject.Properties['WorldFailureBarrierBinding']){
  $binding=$Prior.WorldFailureBarrierBinding
  Need ($binding.SourceOperation -ceq $Prior.Operation) 'ROLLBACK_FAILURE_BARRIER_SOURCE'
  $transition=Read-WorldFailureBarrierFix4R2 $binding $p
  Need ($transition.PlanSHA256 -ceq $Prior.PlanSHA256) 'ROLLBACK_FAILURE_BARRIER_PLAN'
  $Run.State.AdoptedFailureBarrier=$transition
 }else{Need ($state.Sequence -eq $p.Sequence -and $state.Generation -ceq $p.Generation -and $state.Intent -ceq $p.Intent) 'ROLLBACK_MAINTENANCE_PROOF_BINDING'}
 Assert-DependencyStopResult $p.Completion.Outcome 'mangosd'
 Need (@($p.Completion.ProcessExits).Count -eq 1) 'ROLLBACK_WORLD_NATIVE_PROOF'
 $exit=$p.Completion.ProcessExits[0]
 Need ($exit.PID -eq $p.PID -and $exit.Path -ceq $p.Exe -and ([DateTimeOffset]::Parse($exit.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks -and $exit.Measurement -ceq 'MEASURED' -and $null -ne $exit.NativeExit -and $exit.NativeExit -eq 0) 'ROLLBACK_WORLD_NATIVE_PROOF'
 $copy=$p.PSObject.Copy();$copy.Operation=$Run.Id;$copy.Action='Rollback';$copy.SourceOperation=$Prior.Operation
 if($null -ne $binding){$copy|Add-Member -NotePropertyName FailureBarrierBinding -NotePropertyValue $binding -Force}
 $Run.State.MaintenanceScope.Permit=$copy
 # Full current SCM/CIM instance validation after installing the narrowly bound prior-generation proof.
 try{Assert-BackendQuiescent 'mangosd'}catch{$Run.State.MaintenanceScope.Permit=$null;throw}
 $Run.Receipt.AdoptedWorldStopProof=[pscustomobject]@{SourceOperation=$Prior.Operation;Generation=$p.Generation;StateSequence=$state.Sequence;FailureBarrierBinding=$binding;NoNewStop=$true}
}
function AssertTaskBaseline($Run){
 $scheduler=New-Object -ComObject 'Schedule.Service';$scheduler.Connect();$folder=$scheduler.GetFolder('\')
 foreach($t in $Run.Plan.Tasks){
  $current=Get-ScheduledTask -TaskName $t.Name -TaskPath $t.Path
  Need ($null -ne $current -and $null -ne $current.Settings -and $current.Settings.Enabled -is [bool] -and $t.Enabled -is [bool] -and [string]$current.State -cne 'Running' -and $current.Settings.Enabled -ceq $t.Enabled) 'TASK_STATE_DRIFT'
  $xml=New-Object Xml.XmlDocument;$xml.PreserveWhitespace=$false;$xml.LoadXml((Export-ScheduledTask -TaskName $t.Name -TaskPath $t.Path))
  $before=New-Object Xml.XmlDocument;$before.PreserveWhitespace=$false;$before.LoadXml([IO.File]::ReadAllText((Join-Path $PSScriptRoot ('tasks\baseline\'+$t.Name+'.xml'))))
  foreach($doc in @($xml,$before)){
   $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
   $nodes=@($doc.SelectNodes('/t:Task/t:Settings/t:Enabled',$ns))
   Need ($nodes.Count -le 1) ('TASK_ENABLED_DUPLICATE '+$t.Name)
   foreach($node in $nodes){[void]$node.ParentNode.RemoveChild($node)}
  }
  # Only Enabled has a separate authoritative Task Scheduler read above. Every
  # other XML field, action, trigger and setting remains an exact comparison.
  Need ($xml.OuterXml -ceq $before.OuterXml) ('TASK_DEFINITION_DRIFT '+$t.Name)
  Need ($folder.GetTask($t.Name).GetSecurityDescriptor(7) -ceq $Run.Plan.TaskSDDL.($t.Name)) ('TASK_SDDL_DRIFT '+$t.Name)
 }
}

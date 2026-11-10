. (Join-Path $PSScriptRoot 'Services.ps1')
. (Join-Path $PSScriptRoot 'Dev.ps1')
. (Join-Path $PSScriptRoot 'Production.ps1')
. (Join-Path $PSScriptRoot 'Reboot.ps1')
. (Join-Path $PSScriptRoot 'Safety.R2.ps1')
function Ack { [pscustomobject]@{OK=$true} }
function PriorWrittenHash($Prior,[string]$Id){if($null -eq $Prior.PSObject.Properties['WrittenHashes']){return $null};$property=$Prior.WrittenHashes.PSObject.Properties[$Id];if($null -ne $property){return $property.Value};return $null}
function RequirePrivateInput($Inputs,[string]$Name){RequireInputFileR2 $Inputs $Name}
function PinDevConfigs($Run){
 $d=$Run.Plan.Dev;$rows=@(foreach($name in @('mangosd.conf','realmd.conf')){$p=Join-Path $d.Runtime $name;AssertPrivate $p;$text=[IO.File]::ReadAllText($p);$matches=[regex]::Matches($text,'(?m)^\s*(?:LoginDatabase\.?Info|WorldDatabase\.Info|CharacterDatabase\.Info|LogsDatabase\.Info)\s*=\s*"([^"\r\n]+)"');Need ($matches.Count -eq $(if($name -ceq 'mangosd.conf'){4}else{1})) 'DEV_ALL_DATABASE_BINDINGS_REQUIRED';foreach($m in $matches){$parts=$m.Groups[1].Value.Split(';');Need ($parts.Count -eq 5 -and $parts[0] -ceq '127.0.0.1' -and $parts[1] -ceq '13306' -and $parts[2] -ceq 'r3dev' -and $parts[4] -cin $Run.Plan.DatabaseNames) 'DEV_DATABASE_ESCAPE'};[pscustomobject]@{Path=$p;SHA256=(Hash $p)}})
 $ai=Join-Path $d.Runtime 'aiplayerbot.conf';AssertPrivate $ai;Need ([IO.File]::ReadAllText($ai) -cmatch '(?m)^AiPlayerbot.Enabled = 0\s*$') 'DEV_AI_DISABLED_REQUIRED';$rows+=@([pscustomobject]@{Path=$ai;SHA256=(Hash $ai)});return $rows
}
function CopyStageController($Run){
 if(!(Test-Path $Run.Plan.VersionRoot)){NewPrivate $Run.Plan.VersionRoot}else{AssertPrivate $Run.Plan.VersionRoot}
 foreach($p in $Run.Plan.VersionPins){if(Test-Path $p.Target){Need ((Hash $p.Target) -ceq $p.SHA256) 'VERSIONED_CODE_ALREADY_DIFFERENT'}else{[IO.File]::Copy($p.Source,$p.Target,$false)};AssertPrivate $p.Target}
}
function WriteControllerReceipts($Run,[bool]$Approved){
 $pins=@($Run.Plan.VersionPins|ForEach-Object {[ordered]@{Name=$_.Name;SHA256=$_.SHA256}})
 DurableJson (Join-Path $Run.Plan.VersionRoot 'ACTIVATION-RECEIPT.json') ([ordered]@{Scope='ADMIN_CONTROL_ONLY';Approved=$Approved;CodePins=$pins})
 $cap=[ordered]@{Schema=1;Approved=$Approved;SqlOutcomeVersion=2;mangosd=$null;realmd=$null}
 foreach($role in @('mangosd','realmd')){$a=@($Run.Plan.Artifacts|Where-Object Role -ceq ($role+'.exe'))[0];$cap[$role]=[ordered]@{Path=(Join-Path $Run.Plan.Runtime ($role+'.exe'));SHA256=$a.SHA256}}
 DurableJson (Join-Path $Run.Plan.VersionRoot 'REBOOT-CAPABILITY.json') $cap
}
function PublishBundle($Run){
 $body=[ordered]@{Schema=1;Phase='Live';PlanSHA256=$Run.Receipt.PlanSHA256;VersionRoot=$Run.Plan.VersionRoot;ControllerSHA256=@($Run.Plan.VersionPins|Where-Object Name -ceq 'VMANGOS-Control.ps1')[0].SHA256;CodePins=@($Run.Plan.VersionPins|ForEach-Object {[ordered]@{Name=$_.Name;SHA256=$_.SHA256}});Release=$Run.Plan.CandidateReference;CollectorVersion=$Run.Plan.CollectorVersion;CollectorCodeSHA256=$Run.Plan.CollectorCodeSHA256;CapabilitySHA256=(Hash (Join-Path $Run.Plan.VersionRoot 'REBOOT-CAPABILITY.json'));Operation=$Run.Id}
 DurableJson $Run.Plan.BundlePointer $body;AssertPrivate $Run.Plan.BundlePointer
}
function RestoreBackupRows($Run,[string]$Group){
 foreach($row in $Run.State.Prior.FileBackup.Files){
  $f=@($Run.Plan.Files|Where-Object Id -ceq $row.Id)[0];if($f.Group -cne $Group){continue}
  if($row.BeforeExists){Need ((Hash $row.Backup) -ceq $row.BeforeSHA256) 'ROLLBACK_BACKUP_CHANGED';WriteBoundFile $Run ([pscustomobject]@{Source=$row.Backup;Target=$row.Target;SHA256=$row.BeforeSHA256})}
  elseif(Test-Path $row.Target){$h=Hash $row.Target;Need ($h -ceq $row.ExpectedNewSHA256 -or $h -ceq (PriorWrittenHash $Run.State.Prior $row.Id)) 'ROLLBACK_UNEXPECTED_NEW_FILE';Remove-Item -LiteralPath $row.Target -Force}
 }
}
function WriteRouteTasks($Run,[bool]$Rollback){
 $scheduler=New-Object -ComObject 'Schedule.Service';$scheduler.Connect();$folder=$scheduler.GetFolder('\')
 foreach($name in @('VMANGOS-ADMIN-PANEL-START-ALL','VMANGOS-ADMIN-PANEL-STOP-ALL','VMANGOS-ADMIN-PANEL-RESTART-WORLD')){
  $task=$folder.GetTask($name);Need ($task.GetInstances(0).Count -eq 0) 'TASK_INSTANCE_ACTIVE';$sddl=$task.GetSecurityDescriptor(7)
  $leaf=if($Rollback){'before'}else{'after'};$xml=[IO.File]::ReadAllText((Join-Path $PSScriptRoot ('tasks\'+$leaf+'\'+$name+'.xml')))
  $def=$scheduler.NewTask(0);$def.XmlText=$xml;$def.Settings.Enabled=$false
  $new=$folder.RegisterTaskDefinition($name,$def,22,'SYSTEM',$null,5,$sddl)
  Need ($new.GetSecurityDescriptor(7) -ceq $sddl -and !$new.Enabled) 'TASK_ACL_OR_DISABLED_STATE_CHANGED'
 }
}
function NewNativeDriver($Run,$Inputs){
 $driver=@{
  Save={param($r)DurableJson (Join-Path $Run.Out 'RECEIPT.json') $r}.GetNewClosure()
  Observe={param($r)PutJson (Join-Path $Run.Out 'OBSERVED.json') @{Runtime=(Snapshot);AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}}.GetNewClosure()
  Barrier={param($r)if($Run.Kind -cin @('Migrate','Rollback','Lifecycle')){SetProductionBarrier $Run}}.GetNewClosure()
 }
 foreach($step in @(Get-KitSteps $Run.Kind)){$name=$step;$driver[$step]={InvokeNativeStep $Run $Inputs $name}.GetNewClosure()}
 return $driver
}
function InvokeNativeStep($Run,$Inputs,[string]$Step){
 $d=$Run.Plan.Dev;$dev=$Run.Kind -cin @('DevSetup','DevAccept')
 switch($Step){
  'Guard' {
   $Run.Receipt.StartedUtc=[DateTimeOffset]::UtcNow.ToString('o')
   if($Run.Kind -cin @('DevSetup','DevAccept','Migrate')){AssertBaseline $Run}
   if($Run.Kind -ceq 'Lifecycle'){[void](AssertLiveBundle $Run)}
   if(!$dev){LoadProduction $Run};if($Run.Kind -ceq 'Migrate'){AssertTaskBaseline $Run;foreach($name in @($d.World,$d.Realm,$d.MySQL)){$ds=DevServiceRecord $Run $name;Need ($ds.State -ceq 'Stopped' -and $ds.Processes.Count -eq 0) 'DEV_MUST_BE_STOPPED_BEFORE_MIGRATION'}}
   if($Run.Kind -ceq 'DevSetup'){Need (!(Test-Path $d.Root)) 'DEV_ENVIRONMENT_EXISTS_NO_OVERWRITE';foreach($port in @($d.MySQLPort,$d.RealmPort,$d.WorldPort,$d.SOAPPort)){Need (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -eq 0) ('DEV_PORT_IN_USE '+$port)}}
   if($Run.Kind -ceq 'Migrate'){
    $p=RequirePrivateInput $Inputs 'DevAcceptanceReceipt';$receipt=Get-AcceptedDevAcceptanceFix4 $Run $p
    $state=Read-ControlState $Run.Plan.Maintenance 'mangosd';Need ($state.Phase -ceq 'Stable') 'MANUAL_MAINTENANCE_NOT_OVERRIDDEN';$ready=Get-CurrentStatus;Need $ready.Ready 'READY_STACK_REQUIRED_FOR_MIGRATION';$Run.Receipt.BeforeIntent=$state
   }
   if($Run.Kind -ceq 'Lifecycle'){$state=Read-ControlState $Run.Plan.Maintenance 'mangosd';Need ($state.Phase -ceq 'Stable') 'LIFECYCLE_MANUAL_MAINTENANCE_NOT_OVERRIDDEN'}
   if($Run.Kind -ceq 'Rollback'){
    $p=RequirePrivateInput $Inputs 'DeploymentReceipt';$prior=GetJson $p;Need ($prior.Kind -ceq 'Migrate' -and $prior.Result -cin @('PASS','FAIL_CLOSED','UNKNOWN_OBSERVATION') -and $prior.PlanSHA256 -cin @($Run.Receipt.PlanSHA256,$Run.Plan.PreviousPlanSHA256) -and $null -ne $prior.FileBackup -and $null -ne $prior.BeforeRegistry) 'ROLLBACK_RECEIPT_BINDING'
    Need ($Run.State.Approval.SchemaCompatibilityVerified -is [bool] -and $Run.State.Approval.SchemaCompatibilityVerified) 'ROLLBACK_SCHEMA_COMPATIBILITY_REVIEW_REQUIRED'
    Need (@($prior.FileBackup.Files).Count -eq @($Run.Plan.Files).Count -and @($prior.FileBackup.Files.Id|Sort-Object -Unique).Count -eq @($Run.Plan.Files).Count) 'ROLLBACK_BACKUP_SET';foreach($row in $prior.FileBackup.Files){$bound=@($Run.Plan.Files|Where-Object Id -ceq $row.Id);Need ($bound.Count -eq 1 -and $bound[0].Target -ceq $row.Target -and $row.BeforeExists -is [bool]) 'ROLLBACK_BACKUP_TARGET';if($row.BeforeExists){Need ((Hash $row.Backup) -ceq $row.BeforeSHA256) 'ROLLBACK_BACKUP_HASH'};if(Test-Path $row.Target){$h=Hash $row.Target;Need ($h -ceq $row.BeforeSHA256 -or $h -ceq $row.ExpectedNewSHA256 -or $h -ceq (PriorWrittenHash $prior $row.Id)) 'ROLLBACK_CURRENT_UNKNOWN_BYTES'}}
    $Run.State.Prior=$prior;$Run.Receipt.BeforeRegistry=$prior.BeforeRegistry;[void](GetRollbackTransitionMode (Get-ReleaseRegistryState $Run.State.Release) $prior $Run.Plan.CandidateReference);Adopt-WorldMaintenanceProofFix4 $Run $prior
   }
  }
  'ValidateInputs' {ValidateStageInputsR2 $Run $Inputs}
  'Gate' {
   if(!(Test-Path $Run.Plan.BackupRoot)){NewPrivate $Run.Plan.BackupRoot}else{AssertPrivate $Run.Plan.BackupRoot}
   if(!$dev){Need (!(Test-Path (Join-Path $Run.Plan.Maintenance 'planned-reboot-claim.json'))) 'REBOOT_CLAIM_REQUIRES_REVIEW';AssertControlTasksRestoredR2 $Run;SetControlTasks $Run $false}
  }
  'LogicalBackup' {if($Run.Kind -cin @('Rollback','Migrate')){AssertMySQLBackupRunningR2 $Run};LogicalBackup $Run (GetValidatedSourceDefaultsR2 $Run)}
  'DevDirectories' {NewPrivate $d.Root;foreach($p in @($d.Runtime,$d.Data,$d.GameData,(Join-Path $d.Root 'private'))){NewPrivate $p};if(!(Test-Path $d.Logs)){NewPrivate $d.Logs}}
  'DevArtifacts' {
   foreach($a in $Run.Plan.Artifacts|Where-Object {$_.Role -notlike '*.pdb'}){[IO.File]::Copy($a.Path,(Join-Path $d.Runtime ([IO.Path]::GetFileName($a.Path))),$false)}
   NoReparse $d.SourceGameData;Need (@(Get-ChildItem -LiteralPath $d.SourceGameData -Force -Recurse|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count -eq 0) 'GAME_DATA_REPARSE_DENIED'
   $r=Capture 'C:\Windows\System32\robocopy.exe' @($d.SourceGameData,$d.GameData,'/E','/COPY:DAT','/R:0','/W:0','/NFL','/NDL','/XJ') ($Run.Out.Substring($Out.Length+1)+'\GAME-DATA-COPY') 3600000;Need ($null -ne $r.ExitCode -and $r.ExitCode -ge 0 -and $r.ExitCode -le 7) 'GAME_DATA_COPY_FAILED'
  }
  'DevConfigs' {ProvisionDevConfigs $Run (RequirePrivateInput $Inputs 'DevSecrets');$Run.Receipt.DevConfigPins=@(PinDevConfigs $Run)}
  'InitializeDevData' {[void](NativeKit $Run (Join-Path $Run.Plan.MySQLBin 'mysqld.exe') @('--initialize-insecure',('--basedir='+[IO.Path]::GetDirectoryName($Run.Plan.MySQLBin)),('--datadir='+$d.Data),('--log-error='+(Join-Path $d.Logs 'mysql-init.log'))) 'INITIALIZE-NEW-DEV-DATA' 600000)}
  'CreateDevServices' {CreateDevServices $Run}
  'StartDevMySQL' {DevStart $Run $d.MySQL}
  'AttestDevEndpoint' {AttestDevDB $Run}
  'ImportDevCopy' {
   AttestDevDB $Run;$dump=$Run.State.LogicalBackup;Need ((Hash $dump.Path) -ceq $dump.SHA256) 'DEV_IMPORT_SOURCE_CHANGED'
   [void](InvokeInputFile $Run (Join-Path $Run.Plan.MySQLBin 'mysql.exe') @(('--defaults-extra-file='+$d.Defaults),'--protocol=TCP','--host=127.0.0.1','--port=13306') $dump.Path 'IMPORT-ISOLATED-COPY' 3600000)
   # Disable the one-time init file after successful authenticated import.
   $ini=[IO.File]::ReadAllText($d.MySQLIni);$ini=[regex]::Replace($ini,'(?m)^init-file=.*\r?\n?','');[IO.File]::WriteAllText($d.MySQLIni,$ini,[Text.UTF8Encoding]::new($false))
  }
  'RestrictDevRealm' {[void](DevSQL $Run "DELETE FROM realmd_dev.realmlist WHERE id<>1; UPDATE realmd_dev.realmlist SET address='127.0.0.1',localAddress='127.0.0.1',localSubnetMask='255.255.255.255',port=18085 WHERE id=1;" 'DEV-REALM-LOOPBACK')}
  'VerifyDevEnvironment' {$Run.Receipt.DevConfigPins=@(PinDevConfigs $Run);$Run.Receipt.DevData=$d.Data;$Run.Receipt.SourceSnapshot=$Run.State.LogicalBackup;$Run.Receipt.CandidateMangosdSHA256=@($Run.Plan.Artifacts|Where-Object Role -ceq 'mangosd.exe')[0].SHA256;$Run.Receipt.ActualEnvironmentProvisioned=$true}
  'AttestDevEnvironment' {
   $p=RequirePrivateInput $Inputs 'DevEnvironmentReceipt';$receipt=Get-BoundDevSetupFix2 $Run $p
   foreach($c in $receipt.DevConfigPins){Need ((Hash $c.Path) -ceq $c.SHA256) 'DEV_CONFIGURATION_CHANGED'};foreach($a in $Run.Plan.Artifacts|Where-Object {$_.Role -notlike '*.pdb'}){Need ((Hash (Join-Path $d.Runtime ([IO.Path]::GetFileName($a.Path)))) -ceq $a.SHA256) 'DEV_ARTIFACT_PIN'};[void](PinDevConfigs $Run);$Run.Receipt.SourceSnapshot=$receipt.SourceSnapshot
  }
  'StartMySQL' {if($dev){DevStart $Run $d.MySQL}else{Start-BackendService 'VMANGOS-MySQL';Need (Wait-MySqlReady 180) 'MYSQL_NOT_READY'}}
  'StartRealm' {if($dev){DevStart $Run $d.Realm}else{Start-BackendService 'realmd';Need (Wait-RealmdReady 180) 'REALM_NOT_READY'}}
  'StartWorld' {if($dev){DevStart $Run $d.World}else{ProductionStartWorld $Run}}
  'DevReady' {AttestDevDB $Run;Need (DevPortReady $Run $d.World $d.WorldPort) 'DEV_WORLD_NOT_READY'}
  'Ready' {$status=Get-CurrentStatus;Need $status.Ready 'STACK_NOT_READY'}
  'StopWorld' {if($dev){DevStop $Run $d.World}else{ProductionRetainedStop $Run 'mangosd'}}
  'StopRealm' {if($dev){DevStop $Run $d.Realm}else{ProductionRetainedStop $Run 'realmd'}}
  'StopMySQL' {if($dev){DevStop $Run $d.MySQL}else{ProductionRetainedStop $Run 'VMANGOS-MySQL'}}
  'DevFinalWrites' {$v=DevSQL $Run 'SELECT realmflags FROM realmd_dev.realmlist WHERE id=1;' 'DEV-FINAL-REALM-FLAGS';Need ($v -match '^\d+$' -and ([long]$v -band 2) -eq 2) 'DEV_WORLD_OFFLINE_WRITE_NOT_OBSERVED'}
  'VerifyDevAcceptance' {$Run.Receipt.CandidateRealmdSHA256=@($Run.Plan.Artifacts|Where-Object Role -ceq 'realmd.exe')[0].SHA256;$Run.Receipt.CandidateMangosdSHA256=@($Run.Plan.Artifacts|Where-Object Role -ceq 'mangosd.exe')[0].SHA256;$Run.Receipt.ActualOwnServices=$true;$Run.Receipt.ActualWindowsReboot='NOT_RUN';foreach($name in @($d.World,$d.Realm,$d.MySQL)){$s=DevServiceRecord $Run $name;Need ($s.State -ceq 'Stopped' -and $s.Processes.Count -eq 0 -and $s.Win32 -eq 0 -and $s.Specific -eq 0) 'DEV_NOT_CLEANLY_STOPPED'}}
  'BackupFiles' {BackupKitFiles $Run}
  'BackupCurrent' {BackupKitFiles $Run}
  'StageController' {CopyStageController $Run;WriteControllerReceipts $Run $false}
  'RegisterRelease' {$Run.State.Target=Register-VerifiedRelease $Run.State.Release (Join-Path $PSScriptRoot 'RELEASE-MANIFEST.json') (Join-Path $PSScriptRoot 'BUILD-PROOF.json')}
  'BeginTransition' {[void](Begin-ReleaseTransition $Run.State.Release $Run.Plan.CandidateReference $Run.Id)}
  'BeginRollback' {$Run.State.Target=$Run.State.Prior.BeforeRegistry.active;$Run.State.RollbackTransitionMode=GetRollbackTransitionMode (Get-ReleaseRegistryState $Run.State.Release) $Run.State.Prior $Run.Plan.CandidateReference;if($Run.State.RollbackTransitionMode -ceq 'NO_TRANSITION_NEEDED'){$Run.Receipt.RegistryOutcome='ORIGINAL_RELEASE_UNCHANGED'}else{$s=Begin-ReleaseTransition $Run.State.Release $Run.State.Target $Run.Id -Rollback;Need ($s.transaction.target.id -ceq $Run.State.Target.id -and $s.transaction.target.sha256 -ceq $Run.State.Target.sha256) 'ROLLBACK_TARGET_MISMATCH'}}
  'WriteBinaries' {foreach($f in $Run.Plan.Files|Where-Object Group -ceq 'Binaries'){WriteBoundFile $Run $f}}
  'VerifyPair' {[void](Test-ReleaseSet (GetJson (Join-Path $PSScriptRoot 'RELEASE-MANIFEST.json')) $Run.Plan.Runtime 'b1c0e16e228738dd16f0')}
  'WriteReceipts' {WriteControllerReceipts $Run $true}
  'WriteRoutes' {foreach($f in $Run.Plan.Files|Where-Object Group -ceq 'Routes'){WriteBoundFile $Run $f};WriteRouteTasks $Run $false}
  'RequestCommit' {if(!($Run.Kind -ceq 'Rollback' -and $Run.State.RollbackTransitionMode -ceq 'NO_TRANSITION_NEEDED')){[void](Request-ReleaseCommit $Run.State.Release $Run.Id)}}
  'Samples' {WaitKitSamples $Run $Run.Plan.CandidateReference}
  'PublishBundle' {PublishBundle $Run}
  'RestoreTasks' {SetControlTasks $Run $true}
  'VerifyMigration' {AssertControlTasksRestoredR2 $Run;$pointer=GetJson $Run.Plan.BundlePointer;Need ($pointer.Phase -ceq 'Live' -and $pointer.Release.id -ceq $Run.Plan.CandidateReference.id -and $Run.State.FreshSamples -eq 2) 'BUNDLE_NOT_COMMITTED';$Run.Receipt.Target=$Run.Plan.CandidateReference;$Run.Receipt.BootRebootAcceptance='NOT_RUN'}
  'RevokeCapability' {RevokeRollbackCapabilityR2 $Run}
  'RestoreFiles' {RestoreBackupRows $Run 'Binaries'}
  'VerifyRollbackPair' {$manifest=Get-RegisteredRelease $Run.State.Release $Run.State.Prior.BeforeRegistry.active;[void](Test-ReleaseSet $manifest $Run.Plan.Runtime $manifest.revision.runtimePrefix)}
  'RestoreRoutes' {RestoreBackupRows $Run 'Routes';RestoreBackupRows $Run 'Pointer';WriteRouteTasks $Run $true}
  'RestoreTasksStopped' {SetControlTasks $Run $false}
  'VerifyRollbackStopped' {$Run.Receipt.Outcome='ROLLED_BACK_STOPPED_COMMIT_PENDING_EXPLICIT_START';$Run.Receipt.DatabaseRestore='NOT_RUN_NEVER_AUTOMATIC';$Run.Receipt.Target=$Run.State.Prior.BeforeRegistry.active}
  'VerifyLifecycle' {AssertControlTasksRestoredR2 $Run;Need ($Run.Receipt.TaskRestoreResult -ceq 'VERIFIED_EXACT_INITIAL_ENABLED') 'LIFECYCLE_TASK_RESTORE_REQUIRED';$Run.Receipt.ActualWindowsReboot='NOT_RUN';$Run.Receipt.Target=$Run.Plan.CandidateReference}
  default {throw ('UNIMPLEMENTED_NATIVE_STEP '+$Step)}
 }
 $writtenGroups=switch($Step){'StageController'{@('Version','GeneratedApproval')};'WriteBinaries'{@('Binaries')};'WriteReceipts'{@('GeneratedApproval')};'WriteRoutes'{@('Routes')};'PublishBundle'{@('Pointer')};default{@()}}
 foreach($file in $Run.Plan.Files|Where-Object {$_.Group -cin @($writtenGroups)}){if(Test-Path $file.Target){$Run.Receipt.WrittenHashes[$file.Id]=Hash $file.Target}}
 Ack
}
function GetRollbackTransitionMode($State,$Prior,$Candidate){
 $before=$Prior.BeforeRegistry.active
 if($State.phase -ceq 'stable'){
  if($State.active.id -ceq $before.id -and $State.active.sha256 -ceq $before.sha256){return 'NO_TRANSITION_NEEDED'}
  Need ($State.active.id -ceq $Candidate.id -and $State.active.sha256 -ceq $Candidate.sha256 -and $null -ne $State.previous -and $State.previous.id -ceq $before.id -and $State.previous.sha256 -ceq $before.sha256) 'ROLLBACK_STALE_OR_UNRELATED_RELEASE'
  return 'COMMITTED_CANDIDATE'
 }
 Need ($State.phase -ceq 'transition' -and $State.transaction.id -ceq $Prior.Operation -and $State.transaction.kind -ceq 'deploy' -and $State.transaction.beforeActive.id -ceq $before.id -and $State.transaction.beforeActive.sha256 -ceq $before.sha256 -and $State.transaction.target.id -ceq $Candidate.id -and $State.transaction.target.sha256 -ceq $Candidate.sha256) 'ROLLBACK_OTHER_OPERATION_OR_UNKNOWN_STATE'
 return 'INTERRUPTED_CANDIDATE_TRANSITION'
}

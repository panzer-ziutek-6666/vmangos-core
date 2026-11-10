# R2 safety for existing kit; no top-level operation.
function ReadControlTasksR2($Run){
 $rows=@(foreach($t in $Run.Plan.Tasks){
  $a=Get-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction Stop
  Need ($null -ne $a -and $null -ne $a.Settings -and $a.Settings.Enabled -is [bool]) ('TASK_ENABLED_UNKNOWN '+$t.Name)
  [pscustomobject]@{Name=$t.Name;Path=$t.Path;Enabled=$a.Settings.Enabled;State=[string]$a.State}
 })
 Need ($rows.Count -eq 5 -and @($rows|ForEach-Object {$_.Path+$_.Name}|Sort-Object -Unique).Count -eq 5) 'CONTROL_TASK_SET_INVALID'
 return $rows
}
function CaptureControlTasksR2($Run){
 $rows=@(ReadControlTasksR2 $Run);Need (@($rows|Where-Object State -ceq 'Running').Count -eq 0) 'CONTROL_TASK_ACTIVE_BEFORE_GATE'
 $Run.Receipt.TaskStatesBefore=$rows;$Run.Receipt.TaskRestoreResult='NOT_ATTEMPTED'
}
function AssertControlTasksRestoredR2($Run){
 Need ($Run.Receipt.Contains('TaskStatesBefore') -and @($Run.Receipt.TaskStatesBefore).Count -eq 5) 'TASK_SNAPSHOT_REQUIRED'
 $now=@(ReadControlTasksR2 $Run)
 foreach($before in $Run.Receipt.TaskStatesBefore){
  Need ($before.Enabled -is [bool]) 'TASK_SNAPSHOT_ENABLED_UNKNOWN'
  $actual=@($now|Where-Object {$_.Name -ceq $before.Name -and $_.Path -ceq $before.Path})
  Need ($actual.Count -eq 1 -and $actual[0].Enabled -ceq $before.Enabled -and $actual[0].State -cne 'Running') ('TASK_RESTORE_NOT_VERIFIED '+$before.Name)
 }
}
function SetControlTasksR2($Run,[bool]$Restore){
 if($Restore){
  Need ($Run.Receipt.Contains('TaskStatesBefore') -and @($Run.Receipt.TaskStatesBefore).Count -eq 5) 'TASK_SNAPSHOT_REQUIRED'
  $Run.Receipt.TaskRestoreResult='IN_PROGRESS'
  foreach($t in $Run.Receipt.TaskStatesBefore){
   Need ($t.Enabled -is [bool]) 'TASK_SNAPSHOT_ENABLED_UNKNOWN'
   $a=Get-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction Stop;Need ([string]$a.State -cne 'Running') ('CONTROL_TASK_ACTIVE '+$t.Name)
   if($t.Enabled){Enable-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction Stop|Out-Null}else{Disable-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction Stop|Out-Null}
  }
  AssertControlTasksRestoredR2 $Run;$Run.Receipt.TaskRestoreResult='VERIFIED_EXACT_INITIAL_ENABLED'
 }else{
  # Best effort across ALL tasks even if one read/write fails. Never stop a task instance.
  $errors=[Collections.Generic.List[string]]::new()
  foreach($t in $Run.Plan.Tasks){try{
   Disable-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction Stop|Out-Null
   $a=Get-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction Stop
   Need ($a.Settings.Enabled -is [bool] -and !$a.Settings.Enabled -and [string]$a.State -cne 'Running') ('CONTROL_TASK_DISABLE_UNCONFIRMED '+$t.Name)
  }catch{$errors.Add($t.Name+': '+$_.Exception.Message)}}
  $Run.Receipt.ControlBarrier=$(if($errors.Count){'INCOMPLETE'}else{'ALL_FIVE_TASKS_DISABLED_VERIFIED'})
  Need ($errors.Count -eq 0) ('CONTROL_TASK_BARRIER_INCOMPLETE '+($errors -join ' | '))
 }
}
function RetainWorldBarrierR2($Run){
 if(!$Run.State.ContainsKey('Module')){return}
 $m=$Run.State.Module;$before=Read-ControlState $Run.Plan.Maintenance 'mangosd';$proof=$null
 if($Run.Receipt.Contains('WorldMaintenanceProof')){
  $candidate=$Run.Receipt.WorldMaintenanceProof
  # Only this operation's already complete measured stop may cross its own failure barrier.
  if($candidate.Operation -ceq $Run.Id -and $candidate.SourceOperation -ceq $Run.Id -and (Test-WorldMaintenancePermitFix4 (Get-BackendStopDefinitionFix3 'mangosd'))){
   try{Assert-DependencyStopResult $candidate.Completion.Outcome 'mangosd';Assert-BackendQuiescent 'mangosd';$proof=$candidate}catch{$Run.Receipt.WorldFailureBindingRefusal=$_.Exception.Message}
  }
 }
 $intent='R3OperationFailureRequiresReview:'+$Run.Id
 & $m {param($c,$i)Set-ControlState $c 'Maintenance' $i $null 'FAIL_OR_UNKNOWN';[void](& $c.Driver.Disable)} $Run.State.Context $intent
 if($null -eq $proof){$Run.Receipt.WorldFailureBindingStatus='UNAVAILABLE_NO_CONFIRMED_GENERATION';return}
 $after=Read-ControlState $Run.Plan.Maintenance 'mangosd';$snapshot=& $Run.State.WorldDriver.Read
 Need ($snapshot.State -eq 1 -and $snapshot.Pid -eq 0 -and $snapshot.StartType -eq 4 -and $snapshot.ResultKnown -and $snapshot.Win32ExitCode -eq 0 -and $snapshot.SpecificExitCode -eq 0) 'FAILURE_BARRIER_NOT_QUIESCENT'
 $path=Join-Path $Run.Plan.Maintenance ('failure-barrier-'+$Run.Id+'.json');Need (!(Test-Path $path)) 'FAILURE_BARRIER_BINDING_NO_OVERWRITE'
 $backend=@{};if($Run.Receipt.Contains('BackendStopProofs')){foreach($name in $Run.Receipt.BackendStopProofs.Keys){$r=$Run.Receipt.BackendStopProofs[$name];Assert-DependencyStopResult $r $name;Need ($r.ControlOperation -ceq $Run.Id) 'FAILURE_BARRIER_BACKEND_OPERATION';$backend[$name]=$r}}
 $body=[ordered]@{Schema=1;Operation=$Run.Id;PlanSHA256=$Run.Receipt.PlanSHA256;Root=$Run.Plan.Maintenance;Service='mangosd';SourceProof=$proof;BackendStopProofs=$backend;BeforeState=$before;AfterState=$after;AfterStateSHA256=(Hash (Join-Path $Run.Plan.Maintenance state.json))}
 & $m {param($p,$v)Write-ControlAtomic $p $v} $path $body
 $reference=[pscustomobject]@{Schema=1;SourceOperation=$Run.Id;Path=$path;SHA256=(Hash $path)}
 [void](Read-WorldFailureBarrierFix4R2 $reference $proof)
 $Run.Receipt.WorldFailureBarrierBinding=$reference;$Run.Receipt.WorldFailureBindingStatus='DURABLE_EXACT_OWN_TRANSITION'
 # This is an authorization view of the original immutable proof plus its exact transition.
 # Neither the historical proof nor its original Sequence/Intent/Generation is rewritten.
 $copy=$proof.PSObject.Copy();$copy|Add-Member -NotePropertyName FailureBarrierBinding -NotePropertyValue $reference -Force
 $Run.State.MaintenanceScope.Permit=$copy;Assert-BackendQuiescent 'mangosd'
}
function RequireInputFileR2($Inputs,[string]$Name){
 Need ($null -ne $Inputs -and $null -ne $Inputs.PSObject.Properties[$Name] -and $Inputs.$Name -is [string] -and ![string]::IsNullOrWhiteSpace($Inputs.$Name)) ('REQUIRED_INPUT '+$Name)
 $path=$Inputs.$Name;Need (Test-Path -LiteralPath $path -PathType Leaf) ('REQUIRED_INPUT_FILE '+$Name+' '+$path);AssertPrivate $path
 Need ((Get-Item -LiteralPath $path).Length -gt 0) ('REQUIRED_INPUT_EMPTY '+$Name)
 return $path
}
function ValidateBackupInputsR2($Run,$Inputs){
 $path=RequireInputFileR2 $Inputs 'SourceDefaults';$text=[IO.File]::ReadAllText($path)
 Need ($text -match '(?m)^\s*\[client\]\s*$' -and $text -notmatch '(?im)^\s*!include' -and $text -notmatch 'REPLACE_') 'BACKUP_CLIENT_CONFIG_REQUIRED'
 foreach($key in @('user','password')){Need ([regex]::Matches($text,('(?m)^\s*'+$key+'\s*=\s*\S.*$')).Count -eq 1) ('BACKUP_CLIENT_KEY_REQUIRED '+$key)}
 Need ($Run.State.Approval.NoDDLWindow -is [bool] -and $Run.State.Approval.NoDDLWindow) 'NO_DDL_WINDOW_REQUIRED'
 Need ($Run.State.Approval.SnapshotStrategy -cin @('AllInnoDB','QuiescentGlobalReadLock')) 'EXPLICIT_SNAPSHOT_STRATEGY_REQUIRED'
 if($Run.State.Approval.SnapshotStrategy -ceq 'QuiescentGlobalReadLock'){Need ($Run.State.Approval.AllowGlobalReadLock -is [bool] -and $Run.State.Approval.AllowGlobalReadLock) 'GLOBAL_READ_LOCK_SEPARATE_APPROVAL_REQUIRED'}
 foreach($name in @('mysql.exe','mysqldump.exe')){$p=Join-Path $Run.Plan.MySQLBin $name;$pin=@($Run.Plan.FixedInputs|Where-Object Path -ceq $p);Need ($pin.Count -eq 1 -and (Hash $p) -ceq $pin[0].SHA256) ('BACKUP_TOOL_PIN '+$name)}
 $Run.State.ValidatedSourceDefaults=[pscustomobject]@{Path=$path;SHA256=(Hash $path)}
}
function AssertMySQLBackupRunningR2($Run){
 $s=Get-BackendStopObservation 'VMANGOS-MySQL'
 $good=($s.State -ceq 'Running' -and $s.PID -isnot [bool] -and $null -ne $s.PID -and $s.PID -gt 0 -and @($s.Processes|Where-Object PID -eq $s.PID).Count -eq 1)
 if(!$good){
  $Run.Receipt.BackupDecision=[ordered]@{Mode='REFUSED';MySQL=$s;PriorDumpNotReused=$true;Continuity='NOT_PROVEN';Next='Separately approve MySQL-only controlled start and fresh logical backup with world/realm kept stopped; or supply independently reviewed continuity evidence in a later revision. No automatic start or DB restore.'}
  throw ('ROLLBACK_OR_BACKUP_MYSQL_NOT_RUNNING_CONTINUITY_UNPROVEN State='+$s.State+'; NEXT_STEP=Separately approved MySQL-only start and fresh logical backup; world/realm remain stopped')
 }
 $Run.State.BackupServiceBefore=$s
}
function GetValidatedSourceDefaultsR2($Run){
 Need ($Run.State.ContainsKey('ValidatedSourceDefaults')) 'BACKUP_INPUT_NOT_VALIDATED_BEFORE_GATE'
 $i=$Run.State.ValidatedSourceDefaults;Need ((Hash $i.Path) -ceq $i.SHA256) 'BACKUP_INPUT_CHANGED_AFTER_PREFLIGHT';return $i.Path
}
function InspectRollbackCapabilityR2($Run){
 $root=$Run.Plan.VersionRoot;NoReparse $root
 if(!(Test-Path -LiteralPath $root)){
  Need (@($Run.State.Prior.Completed|Where-Object {$_ -ceq 'BackupFiles'}).Count -eq 1 -and @($Run.State.Prior.Completed|Where-Object {$_ -ceq 'StageController'}).Count -eq 0) 'ROLLBACK_MISSING_INSTALLATION_UNEXPECTED_HISTORY'
  $rows=@($Run.State.Prior.FileBackup.Files|Where-Object {$_.Target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)})
  Need ($rows.Count -eq 6 -and @($rows|Where-Object {$_.BeforeExists -isnot [bool] -or $_.BeforeExists}).Count -eq 0 -and !(Test-Path -LiteralPath $Run.Plan.BundlePointer)) 'ROLLBACK_INSTALLATION_ABSENCE_NOT_PROVEN'
  return [pscustomobject]@{Status='ABSENT_VERIFIED_NO_ACTIVATION_TO_REVOKE';Files=@()}
 }
 AssertPrivate $root;Need (Test-Path -LiteralPath $root -PathType Container) 'ROLLBACK_VERSION_ROOT_TYPE'
 $files=@(Get-ChildItem -LiteralPath $root -Force);$allowed=@($Run.Plan.VersionPins|ForEach-Object Name)+@('ACTIVATION-RECEIPT.json','REBOOT-CAPABILITY.json')
 foreach($f in $files){Need (!$f.PSIsContainer -and $f.Name -cin $allowed) 'ROLLBACK_UNKNOWN_INSTALLED_FILE';AssertPrivate $f.FullName}
 foreach($pin in $Run.Plan.VersionPins){$path=Join-Path $root $pin.Name;if(Test-Path $path){Need ((Hash $path) -ceq $pin.SHA256) ('ROLLBACK_INSTALLED_CODE_CHANGED '+$pin.Name)}}
 $receipts=@(foreach($name in @('ACTIVATION-RECEIPT.json','REBOOT-CAPABILITY.json')){
  $path=Join-Path $root $name;if(!(Test-Path $path)){continue};$body=GetJson $path
  Need ($body.Approved -is [bool]) 'ROLLBACK_APPROVAL_FIELD_UNKNOWN'
  if($name -ceq 'ACTIVATION-RECEIPT.json'){
   Need ($body.Scope -ceq 'ADMIN_CONTROL_ONLY' -and @($body.CodePins).Count -eq 4 -and @($body.CodePins.Name|Sort-Object -Unique).Count -eq 4) 'ROLLBACK_ACTIVATION_SCHEMA'
   foreach($pin in $Run.Plan.VersionPins){$found=@($body.CodePins|Where-Object Name -ceq $pin.Name);Need ($found.Count -eq 1 -and $found[0].SHA256 -ceq $pin.SHA256) 'ROLLBACK_ACTIVATION_CODE_PIN'}
  }else{
   Need ($body.Schema -eq 1 -and $body.SqlOutcomeVersion -eq 2) 'ROLLBACK_CAPABILITY_SCHEMA'
   foreach($role in @('mangosd','realmd')){$a=@($Run.Plan.Artifacts|Where-Object Role -ceq ($role+'.exe'))[0];Need ($body.$role.Path -ceq (Join-Path $Run.Plan.Runtime ($role+'.exe')) -and $body.$role.SHA256 -ceq $a.SHA256) 'ROLLBACK_CAPABILITY_BINARY_PIN'}
  }
  [pscustomobject]@{Path=$path;SHA256=(Hash $path);Body=$body}
 })
 return [pscustomobject]@{Status='EXISTING_FILES_VALIDATED';Files=$receipts}
}
function RevokeRollbackCapabilityR2($Run){
 $observation=InspectRollbackCapabilityR2 $Run
 foreach($file in $observation.Files){Need ((Hash $file.Path) -ceq $file.SHA256) 'ROLLBACK_CAPABILITY_CHANGED';$file.Body.Approved=$false;DurableJson $file.Path $file.Body;AssertPrivate $file.Path;Need ((GetJson $file.Path).Approved -ceq $false) 'ROLLBACK_CAPABILITY_REVOKE_NOT_VERIFIED'}
 $Run.Receipt.CapabilityRevocation=$observation.Status
}
function ValidateStageInputsR2($Run,$Inputs){
 if($Run.Kind -ceq 'Rollback'){
  # Old dump hashes/timestamps are not proof of no subsequent database writes.
  # R1 produced no sufficient continuity seal. Never silently reuse its dump.
  AssertMySQLBackupRunningR2 $Run
  $Run.Receipt.BackupDecision=[ordered]@{Mode='FRESH_BACKUP_REQUIRED';PriorDumpNotReused=$true}
 }
 if($Run.Kind -cin @('DevSetup','Migrate','Rollback')){ValidateBackupInputsR2 $Run $Inputs}
 if($Run.Kind -ceq 'DevSetup'){
  $path=RequireInputFileR2 $Inputs 'DevSecrets';$s=GetJson $path
  foreach($key in @('DevAdminPassword','DevCorePassword')){Need ($s.$key -is [string] -and $s.$key -cmatch '^[A-Za-z0-9_-]{32,128}$' -and !$s.$key.Contains('REPLACE')) 'DEV_PRIVATE_RANDOM_PASSWORD_REQUIRED'}
  Need ($s.DevAdminPassword -cne $s.DevCorePassword) 'DEV_DISTINCT_PASSWORDS'
  $Run.State.ValidatedDevSecrets=[pscustomobject]@{Path=$path;SHA256=(Hash $path)}
  if($Run.State.Approval.SnapshotStrategy -ceq 'QuiescentGlobalReadLock'){LoadProduction $Run;Assert-BackendQuiescent 'mangosd';Assert-BackendQuiescent 'realmd'}
 }
 if($Run.Kind -ceq 'DevAccept'){[void](RequireInputFileR2 $Inputs 'DevEnvironmentReceipt')}
 if($Run.Kind -ceq 'Rollback'){$Run.Receipt.CapabilityBefore=InspectRollbackCapabilityR2 $Run}
 if($Run.Kind -cin @('Migrate','Rollback','Lifecycle')){CaptureControlTasksR2 $Run}
}

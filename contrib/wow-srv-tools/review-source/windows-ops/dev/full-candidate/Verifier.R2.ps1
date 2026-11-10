function Invoke-PhaseVerification {
param([string]$ReceiptPath,[string]$ProcessRecord,[string]$ResultPath)
$result=[ordered]@{Result='UNKNOWN';Receipt=$ReceiptPath;ReceiptSHA256=$null;Operation=$null;Kind=$null;NativeExit=$null;Error=$null;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
try{
 AssertKitPins;AssertPrivate $ReceiptPath;Need (!(Test-Path $ResultPath)) 'VERIFIER_NEW_RESULT_ONLY'
 $r=GetJson $ReceiptPath;$native=GetJson $ProcessRecord;$result.NativeExit=$native.ExitCode
 Need ($native.Started -and $native.StreamsCaptured -and $null -ne $native.ExitCode -and $native.ExitCode -eq 0) 'MAIN_NATIVE_NOT_ZERO_OR_UNKNOWN'
 Need ($r.Result -ceq 'PASS' -and $r.Phase -ceq 'Complete' -and $r.CandidateManifestSHA256 -ceq 'D3FD840BFDC65D5852612DA64005F2945689D3A66308525CD8B7B059878A4DBB' -and $r.PlanSHA256 -ceq (Hash (Join-Path $PSScriptRoot 'KIT-PLAN.json'))) 'RECEIPT_NOT_COMPLETE_PASS'
 Need (($r.Completed -join ',') -ceq ((Get-KitSteps $r.Kind) -join ',')) 'INCOMPLETE_STEPS'
 $result.ReceiptSHA256=Hash $ReceiptPath;$result.Operation=$r.Operation;$result.Kind=$r.Kind
 $dir=Join-Path (Join-Path $script:Out 'verification-work') ('independent-'+[guid]::NewGuid().ToString('N'));NewPrivate $dir
 $plan=GetJson (Join-Path $PSScriptRoot 'KIT-PLAN.json');$run=[pscustomobject]@{Id=([guid]::NewGuid().ToString('N'));Kind=$r.Kind;Plan=$plan;Out=$dir;Log=(Join-Path $dir 'VERIFY.log');State=@{};Receipt=[ordered]@{}}
 AssertBaseline $run;AssertCandidateInputs $run
 $before=GetJson (Join-Path $script:Out 'RUNTIME-BEFORE.json');$after=Snapshot
 foreach($b in $before.Services){$a=@($after.Services|Where-Object Name -ceq $b.Name)[0];foreach($k in @('State','PID','CreatedUtc','Path','StartMode','Win32ExitCode','SpecificExitCode')){Need ($a.$k -ceq $b.$k) ('PRODUCTION_CHANGED '+$b.Name+' '+$k)}}
 $oldPorts=@($before.Listeners|ForEach-Object {$_.Address+'|'+$_.Port+'|'+$_.PID}|Sort-Object);$newPorts=@($after.Listeners|ForEach-Object {$_.Address+'|'+$_.Port+'|'+$_.PID}|Sort-Object);Need (($oldPorts -join ',') -ceq ($newPorts -join ',')) 'PRODUCTION_LISTENERS_CHANGED'
 foreach($n in @('VMANGOS-R3DEV-MySQL','VMANGOS-R3DEV-realmd','VMANGOS-R3DEV-mangosd')){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$n+"'");Need ($s.State -ceq 'Stopped' -and $s.ProcessId -eq 0) 'OLD_DEV_CHANGED'}
 if($r.Kind -ceq 'Backup'){
  $b=$r.LogicalBackup;AssertPrivate $b.Path;Need ($b.NativeExit -eq 0 -and $b.Bytes -gt 10000 -and (Get-Item $b.Path).Length -eq $b.Bytes -and (Hash $b.Path) -ceq $b.SHA256 -and $b.ConsistentSnapshot -ceq 'ALL_INNODB_SINGLE_TRANSACTION_NO_DDL_WINDOW') 'FRESH_DUMP_INVALID'
  $counts=@{};$current=$null;$tail='';$reader=[IO.StreamReader]::new($b.Path)
  try{while(!$reader.EndOfStream){$line=$reader.ReadLine();if($line -cmatch '^USE `([a-z_]+)`;'){$current=$Matches[1];if(!$counts.ContainsKey($current)){$counts[$current]=0}};if($line -cmatch '^CREATE TABLE `'){Need ($current -cin $plan.DatabaseNames) 'DUMP_UNEXPECTED_DATABASE';$counts[$current]++};if($line.StartsWith('-- Dump completed on')){$tail=$line}}}finally{$reader.Dispose()}
  $source=GetJson (Join-Path $script:Out 'SOURCE-PREFLIGHT.json');foreach($db in $source.Engines){Need ($counts.ContainsKey($db.Database) -and $counts[$db.Database] -eq $db.Tables) ('DUMP_TABLE_COMPLETENESS '+$db.Database)};Need ($tail.Length -gt 0 -and $counts.Count -eq 4) 'DUMP_COMPLETION'
  $result.Backup=@{SHA256=$b.SHA256;Bytes=$b.Bytes;NativeExit=$b.NativeExit;TableCounts=$counts;AllFourSchemas=$true}
 }else{
  LoadProduction $run;$run.State.DevUUID=$r.DevUUID;$run.State.CredentialMode='Admin'
  if($r.Kind -cin @('DevSetup','DevMigrations')){
   [void](AttestDevDB $run)
   foreach($n in @($plan.Dev.Realm,$plan.Dev.World)){$s=DevServiceRecord $run $n -ReadMode BeforeStart;Need ($s.State -ceq 'Stopped' -and $s.Processes.Count -eq 0 -and $s.CanStart -and $s.Win32 -in @(0,1077)) 'WORLD_OR_REALM_STARTED_BEFORE_ACCEPTANCE'}
   if($r.Kind -ceq 'DevSetup'){
    foreach($pin in $r.DevConfigPins){Need ((Hash $pin.Path) -ceq $pin.SHA256) 'SETUP_CONFIG_PIN'}
    foreach($a in $plan.Artifacts|Where-Object Role -notlike '*.pdb'){Need ((Hash (Join-Path $plan.Dev.Runtime ([IO.Path]::GetFileName($a.Path)))) -ceq $a.SHA256) 'SETUP_ARTIFACT'}
    $counts=DevSQL $run ("SELECT TABLE_SCHEMA,COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('realmd_dev','mangos_dev','characters_dev','logs_dev') AND TABLE_TYPE='BASE TABLE' GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA;") 'INDEPENDENT-IMPORT-COMPLETENESS'
    $src=GetJson (Join-Path $script:Out 'SOURCE-PREFLIGHT.json');$lines=@($counts -split "`r?`n"|Where-Object {$_});$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    Need ($lines.Count -eq 4 -and $src.Engines.Count -eq 4) 'IMPORT_REQUIRES_FOUR_DATABASES'
    foreach($line in $lines){$p=$line.Split([char]9);Need ($p.Count -eq 2 -and $p[0] -cin $plan.DatabaseNames -and $p[1] -cmatch '^[1-9][0-9]*$' -and $seen.Add($p[0])) 'IMPORT_SCHEMA_COUNT_OR_DUPLICATE';$found=@($src.Engines|Where-Object Database -ceq $p[0]);Need ($found.Count -eq 1 -and [long]$p[1] -eq $found[0].Tables) 'IMPORT_TABLE_COUNT'}
    foreach($db in $plan.DatabaseNames){Need ($seen.Contains($db)) 'IMPORT_DATABASE_MISSING'}
    $result.ImportDatabaseCount=4
   }else{
    Need ((Hash $r.PreMigrationBackup.Path) -ceq $r.PreMigrationBackup.SHA256 -and $r.PreMigrationBackup.NativeExit -eq 0) 'PREMIGRATION_BACKUP_HASH'
    Assert-AuditSchemaR3 $run;VerifyDevWorld $run;VerifyDevCharacters $run;VerifyDevMigrationSets $run;$proof=Export-AuditProofR3 $run 'AUDIT-INDEPENDENT';$baseline=GetJson (Join-Path $script:Out 'PREIMAGES-BASELINE.json');Need ($proof.SHA256 -ceq $baseline.SHA256) 'AUDIT_PREIMAGES_CHANGED';$result.WorldEffect=$run.Receipt.WorldEffect;$result.CharactersEffect=$run.Receipt.CharactersEffect;$result.MigrationSets=$run.Receipt.MigrationSets
   }
  }else{
   $stops=@();foreach($n in @($plan.Dev.World,$plan.Dev.Realm,$plan.Dev.MySQL)){
    $s=DevServiceRecord $run $n;Need ($s.State -ceq 'Stopped' -and $s.Processes.Count -eq 0 -and $s.Win32 -eq 0 -and $s.Specific -eq 0) 'DEV_NOT_CLEANLY_STOPPED'
    $stop=GetJson (Join-Path (Split-Path $ReceiptPath) ($n+'-STOP-RESULT.json'));Need ($stop.Result -ceq 'PASS') ('STOP_NOT_PASS '+$n)
    Need ($stop.ResultKnown -and $stop.ProcessExits.Count -eq $(if($n -ceq $plan.Dev.MySQL){2}else{1}) -and $null -eq $stop.PrimaryError -and $stop.EvidenceErrors.Count -eq 0 -and $stop.CleanupErrors.Count -eq 0) 'STOP_PROOF_SET_OR_ERRORS'
    foreach($exit in $stop.ProcessExits){Need ($exit.Measurement -ceq 'MEASURED' -and $null -ne $exit.NativeExit -and $exit.NativeExit -eq 0) 'STOP_NATIVE_NOT_MEASURED_ZERO';$match=@($stop.ExpectedProcesses|Where-Object {$_.PID -eq $exit.PID -and $_.Path -ceq $exit.Path -and ([DateTimeOffset]::Parse($_.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($exit.CreatedUtc)).UtcTicks});Need ($match.Count -eq 1) 'STOP_EXPECTED_GENERATION'}
    $stops+=@($stop)
   }
   foreach($p in @(23306,23724,28085,27878)){Need (@(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue).Count -eq 0) 'DEV_LISTENER_REMAINS'}
   $result.StopResults=$stops;$result.ClientSmoke='NOT_RUN'
  }
 }
 $result.VerifiedUUID=$r.DevUUID;$result.ResumeBindingSHA256=$r.ResumeBindingSHA256;$result.ContinuationBindingSHA256=Hash (Join-Path $PSScriptRoot 'CONTINUATION-BINDING.json');$result.Production='UNCHANGED_GENERATIONS_PORTS_PROTECTED_FILES_SCM';$result.OldDEV='STOPPED_PRESERVED';$result.Result='PASS'
}catch{$result.Result='FAIL';$result.Error=$_.Exception.Message;$result.Position=$_.InvocationInfo.PositionMessage}

return [pscustomobject]$result
}

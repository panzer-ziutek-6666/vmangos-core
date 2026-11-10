. (Join-Path $PSScriptRoot 'Kit.Common.ps1')
. (Join-Path $PSScriptRoot 'Native.Driver.ps1')
. (Join-Path $PSScriptRoot 'Comparison.SQL.ps1')
$script:InheritedFullStep=(Get-Command InvokeNativeStep).ScriptBlock
function Assert-FullApprovalTiming($Approval){
 $now=[DateTimeOffset]::UtcNow;$issued=([DateTimeOffset]::Parse($Approval.IssuedUtc)).ToUniversalTime();$expiry=([DateTimeOffset]::Parse($Approval.ExpiresUtc)).ToUniversalTime()
 Need ($issued -le $now -and $issued -ge $now.AddHours(-24) -and $expiry -gt $now -and $expiry -le $issued.AddHours(24)) 'FRESH_APPROVAL_WINDOW_MAX_24H'
}
function Assert-FullPrivateDefaults($Run,[string]$Path){
 Need ($Path -ceq $Run.Plan.FullCandidate.SourceDefaults) 'EXACT_EXISTING_CREDENTIAL_PATH_REQUIRED';AssertPrivate $Path
 $text=[IO.File]::ReadAllText($Path);$keys=@();$sections=0
 foreach($line in ($text -split "`r?`n")){$v=$line.Trim();if(!$v -or $v.StartsWith('#') -or $v.StartsWith(';')){continue};if($v -ceq '[client]'){$sections++;continue};$m=[regex]::Match($v,'^([a-zA-Z0-9_-]+)\s*=');Need $m.Success 'CLIENT_CONFIG_DIRECTIVE_REFUSED';$keys+=@($m.Groups[1].Value.ToLowerInvariant())}
 Need ($sections -eq 1 -and $keys.Count -eq 2 -and @($keys|Sort-Object -Unique).Count -eq 2 -and 'user' -cin $keys -and 'password' -cin $keys) 'CLIENT_CONFIG_ONLY_USER_PASSWORD'
 $text=$null
 Need (!(Test-Path (Join-Path $env:APPDATA 'MySQL\.mylogin.cnf')) -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('MYSQL_TEST_LOGIN_FILE','Process'))) 'IMPLICIT_MYSQL_LOGIN_REQUIRES_REVIEW'
}
function Get-FullSteps {
 @('Guard','ValidateInputs','Gate','BackupFiles','StageController','RegisterRelease','BeginTransition','StopWorld','StopRealm','LogicalBackup','VerifyBackup','CapturePreimages','ApplyWorld','VerifyWorld','ApplyCharacters','VerifyCharacters','VerifySQLSets','ExportPreimages','IndependentSQL','StopMySQL','StageSymbols','WriteBinaries','VerifyPair','WriteReceipts','WriteRoutes','StartMySQL','StartRealm','StartWorld','Ready','RequestCommit','Samples','PublishBundle','RestoreTasks','VerifyMigration')
}
function Assert-FullCandidate($Run){
 $b=$Run.Plan.FullCandidate
 Need ((Hash $b.Manifest) -ceq $b.SHA256 -and $b.SHA256 -ceq 'D3FD840BFDC65D5852612DA64005F2945689D3A66308525CD8B7B059878A4DBB') 'FULL_CANDIDATE_MANIFEST'
 foreach($a in $Run.Plan.Artifacts){Need ((Hash $a.Path) -ceq $a.SHA256) ('FULL_ARTIFACT '+$a.Role)}
 foreach($q in $b.SQL){Need ((Hash $q.Path) -ceq $q.SHA256) ('FULL_SQL '+$q.Id)}
 Need ((Hash $b.SourceHeader) -ceq $b.SourceHeaderSHA256 -and (Hash (Join-Path $PSScriptRoot 'EXPECTED-MIGRATIONS.json')) -ceq $b.ExpectedSetsSHA256) 'FULL_EXPECTED_SETS'
 Need ((Hash $b.DevLedger) -ceq $b.DevLedgerSHA256) 'EXACT_DEV_LEDGER'
 foreach($phase in @('DevMigrations','DevAccept')){
  $ref=$b.$phase;Need ((Hash $ref.Receipt) -ceq $ref.ReceiptSHA256 -and (Hash $ref.Verifier) -ceq $ref.VerifierSHA256 -and $ref.NativeExit -eq 0 -and $ref.VerifierNativeExit -eq 0) 'EXACT_DEV_EVIDENCE'
  $r=GetJson $ref.Receipt;$v=GetJson $ref.Verifier
  Need ($r.Operation -ceq $ref.Operation -and $r.Result -ceq 'PASS' -and $r.CandidateManifestSHA256 -ceq $b.SHA256 -and $r.DevUUID -ceq '650601ed-dc07-11f1-b12b-b0227ad7e1e2' -and $v.Result -ceq 'PASS' -and $v.ReceiptSHA256 -ceq $ref.ReceiptSHA256) 'EXACT_DEV_BINDING'
 }
}
function Assert-FullDEVStopped {
 foreach($prefix in @('VMANGOS-R3DEV-','VMANGOS-COREUPD-DEV-')){foreach($role in @('MySQL','realmd','mangosd')){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$prefix+$role+"'");Need ($s.State -ceq 'Stopped' -and $s.ProcessId -eq 0) 'DEV_NOT_STOPPED'}}
 Need (@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -in @(13306,13724,18085,17878,23306,23724,28085,27878)).Count -eq 0) 'DEV_LISTENER_PRESENT'
 $ps=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -like 'C:\Scripts\WOW-R3-DEV-R1\*' -or $_.ExecutablePath -like 'C:\Scripts\WOW-COREUPDATE-DEV-R1\*'});Need ($ps.Count -eq 0) 'DEV_PROCESS_PRESENT'
}
function Get-FullSQLTokens($Run){
 $i=$Run.State.MigrationDefaults;Need ((Hash $i.Path) -ceq $i.SHA256) 'MIGRATION_CREDENTIAL_FILE_CHANGED'
 @(('--defaults-file='+$i.Path),'--no-login-paths','--protocol=TCP','--host=127.0.0.1','--port=3306','--connect-timeout=3','--skip-reconnect','--local-infile=0','--default-character-set=utf8mb4','--batch','--raw','--skip-column-names')
}
function Invoke-FullSQLRaw($Run,[string]$SQL,[string]$Tag,[string]$File){
 if(!$File){$File=Join-Path $Run.Out ($Tag+'.private.sql');Need (!(Test-Path $File)) 'SQL_INPUT_NO_OVERWRITE';[IO.File]::WriteAllText($File,$SQL,[Text.UTF8Encoding]::new($false))}
 $r=InvokeInputFile $Run (Join-Path $Run.Plan.MySQLBin 'mysql.exe') @(Get-FullSQLTokens $Run) $File $Tag 300000
 Need ([string]::IsNullOrWhiteSpace([IO.File]::ReadAllText($r.Stderr))) ('SQL_STDERR '+$Tag)
 [IO.File]::ReadAllText($r.Stdout).Trim()
}
function Assert-FullEndpoint($Run){
 $before=Get-BackendStopObservation 'VMANGOS-MySQL';Need ($before.State -ceq 'Running' -and $before.Processes.Count -eq 2) 'SOURCE_MYSQL_PAIR_REQUIRED'
 $ls=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction Stop);Need ($ls.Count -gt 0 -and @($ls|Where-Object {$_.OwningProcess -notin @($before.Processes.PID)}).Count -eq 0) 'SOURCE_PORT_OWNER'
 $s=Invoke-FullSQLRaw $Run 'SELECT @@hostname,@@port,@@datadir,@@server_uuid;' ('ATTEST-'+[guid]::NewGuid().ToString('N')) ''
 $v=$s.Split([char]9);Need ($v.Count -eq 4 -and $v[0] -ceq 'WOW-SRV' -and $v[1] -ceq '3306' -and $v[3] -ceq $Run.Plan.FullCandidate.SourceUUID -and [IO.Path]::GetFullPath($v[2].Replace('/','\')).TrimEnd('\') -ieq $Run.Plan.FullCandidate.SourceDatadir.TrimEnd('\')) 'SOURCE_UUID_DATADIR'
 $after=Get-BackendStopObservation 'VMANGOS-MySQL'
 Need ($after.State -ceq 'Running' -and $after.Processes.Count -eq 2) 'SOURCE_CHANGED_DURING_ATTESTATION'
 foreach($p in $before.Processes){$a=@($after.Processes|Where-Object PID -eq $p.PID);Need ($a.Count -eq 1 -and $a[0].Path -ceq $p.Path -and ([DateTimeOffset]::Parse($a[0].CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks) 'SOURCE_GENERATION_CHANGED'}
 $Run.Receipt.LastSourceAttestation=@{AtUtc=[DateTimeOffset]::UtcNow.ToString('o');UUID=$v[3];Port=3306;Datadir=$v[2];Processes=$after.Processes}
}
function Invoke-FullSQL($Run,[string]$SQL,[string]$Tag,[switch]$Write,[string]$File){
 Assert-FullEndpoint $Run
 if($Write){Assert-BackendQuiescent 'mangosd';Assert-BackendQuiescent 'realmd';Need ($Run.Receipt.Contains('LogicalBackup') -and $Run.Receipt.LogicalBackup.NativeExit -eq 0 -and (Hash $Run.Receipt.LogicalBackup.Path) -ceq $Run.Receipt.LogicalBackup.SHA256) 'VERIFIED_FINAL_WRITE_BACKUP_REQUIRED'}
 $result=Invoke-FullSQLRaw $Run $SQL ($Tag+'-'+[guid]::NewGuid().ToString('N')) $File
 Assert-FullEndpoint $Run
 return $result
}
function Assert-FullSQLSets($Run,[bool]$After){
 $sets=GetJson (Join-Path $PSScriptRoot 'EXPECTED-MIGRATIONS.json');$result=@()
 foreach($set in $sets){$actual=@((Invoke-FullSQL $Run ('SELECT id FROM '+$set.Database+'.migrations ORDER BY id;') 'FULL-MIGRATIONS') -split "`r?`n"|Where-Object {$_});$want=@($(if($After){$set.Required}else{$set.Before}));Need (@($want|Where-Object {$_ -cnotin $actual}).Count -eq 0 -and @($actual|Where-Object {$_ -cnotin $want}).Count -eq 0 -and $actual.Count -eq $want.Count) ('MIGRATION_SET_CHANGED '+$set.Database);$result+=@(@{Database=$set.Database;Count=$actual.Count;Missing=0;Extra=0})}
 $Run.Receipt.MigrationSets=$result
}
function Get-FullColumns($Run,[string]$Schema,[string]$Table){
 Need ($Schema -cin @('mangos_dev','characters_dev') -or $Schema -ceq $Run.Receipt.AuditSchema) 'COLUMN_SCHEMA_GUARD'
 Need ($Table -cin @('quest_template','character_queststatus','characters','world_before','world_expected','queststatus_before','queststatus_expected','characters_before','expected_deleted')) 'COLUMN_TABLE_GUARD'
 $v=Invoke-FullSQL $Run ("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='"+$Schema+"' AND TABLE_NAME='"+$Table+"' ORDER BY ORDINAL_POSITION;") 'COLUMNS'
 $cols=@($v -split "`r?`n"|Where-Object {$_});Need ($cols.Count -ge 2) 'COLUMNS_REQUIRED';foreach($c in $cols){Need ($c -cmatch '^[A-Za-z0-9_]+$') 'COLUMN_NAME'};return $cols
}
function New-FullPreimageSQL($Run){
 $audit=$Run.Receipt.AuditSchema;Need ($audit -cmatch '^vmangos_migration_audit_[a-f0-9]{32}$') 'AUDIT_OPERATION_NAMESPACE'
 $world=[IO.File]::ReadAllText($Run.Plan.FullCandidate.SQL[0].Path);$chars=[IO.File]::ReadAllText($Run.Plan.FullCandidate.SQL[1].Path)
 $updates=[regex]::Matches($world,'UPDATE `quest_template` SET `RequiredRaces` = (\d+) WHERE (.*?);')
 $deletes=[regex]::Matches($chars,'(?s)DELETE `qs` FROM `character_queststatus` `qs` JOIN `characters` `c` ON `c`.`guid` = `qs`.`guid`\s+WHERE (.*?);')
 Need ($updates.Count -eq 7 -and $deletes.Count -eq 2) 'PINNED_DML_SHAPE'
 $sql='CREATE DATABASE '+$audit+'; USE '+$audit+';'
 foreach($pair in @(@('world_before','mangos_dev.quest_template'),@('world_expected','mangos_dev.quest_template'),@('queststatus_before','characters_dev.character_queststatus'),@('queststatus_expected','characters_dev.character_queststatus'),@('characters_before','characters_dev.characters'))){$t=$audit+'.'+$pair[0];$sql+='CREATE TABLE '+$t+' LIKE '+$pair[1]+'; INSERT INTO '+$t+' SELECT * FROM '+$pair[1]+';'}
 foreach($u in $updates){$sql+='UPDATE '+$audit+'.world_expected SET RequiredRaces='+$u.Groups[1].Value+' WHERE '+$u.Groups[2].Value+';'}
 $sql+='CREATE TABLE '+$audit+'.expected_deleted LIKE characters_dev.character_queststatus;'
 foreach($q in $deletes){$predicate=$q.Groups[1].Value;$sql+='INSERT INTO '+$audit+'.expected_deleted SELECT qs.* FROM '+$audit+'.queststatus_before qs JOIN '+$audit+'.characters_before c ON c.guid=qs.guid WHERE '+$predicate+'; DELETE qs FROM '+$audit+'.queststatus_expected qs JOIN '+$audit+'.characters_before c ON c.guid=qs.guid WHERE '+$predicate+';'}
 return $sql
}
function Assert-FullAuditSchema($Run){
 $audit=$Run.Receipt.AuditSchema
 foreach($pair in @(@('mangos_dev','quest_template','world_before','entry,patch'),@('mangos_dev','quest_template','world_expected','entry,patch'),@('characters_dev','character_queststatus','queststatus_before','guid,quest'),@('characters_dev','character_queststatus','queststatus_expected','guid,quest'),@('characters_dev','character_queststatus','expected_deleted','guid,quest'),@('characters_dev','characters','characters_before','guid'))){
  $key=Invoke-FullSQL $Run ("SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='"+$pair[0]+"' AND TABLE_NAME='"+$pair[1]+"' AND INDEX_NAME='PRIMARY';") 'SOURCE-KEY'
  $copy=Invoke-FullSQL $Run ("SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='"+$audit+"' AND TABLE_NAME='"+$pair[2]+"' AND INDEX_NAME='PRIMARY';") 'COPY-KEY'
  Need ($key -ceq $pair[3] -and $copy -ceq $pair[3]) 'AUDIT_PRIMARY_KEY'
  $metadata=@();foreach($t in @(@($pair[0],$pair[1]),@($audit,$pair[2]))){$metadata+=@(Invoke-FullSQL $Run ("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA,COALESCE(CHARACTER_SET_NAME,''),COALESCE(COLLATION_NAME,''),'ROW_END' FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='"+$t[0]+"' AND TABLE_NAME='"+$t[1]+"' ORDER BY ORDINAL_POSITION;") 'SCHEMA')};Need ($metadata[0] -ceq $metadata[1] -and $metadata[0].Length -gt 30) 'AUDIT_COLUMN_SCHEMA'
 }
}
function Assert-FullRows($Run,[string]$Actual,[string]$Expected,[string[]]$Keys){
 $p=$Actual.Split('.');$columns=@(Get-FullColumns $Run $p[0] $p[1]);$sql=New-RowSetComparisonSQL $Actual $Expected $columns $Keys
 $value=Invoke-FullSQL $Run $sql 'FULL-ROW-COMPARISON';Need ($value -ceq "0`t0`t0") ('FULL_ROWS_MISSING_EXTRA_CHANGED '+$Actual)
}
function Verify-FullWorld($Run){
 $audit=$Run.Receipt.AuditSchema;Assert-FullRows $Run 'mangos_dev.quest_template' ($audit+'.world_expected') @('entry','patch')
 $actual=Invoke-FullSQL $Run (New-MaskCountSQL 'mangos_dev.quest_template' ($audit+'.world_before')) 'MASK-ACTUAL'
 $expected=Invoke-FullSQL $Run (New-MaskCountSQL ($audit+'.world_expected') ($audit+'.world_before')) 'MASK-EXPECTED'
 Need ($actual -cmatch '^\d+$' -and $actual -ceq $expected) 'MASK_COUNT'
 $Run.Receipt.WorldEffect=@{ActualMaskChanges=[long]$actual;ExpectedMaskChanges=[long]$expected;PrimaryKey=@('entry','patch');Missing=0;Extra=0;ChangedUnexpected=0;AllColumns=$true}
}
function Verify-FullCharacters($Run){
 $audit=$Run.Receipt.AuditSchema;Assert-FullRows $Run 'characters_dev.character_queststatus' ($audit+'.queststatus_expected') @('guid','quest');Assert-FullRows $Run 'characters_dev.characters' ($audit+'.characters_before') @('guid')
 $counts=Invoke-FullSQL $Run ('SELECT (SELECT COUNT(*) FROM '+$audit+'.expected_deleted),(SELECT COUNT(*) FROM '+$audit+'.queststatus_before)-(SELECT COUNT(*) FROM characters_dev.character_queststatus),(SELECT COUNT(*) FROM '+$audit+'.expected_deleted e JOIN characters_dev.character_queststatus a USING(guid,quest));') 'DELETED-COUNTS'
 $p=$counts.Split([char]9);Need ($p.Count -eq 3 -and $p[0] -cmatch '^\d+$' -and $p[0] -ceq $p[1] -and $p[2] -ceq '0') 'DELETED_SET'
 $Run.Receipt.CharactersEffect=@{ExpectedDeleted=[long]$p[0];ActualDeleted=[long]$p[1];PrimaryKey=@('guid','quest');Missing=0;Extra=0;ChangedUnexpected=0;AllColumns=$true}
}
function Invoke-FullPinnedMigration($Run,[int]$Index){
 Assert-FullCandidate $Run;$q=$Run.Plan.FullCandidate.SQL[$Index]
 Need (!$Run.Receipt.SQLAttempted.Contains($q.Id)) 'MIGRATION_ALREADY_ATTEMPTED_NO_RETRY'
 $file=Join-Path $Run.Out ('APPLY-'+$q.Id+'.private.sql');Need (!(Test-Path $file)) 'MIGRATION_INPUT_EXISTS'
 [IO.File]::WriteAllText($file,('USE '+$q.Database+";`r`n"+[IO.File]::ReadAllText($q.Path)),[Text.UTF8Encoding]::new($false))
 # Persist attempt BEFORE any client call: SQL marker/procedure DDL is not atomic.
 $Run.Receipt.SQLAttempted[$q.Id]=@{SourceSHA256=$q.SHA256;InputSHA256=(Hash $file);AttemptUtc=[DateTimeOffset]::UtcNow.ToString('o');Result='UNKNOWN_UNTIL_VERIFIED'}
 DurableJson (Join-Path $Run.Out 'RECEIPT.json') $Run.Receipt
 [void](Invoke-FullSQL $Run '' ('APPLY-'+$q.Id) -Write -File $file)
}
function Get-FullRollbackDecision($Prior){
 Need ($null -ne $Prior.SQLAttempted) 'ROLLBACK_SQL_HISTORY_UNKNOWN'
 $attempted=@($Prior.SQLAttempted.PSObject.Properties|Where-Object MemberType -eq NoteProperty).Count
 if($Prior.SQLAttempted -is [System.Collections.IDictionary]){$attempted=$Prior.SQLAttempted.Count}
 if($attempted -gt 0){return 'DATA_CHANGED_OR_UNKNOWN_REQUIRES_SEPARATE_REVIEW_NO_AUTOMATIC_RESTORE'}
 return 'PRE_SQL_FILES_ONLY_SEPARATE_ROLLBACK_APPROVAL_REQUIRED'
}
function Assert-FullBackup($Run){
 $b=$Run.Receipt.LogicalBackup;Need ($b.NativeExit -eq 0 -and $b.SourcePort -eq 3306 -and (Hash $b.Path) -ceq $b.SHA256 -and $b.ConsistentSnapshot -ceq 'ALL_INNODB_SINGLE_TRANSACTION_NO_DDL_WINDOW') 'LOGICAL_BACKUP_PROOF'
 $reader=[IO.StreamReader]::new($b.Path);$seen=[Collections.Generic.HashSet[string]]::new();$tables=@{};$db=$null;$complete=$false
 try{while(!$reader.EndOfStream){$line=$reader.ReadLine();if($line -cmatch '^USE `([a-z0-9_]+)`;'){$db=$Matches[1];[void]$seen.Add($db);if(!$tables.ContainsKey($db)){$tables[$db]=0}};if($line -cmatch '^CREATE TABLE `'){$tables[$db]++};if($line -clike '-- Dump completed on*'){$complete=$true}}}finally{$reader.Dispose()}
 Need ($complete -and $seen.Count -eq 4) 'BACKUP_COMPLETENESS'
 foreach($name in $Run.Plan.DatabaseNames){$count=Invoke-FullSQL $Run ("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='"+$name+"' AND TABLE_TYPE='BASE TABLE';") 'BACKUP-TABLE-COUNT';Need ($seen.Contains($name) -and $count -cmatch '^\d+$' -and $tables[$name] -eq [long]$count) 'BACKUP_TABLE_SET'}
 $Run.Receipt.BackupVerification=@{Result='PASS';FourDatabases=$true;TableCounts=$tables;NativeExit=0;SHA256=$b.SHA256;RestoreTest='NOT_RUN';BackupAfterConfirmedFinalWrites=$true}
}
function Invoke-FullStep($Run,$Inputs,[string]$Step){
 switch($Step){
  'Guard'{AssertBaseline $Run;Assert-FullCandidate $Run;Assert-FullDEVStopped;LoadProduction $Run;AssertTaskBaseline $Run;$s=Read-ControlState $Run.Plan.Maintenance 'mangosd';Need ($s.Phase -ceq 'Stable' -and (Get-CurrentStatus).Ready) 'HEALTHY_STABLE_STACK_REQUIRED';$reg=Get-ReleaseRegistryState $Run.State.Release;Need ($reg.phase -ceq 'stable' -and $reg.active.id -ceq $Run.Plan.BeforeRelease.id -and $reg.active.sha256 -ceq $Run.Plan.BeforeRelease.sha256 -and !(Test-Path $Run.Plan.VersionRoot)) 'ACTIVE_RELEASE_OR_VERSION_ROOT_DRIFT';$Run.Receipt.BeforeIntent=$s;$Run.Receipt.StartedUtc=[DateTimeOffset]::UtcNow.ToString('o');$Run.Receipt.SQLAttempted=[ordered]@{};$Run.Receipt.AuditSchema='vmangos_migration_audit_'+$Run.Id;$Run.Receipt.CandidateManifestSHA256=$Run.Plan.FullCandidate.SHA256}
  'ValidateInputs'{Assert-FullPrivateDefaults $Run $Inputs.SourceDefaults;ValidateBackupInputsR2 $Run $Inputs;CaptureControlTasksR2 $Run;$path=RequirePrivateInput $Inputs 'SourceMigrationDefaults';Assert-FullPrivateDefaults $Run $path;$Run.State.MigrationDefaults=@{Path=$path;SHA256=(Hash $path)};Need ($Run.State.Approval.Scope -ceq 'MigrateFull' -and $Run.State.Approval.AllowPrivateAuditSchema -is [bool] -and $Run.State.Approval.AllowPrivateAuditSchema -and @($Run.State.Approval.AllowSQL).Count -eq 2 -and ($Run.State.Approval.AllowSQL -join ',') -ceq '20261025125310,20261025125408' -and $Run.State.Approval.SnapshotStrategy -ceq 'AllInnoDB' -and $Run.State.Approval.AllowGlobalReadLock -is [bool] -and !$Run.State.Approval.AllowGlobalReadLock) 'EXACT_FUTURE_SQL_CONSENT';Assert-FullEndpoint $Run;Assert-FullSQLSets $Run $false
   $grants=Invoke-FullSQL $Run 'SHOW GRANTS;' 'FUTURE-GRANTS';$global=@($grants -split "`r?`n"|Where-Object {$_ -match ' ON \*\.\* TO '}) -join "`n";foreach($priv in @('SELECT','INSERT','UPDATE','DELETE','CREATE','CREATE ROUTINE','ALTER ROUTINE','EXECUTE','SHOW VIEW','TRIGGER','EVENT','PROCESS','SHOW_ROUTINE')){Need ($global -match ('(?:GRANT\s+|,\s*)'+[regex]::Escape($priv)+'(?:,|\s+ON)') -or $global -match '^GRANT ALL PRIVILEGES') ('MIGRATION_GLOBAL_PRIVILEGE_UNPROVEN '+$priv)}
   $eng=Invoke-FullSQL $Run "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('realmd_dev','mangos_dev','characters_dev','logs_dev') AND TABLE_TYPE='BASE TABLE' AND ENGINE<>'InnoDB';" 'ENGINES';Need ($eng -ceq '0') 'ALL_INNODB_REQUIRED';$ddl=Invoke-FullSQL $Run "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND COMMAND<>'Sleep' AND COALESCE(INFO,'') REGEXP '(^|[[:space:];])(ALTER|CREATE|DROP|RENAME|TRUNCATE)[[:space:]]';" 'DDL';Need ($ddl -ceq '0') 'ACTIVE_DDL_REQUIRES_STOP_BEFORE_GATE';$Run.Receipt.InputBindings=@{SourceDefaultsSHA256=(Hash $Inputs.SourceDefaults);SourceMigrationDefaultsSHA256=(Hash $path)}
   $bytes=Invoke-FullSQL $Run "SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('realmd_dev','mangos_dev','characters_dev','logs_dev');" 'BACKUP-BYTES';Need ($bytes -cmatch '^\d+$') 'DB_SIZE_UNKNOWN';[long]$needBytes=[long]$bytes*6+1GB;if($needBytes -lt 20GB){$needBytes=20GB};[long]$free=(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace;Need ($free -gt $needBytes) 'INSUFFICIENT_BACKUP_AND_PREIMAGE_SPACE';$Run.Receipt.BackupSpace=@{RequiredBytes=$needBytes;AvailableBytes=$free;Estimate='max20GiB or 6x physical database estimate plus1GiB; not a guaranteed upper bound'}}
  'LogicalBackup'{Assert-BackendQuiescent 'mangosd';Assert-BackendQuiescent 'realmd';Assert-FullEndpoint $Run;[void](& $script:InheritedFullStep $Run $Inputs $Step);Assert-FullEndpoint $Run}
  'VerifyBackup'{Assert-FullBackup $Run}
  'CapturePreimages'{Assert-FullSQLSets $Run $false;[void](Invoke-FullSQL $Run (New-FullPreimageSQL $Run) 'CAPTURE-PREIMAGES' -Write);Assert-FullAuditSchema $Run;Assert-FullRows $Run 'mangos_dev.quest_template' ($Run.Receipt.AuditSchema+'.world_before') @('entry','patch');Assert-FullRows $Run 'characters_dev.character_queststatus' ($Run.Receipt.AuditSchema+'.queststatus_before') @('guid','quest')}
  'ApplyWorld'{Invoke-FullPinnedMigration $Run 0}
  'VerifyWorld'{Verify-FullWorld $Run;$Run.Receipt.SQLAttempted['20261025125310'].Result='DATA_VERIFIED'}
  'ApplyCharacters'{Assert-FullRows $Run 'characters_dev.character_queststatus' ($Run.Receipt.AuditSchema+'.queststatus_before') @('guid','quest');Invoke-FullPinnedMigration $Run 1}
  'VerifyCharacters'{Verify-FullCharacters $Run;$Run.Receipt.SQLAttempted['20261025125408'].Result='DATA_VERIFIED'}
  'VerifySQLSets'{Assert-FullSQLSets $Run $true}
  'ExportPreimages'{$path=Join-Path $Run.Out 'PREIMAGES.private.sql';Need (!(Test-Path $path)) 'PREIMAGE_EXPORT_EXISTS';$argsList=@(('--defaults-file='+$Run.State.MigrationDefaults.Path),'--no-login-paths','--protocol=TCP','--host=127.0.0.1','--port=3306','--single-transaction','--skip-add-locks','--skip-disable-keys','--order-by-primary','--hex-blob','--set-gtid-purged=OFF','--no-tablespaces',('--result-file='+$path),$Run.Receipt.AuditSchema);$r=NativeKit $Run (Join-Path $Run.Plan.MySQLBin 'mysqldump.exe') $argsList 'EXPORT-PREIMAGES' 3600000;$Run.Receipt.PreimageExport=@{Path=$path;SHA256=(Hash $path);NativeExit=$r.ExitCode;AuditSchema=$Run.Receipt.AuditSchema}}
  'IndependentSQL'{DurableJson (Join-Path $Run.Out 'RECEIPT.json') $Run.Receipt;$proof=Join-Path $Run.Out 'SQL-INDEPENDENT.json';$r=NativeKit $Run 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' @('-NoProfile','-File',(Join-Path $PSScriptRoot 'Verify-QuiescentSQL.ps1'),'-Receipt',(Join-Path $Run.Out 'RECEIPT.json'),'-Defaults',$Run.State.MigrationDefaults.Path,'-Output',$proof) 'INDEPENDENT-SQL' 600000;$v=GetJson $proof;Need ($v.Result -ceq 'PASS' -and $v.Operation -ceq $Run.Id) 'INDEPENDENT_SQL_REFUSED';$Run.Receipt.SQLIndependent=@{Path=$proof;SHA256=(Hash $proof);NativeExit=$r.ExitCode;ReceiptAtVerificationSHA256=$v.ReceiptSHA256}}
  'StageSymbols'{Need (!(Test-Path $Run.Plan.FullCandidate.SymbolRoot)) 'SYMBOL_ROOT_EXISTS_REVIEW_REQUIRED';[void][IO.Directory]::CreateDirectory($Run.Plan.FullCandidate.SymbolRoot);$Run.Receipt.Symbols=@(foreach($a in $Run.Plan.Artifacts|Where-Object Role -like '*.pdb'){$p=Join-Path $Run.Plan.FullCandidate.SymbolRoot $a.Role;[IO.File]::Copy($a.Path,$p,$false);Need ((Hash $p) -ceq $a.SHA256) 'SYMBOL_HASH';@{Path=$p;SHA256=$a.SHA256}})}
  'VerifyPair'{[void](Test-ReleaseSet (GetJson (Join-Path $PSScriptRoot 'RELEASE-MANIFEST.json')) $Run.Plan.Runtime $Run.Plan.FullCandidate.RuntimePrefix)}
  'WriteRoutes'{foreach($f in $Run.Plan.Files|Where-Object Group -ceq 'Routes'){if((Hash $f.Target) -cne $f.SHA256){WriteBoundFile $Run $f};$Run.Receipt.WrittenHashes[$f.Id]=Hash $f.Target}}
  'VerifyMigration'{[void](& $script:InheritedFullStep $Run $Inputs $Step);foreach($p in $Run.Plan.FullCandidate.Protection){Need ((Hash $p.Path) -ceq $p.SHA256 -and (Get-Acl $p.Path).Sddl -ceq $p.SDDL) 'PROTECTED_CONFIG_DLL_CHANGED'};Assert-FullDEVStopped;$Run.Receipt.WindowsReboot='NOT_RUN';$Run.Receipt.SCMRecovery='NOT_PROVEN';$Run.Receipt.ClientSmoke='NOT_RUN'}
  default{[void](& $script:InheritedFullStep $Run $Inputs $Step)}
 }
 Ack
}
function New-FullDriver($Run,$Inputs){
 $d=NewNativeDriver $Run $Inputs
 foreach($step in @(Get-FullSteps)){$name=$step;$d[$step]={Invoke-FullStep $Run $Inputs $name}.GetNewClosure()}
 return $d
}

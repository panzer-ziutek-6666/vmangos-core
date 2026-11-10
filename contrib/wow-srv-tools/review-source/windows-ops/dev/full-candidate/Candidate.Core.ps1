. (Join-Path $PSScriptRoot 'Kit.Common.ps1')
. (Join-Path $PSScriptRoot 'Native.Driver.ps1')
$script:Stage='COREUPDATE-DEV-CONTINUE-R3-WOW-SRV-20261109-0850'
$script:Root=$PSScriptRoot
$script:Out=Join-Path 'C:\GRY\wow\diagnostics' $script:Stage
function AssertCandidateInputs($Run){
 $b=$Run.Plan.CandidateBinding
 Need ($b.ManifestSHA256 -ceq 'D3FD840BFDC65D5852612DA64005F2945689D3A66308525CD8B7B059878A4DBB' -and $b.DevPlanSHA256 -ceq 'F46981486C5069A477BC107A6E6DCC57FCCFD351BC4085B27708D21F3116EBC0' -and (Hash $b.Manifest) -ceq $b.ManifestSHA256 -and (Hash $b.DevPlan) -ceq $b.DevPlanSHA256) 'CANDIDATE_BINDING'
 foreach($a in $Run.Plan.Artifacts){Need ((Hash $a.Path) -ceq $a.SHA256) ('CANDIDATE_ARTIFACT_CHANGED '+$a.Role)}
 foreach($q in $b.SQL){Need ((Hash $q.Path) -ceq $q.SHA256) ('CANDIDATE_SQL_CHANGED '+$q.Id)}
}
function AssertDevNamespace($Run){
 $d=$Run.Plan.Dev
 Need ($d.Root -ceq 'C:\Scripts\WOW-COREUPDATE-DEV-R1' -and $d.Runtime -ceq ($d.Root+'\runtime') -and $d.Data -ceq ($d.Root+'\mysql-data') -and $d.MySQLIni -ceq ($d.Root+'\my.ini') -and $d.Defaults -ceq ($d.Root+'\private\client.ini') -and $d.Bind -ceq '127.0.0.1' -and $d.MySQLPort -eq 23306 -and $d.RealmPort -eq 23724 -and $d.WorldPort -eq 28085 -and $d.SOAPPort -eq 27878 -and $d.MySQL -ceq 'VMANGOS-COREUPD-DEV-MySQL' -and $d.Realm -ceq 'VMANGOS-COREUPD-DEV-realmd' -and $d.World -ceq 'VMANGOS-COREUPD-DEV-mangosd') 'EXACT_NEW_DEV_NAMESPACE_REQUIRED'
 Need ($Run.Kind -cin @('Backup','DevSetup','DevMigrations','DevAccept')) 'DEV_ONLY_PHASE'
}
function InvokeDevClient($Run,[string]$SQL,[string]$Tag,[string]$InputFile,[int]$Timeout=120000){
 AssertDevNamespace $Run
 $defaults=$Run.Plan.Dev.Defaults
 if($Run.State.ContainsKey('CredentialMode') -and $Run.State.CredentialMode -ceq 'Bootstrap'){$defaults=Join-Path $Run.Plan.Dev.Root 'private\bootstrap-client.ini'}
 AssertPrivate $defaults
 if(!$InputFile){$InputFile=Join-Path $Run.Out ($Tag+'.sql');Need (!(Test-Path $InputFile)) 'SQL_NO_OVERWRITE';[IO.File]::WriteAllText($InputFile,$SQL,[Text.UTF8Encoding]::new($false))}
 $tokens=@(('--defaults-file='+$defaults),'--no-login-paths','--protocol=TCP','--host=127.0.0.1','--port=23306','--connect-timeout=3','--skip-reconnect','--local-infile=0','--default-character-set=utf8mb4','--batch','--raw','--skip-column-names')
 $result=InvokeInputFile $Run (Join-Path $Run.Plan.MySQLBin 'mysql.exe') $tokens $InputFile $Tag $Timeout
 Need ([string]::IsNullOrWhiteSpace([IO.File]::ReadAllText($result.Stderr))) ('DEV_SQL_STDERR '+$Tag)
 return [IO.File]::ReadAllText($result.Stdout).Trim()
}
function AttestDevDB($Run){
 AssertDevNamespace $Run;AssertCandidateInputs $Run
 $d=$Run.Plan.Dev
 foreach($a in $Run.Plan.Artifacts|Where-Object Role -notlike '*.pdb'){Need ((Hash (Join-Path $d.Runtime ([IO.Path]::GetFileName($a.Path)))) -ceq $a.SHA256) 'DEV_RUNTIME_ARTIFACT_CHANGED'}
 $before=$null;Need (DevPortReady $Run $d.MySQL 23306 -Observation ([ref]$before)) 'DEV_OWNED_PORT_REQUIRED'
 Need ($Run.State.ContainsKey('DevUUID') -and $Run.State.DevUUID -cmatch '^[a-f0-9-]{36}$' -and $Run.State.DevUUID -cne $Run.Plan.CandidateBinding.SourceUUID) 'EXPECTED_NEW_UUID_REQUIRED'
 $identity=InvokeDevClient $Run 'SELECT @@port,@@datadir,@@server_uuid,@@global.event_scheduler,@@global.server_id,(SELECT COUNT(*) FROM performance_schema.replication_connection_configuration);' ('ATTEST-'+[guid]::NewGuid().ToString('N'))
 $parts=$identity.Split([char]9)
 Need ($parts.Count -eq 6 -and $parts[0] -ceq '23306' -and [IO.Path]::GetFullPath($parts[1].Replace('/','\')).TrimEnd('\') -ieq $d.Data -and $parts[2] -ceq $Run.State.DevUUID -and $parts[2] -cne $Run.Plan.CandidateBinding.SourceUUID -and $parts[3] -cin @('OFF','DISABLED') -and $parts[4] -ceq '0' -and $parts[5] -ceq '0') 'DEV_UUID_DATADIR_PORT_EVENT_REPLICATION_MISMATCH'
 $after=DevServiceRecord $Run $d.MySQL -ReadMode StartWait -Expected $before.Processes
 Need ($after.Ready -and $after.Processes.Count -eq 2) 'DEV_MYSQL_PAIR_NOT_CONFIRMED'
 $evidence=[pscustomobject]@{AtUtc=[DateTimeOffset]::UtcNow.ToString('o');Port=23306;Datadir=$d.Data;UUID=$parts[2];EventScheduler=$parts[3];ServerId=0;ReplicationChannels=0;Processes=$after.Processes}
 $Run.Receipt.LastDevAttestation=$evidence
 return $evidence
}
function DevSQL($Run,[string]$SQL,[string]$Tag){
 [void](AttestDevDB $Run)
 $value=InvokeDevClient $Run $SQL ($Tag+'-'+[guid]::NewGuid().ToString('N'))
 [void](AttestDevDB $Run)
 return $value
}
function InvokePinnedDevSQLFile($Run,[string]$Path,[string]$ExpectedSHA,[string]$Database,[string]$Tag){
 AssertCandidateInputs $Run
 Need ($Database -cin @('mangos_dev','characters_dev')) 'MIGRATION_DATABASE_ALLOWLIST'
 $match=@($Run.Plan.CandidateBinding.SQL|Where-Object {$_.Path -ceq $Path -and $_.SHA256 -ceq $ExpectedSHA -and $_.Database -ceq $Database})
 Need ($match.Count -eq 1 -and (Hash $Path) -ceq $ExpectedSHA) 'EXACT_REVIEWED_SQL_FILE_REQUIRED'
 [void](AttestDevDB $Run)
 # A private bound input adds only USE for the exact intended clone schema.
 $input=Join-Path $Run.Out ($Tag+'.sql');Need (!(Test-Path $input)) 'MIGRATION_ONE_ATTEMPT'
 [IO.File]::WriteAllText($input,('USE '+$Database+";`r`n"+[IO.File]::ReadAllText($Path)),[Text.UTF8Encoding]::new($false))
 [void](InvokeDevClient $Run '' $Tag $input 300000)
 [void](AttestDevDB $Run)
}
function ProvisionDevConfigs($Run,[string]$SecretPath){
 AssertDevNamespace $Run;AssertPrivate $SecretPath;$s=GetJson $SecretPath;$d=$Run.Plan.Dev
 foreach($key in @('DevAdminPassword','DevCorePassword')){Need ($s.$key -cmatch '^[A-Za-z0-9_-]{32,128}$') 'RANDOM_DEV_SECRET'};Need ($s.DevAdminPassword -cne $s.DevCorePassword) 'DISTINCT_DEV_SECRETS'
 foreach($name in @('mangosd','realmd')){
  $text=[IO.File]::ReadAllText((Join-Path $PSScriptRoot ('dev-templates\'+$name+'.conf.dist.in')))
  $map=@{BindIP='"127.0.0.1"';LogsDir=('"'+$d.Logs.Replace('\','/')+'"')}
  if($name -ceq 'mangosd'){
   $map.WorldServerPort='28085';$map.RealmID='1';$map.DataDir=('"'+$d.GameData.Replace('\','/')+'"');$map.'SOAP.Enabled'='0';$map.'SOAP.IP'='"127.0.0.1"';$map.'SOAP.Port'='27878';$map.LogTime='1';$map.'LogFile.Timestamp'='0';$map.AutoHonorRestart='1';$map.'AiPlayerbot.ConfigFile'=('"'+(Join-Path $d.Runtime 'aiplayerbot.conf').Replace('\','/')+'"');$map.'AiPlayerbot.Enabled'='0';$map.'AiPlayerbot.RandomBotAutologin'='0'
   foreach($pair in @(@('LoginDatabase.Info','realmd_dev'),@('WorldDatabase.Info','mangos_dev'),@('CharacterDatabase.Info','characters_dev'),@('LogsDatabase.Info','logs_dev'))){$map[$pair[0]]='"127.0.0.1;23306;r3dev;'+$s.DevCorePassword+';'+$pair[1]+'"'}
  }else{$map.RealmServerPort='23724';$map.LoginDatabaseInfo='"127.0.0.1;23306;r3dev;'+$s.DevCorePassword+';realmd_dev"'}
  foreach($key in $map.Keys){$text=SetDevConfig $text $key $map[$key]};[IO.File]::WriteAllText((Join-Path $d.Runtime ($name+'.conf')),$text,[Text.UTF8Encoding]::new($false))
 }
 [IO.File]::WriteAllText((Join-Path $d.Runtime 'aiplayerbot.conf'),"AiPlayerbot.Enabled = 0`r`nAiPlayerbot.RandomBotAutologin = 0`r`n",[Text.UTF8Encoding]::new($false))
 $ini="[mysqld]`r`nbasedir="+[IO.Path]::GetDirectoryName($Run.Plan.MySQLBin).Replace('\','/')+"`r`ndatadir="+$d.Data.Replace('\','/')+"`r`nport=23306`r`nbind-address=127.0.0.1`r`nmysqlx=0`r`nevent_scheduler=OFF`r`nserver-id=0`r`nskip-replica-start=ON`r`nlog-error="+(Join-Path $d.Logs 'mysql-error.log').Replace('\','/')+"`r`n"
 [IO.File]::WriteAllText($d.MySQLIni,$ini,[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText($d.Defaults,("[client]`r`nuser=root`r`npassword="+$s.DevAdminPassword+"`r`nhost=127.0.0.1`r`nport=23306`r`n"),[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $d.Root 'private\bootstrap-client.ini'),"[client]`r`nuser=root`r`nhost=127.0.0.1`r`nport=23306`r`n",[Text.UTF8Encoding]::new($false))
}
function Get-VerifiedPrior($Run,$Inputs,[string]$Kind){
 $ref=$Inputs.Priors.$Kind;AssertPrivate $ref.Receipt;AssertPrivate $ref.Verifier
 $allowed=$ref.Receipt.StartsWith($script:Out+'\runs\'+$Kind+'-',[StringComparison]::OrdinalIgnoreCase)
 if($Kind -ceq 'DevSetup'){
  $binding=GetJson (Join-Path $PSScriptRoot 'CONTINUATION-BINDING.json');$b=$binding.DevSetup
  Need ($ref.Receipt -ceq $b.Receipt -and $ref.ReceiptSHA256 -ceq $b.ReceiptSHA256 -and $ref.Operation -ceq $b.Operation -and $ref.Verifier -ceq (Join-Path $script:Out 'verified\DevSetup-5159397b4eeb42e0babb8724c4b64a9c\VERIFIER-R2.json') -and (Hash $b.ProcessRecord) -ceq $b.ProcessRecordSHA256 -and (Hash $b.OriginalVerifier) -ceq $b.OriginalVerifierSHA256) 'EXACT_CONTINUATION_SETUP_ONLY';$allowed=$true
 }
 Need ($allowed -and (Hash $ref.Receipt) -ceq $ref.ReceiptSHA256 -and (Hash $ref.Verifier) -ceq $ref.VerifierSHA256) 'PRIOR_EXACT_PATH_HASH'
 $r=ReadJson $ref.Receipt;$v=ReadJson $ref.Verifier
 Need ($r.Kind -ceq $Kind -and $r.Result -ceq 'PASS' -and $r.Phase -ceq 'Complete' -and $r.CandidateManifestSHA256 -ceq $Run.Plan.CandidateBinding.ManifestSHA256 -and $r.PlanSHA256 -ceq $Run.Receipt.PlanSHA256 -and $r.Operation -ceq $ref.Operation -and $v.Result -ceq 'PASS' -and $v.ReceiptSHA256 -ceq $ref.ReceiptSHA256 -and $v.Operation -ceq $r.Operation) 'PRIOR_PHASE_VERIFIED_CANDIDATE_ONLY'
 if($Kind -ceq 'DevSetup'){Need ($r.DevUUID -ceq $b.UUID -and $v.VerifiedUUID -ceq $b.UUID -and $v.ContinuationBindingSHA256 -ceq (Hash (Join-Path $PSScriptRoot 'CONTINUATION-BINDING.json')) -and $r.PlanSHA256 -ceq $b.PlanSHA256 -and $r.CandidateManifestSHA256 -ceq $b.CandidateManifestSHA256) 'CONTINUATION_UUID_PLAN_CANDIDATE'}
 return $r
}
function InvokeDevPreMigrationBackup($Run){
 [void](AttestDevDB $Run)
 $dir=Join-Path $Run.Plan.BackupRoot ($Run.Id+'-pre-migration');NewPrivate $dir;$dump=Join-Path $dir 'four-databases.sql'
 $tokens=@(('--defaults-file='+$Run.Plan.Dev.Defaults),'--no-login-paths','--protocol=TCP','--host=127.0.0.1','--port=23306','--single-transaction','--quick','--routines','--events','--triggers','--hex-blob','--set-gtid-purged=OFF','--no-tablespaces',('--result-file='+$dump),'--databases')+@($Run.Plan.DatabaseNames)
 $r=NativeKit $Run (Join-Path $Run.Plan.MySQLBin 'mysqldump.exe') $tokens 'DEV-PRE-MIGRATION-DUMP' 3600000
 Need ((Get-Item $dump).Length -gt 10000) 'PREIMAGE_DUMP_EMPTY';[void](AttestDevDB $Run)
 $Run.Receipt.PreMigrationBackup=[pscustomobject]@{Path=$dump;SHA256=(Hash $dump);Bytes=(Get-Item $dump).Length;NativeExit=$r.ExitCode;Port=23306;UUID=$Run.State.DevUUID}
}
function GetDevColumns($Run,[string]$Database,[string]$Table){
 Need ($Database -cin @('mangos_dev','characters_dev') -and $Table -cin @('quest_template','character_queststatus')) 'AUDIT_TABLE_ALLOWLIST'
 $columns=(DevSQL $Run ("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='"+$Database+"' AND TABLE_NAME='"+$Table+"' ORDER BY ORDINAL_POSITION;") 'AUDIT-COLUMNS') -split "`r?`n"
 Need ($columns.Count -gt 2) 'AUDIT_COLUMNS_MISSING';foreach($c in $columns){Need ($c -cmatch '^[A-Za-z0-9_]+$') 'COLUMN_IDENTIFIER'};return $columns
}
function CaptureDevPreimages($Run){
 $world=[IO.File]::ReadAllText($Run.Plan.CandidateBinding.SQL[0].Path);$chars=[IO.File]::ReadAllText($Run.Plan.CandidateBinding.SQL[1].Path)
 $updates=[regex]::Matches($world,'UPDATE `quest_template` SET `RequiredRaces` = (\d+) WHERE (.*?);')
 $deletes=[regex]::Matches($chars,'(?s)DELETE `qs` FROM `character_queststatus` `qs` JOIN `characters` `c` ON `c`.`guid` = `qs`.`guid`\s+WHERE (.*?);')
 Need ($updates.Count -eq 7 -and $deletes.Count -eq 2) 'EXACT_SQL_PREDICATES_REQUIRED'
 $sql='CREATE DATABASE coreupdate_audit; CREATE TABLE coreupdate_audit.world_before LIKE mangos_dev.quest_template; INSERT INTO coreupdate_audit.world_before SELECT * FROM mangos_dev.quest_template; CREATE TABLE coreupdate_audit.world_expected LIKE mangos_dev.quest_template; INSERT INTO coreupdate_audit.world_expected SELECT * FROM mangos_dev.quest_template;'
 foreach($u in $updates){$sql+='UPDATE coreupdate_audit.world_expected SET RequiredRaces='+$u.Groups[1].Value+' WHERE '+$u.Groups[2].Value+';'}
 $sql+='CREATE TABLE coreupdate_audit.queststatus_before LIKE characters_dev.character_queststatus; INSERT INTO coreupdate_audit.queststatus_before SELECT * FROM characters_dev.character_queststatus; CREATE TABLE coreupdate_audit.characters_before AS SELECT guid,race FROM characters_dev.characters; CREATE TABLE coreupdate_audit.expected_deleted (guid INT UNSIGNED NOT NULL,quest INT UNSIGNED NOT NULL,PRIMARY KEY(guid,quest));'
 foreach($q in $deletes){$sql+='INSERT INTO coreupdate_audit.expected_deleted SELECT qs.guid,qs.quest FROM coreupdate_audit.queststatus_before qs JOIN coreupdate_audit.characters_before c ON c.guid=qs.guid WHERE '+$q.Groups[1].Value+';'}
 [void](DevSQL $Run $sql 'CAPTURE-PREIMAGES')
 $Run.Receipt.PreimageCounts=DevSQL $Run 'SELECT (SELECT COUNT(*) FROM coreupdate_audit.world_before),(SELECT COUNT(*) FROM coreupdate_audit.queststatus_before),(SELECT COUNT(*) FROM coreupdate_audit.expected_deleted),(SELECT COUNT(*) FROM coreupdate_audit.world_expected e JOIN coreupdate_audit.world_before b USING(entry,patch) WHERE e.RequiredRaces<>b.RequiredRaces);' 'PREIMAGE-COUNTS'
}
function VerifyDevWorld($Run){
 $equal=(@(GetDevColumns $Run 'mangos_dev' 'quest_template'|ForEach-Object {'a.`'+$_+'` <=> b.`'+$_+'`'}) -join ' AND ')
 $s='SELECT (SELECT COUNT(*) FROM coreupdate_audit.world_expected b LEFT JOIN mangos_dev.quest_template a USING(entry,patch) WHERE a.entry IS NULL),(SELECT COUNT(*) FROM mangos_dev.quest_template a LEFT JOIN coreupdate_audit.world_expected b USING(entry,patch) WHERE b.entry IS NULL),(SELECT COUNT(*) FROM mangos_dev.quest_template a JOIN coreupdate_audit.world_expected b USING(entry,patch) WHERE NOT ('+$equal+'));'
 $v=DevSQL $Run $s 'VERIFY-WORLD';Need ($v -ceq "0`t0`t0") 'WORLD_MISSING_EXTRA_OR_CONTENT';$Run.Receipt.WorldEffect=[pscustomobject]@{Missing=0;Extra=0;UnexpectedColumns=0;AllColumnsCompared=$true;MasksComparedToPreimages=$true}
}
function VerifyDevCharacters($Run){
 $equal=(@(GetDevColumns $Run 'characters_dev' 'character_queststatus'|ForEach-Object {'a.`'+$_+'` <=> b.`'+$_+'`'}) -join ' AND ')
 $s='SELECT (SELECT COUNT(*) FROM coreupdate_audit.expected_deleted e JOIN characters_dev.character_queststatus a USING(guid,quest)),(SELECT COUNT(*) FROM coreupdate_audit.queststatus_before b LEFT JOIN characters_dev.character_queststatus a USING(guid,quest) LEFT JOIN coreupdate_audit.expected_deleted e USING(guid,quest) WHERE a.guid IS NULL AND e.guid IS NULL),(SELECT COUNT(*) FROM characters_dev.character_queststatus a LEFT JOIN coreupdate_audit.queststatus_before b USING(guid,quest) WHERE b.guid IS NULL),(SELECT COUNT(*) FROM characters_dev.character_queststatus a JOIN coreupdate_audit.queststatus_before b USING(guid,quest) WHERE NOT ('+$equal+')),(SELECT COUNT(*) FROM coreupdate_audit.characters_before b LEFT JOIN characters_dev.characters a USING(guid) WHERE a.guid IS NULL OR NOT(a.race <=> b.race)),(SELECT COUNT(*) FROM characters_dev.characters a LEFT JOIN coreupdate_audit.characters_before b USING(guid) WHERE b.guid IS NULL);'
 $v=DevSQL $Run $s 'VERIFY-CHARACTERS';Need ($v -ceq "0`t0`t0`t0`t0`t0") 'CHARACTERS_DELETED_SET_OR_REMAINDER_MISMATCH'
 $counts=DevSQL $Run 'SELECT (SELECT COUNT(*) FROM coreupdate_audit.expected_deleted),(SELECT COUNT(*) FROM coreupdate_audit.queststatus_before)-(SELECT COUNT(*) FROM characters_dev.character_queststatus);' 'ACTUAL-DELETED-COUNT';$p=$counts.Split([char]9);Need ($p.Count -eq 2 -and $p[0] -ceq $p[1]) 'DELETED_COUNT_MISMATCH'
 $Run.Receipt.CharactersEffect=[pscustomobject]@{ExpectedDeleted=[long]$p[0];ActualDeleted=[long]$p[1];Missing=0;Extra=0;RemainingColumnChanges=0;AllColumnsCompared=$true;PlayerAccountsCreated=$false}
}
function VerifyDevMigrationSets($Run){
 $header='C:\Scripts\CORE-CAND-20261109-0210\source\src\shared\migrations_list.h'
 $text=[IO.File]::ReadAllText($header);$result=@()
 foreach($pair in @(@('world','mangos_dev'),@('characters','characters_dev'),@('realmd','realmd_dev'),@('logs','logs_dev'))){
  $kind=$pair[0].ToUpperInvariant();if($kind -ceq 'REALMD'){$kind='LOGON'}
  $block=[regex]::Match($text,'(?s)MIGRATIONS_'+$kind+'\[\]\s*=\s*\{(.*?)\};');Need $block.Success ('MIGRATION_HEADER_BLOCK '+$pair[0]);$expected=@([regex]::Matches($block.Groups[1].Value,'"(\d+)"')|ForEach-Object {$_.Groups[1].Value}|Sort-Object)
  $actual=@((DevSQL $Run ('SELECT id FROM '+$pair[1]+'.migrations ORDER BY id;') 'VERIFY-MIGRATION-SET') -split "`r?`n"|Sort-Object)
  $missing=@($expected|Where-Object {$_ -cnotin $actual});$extra=@($actual|Where-Object {$_ -cnotin $expected});Need ($missing.Count -eq 0 -and $extra.Count -eq 0) ('MIGRATION_SET_DELTA '+$pair[1]);$result+=[pscustomobject]@{Database=$pair[1];Expected=$expected.Count;Actual=$actual.Count;Missing=0;Extra=0}
 };$Run.Receipt.MigrationSets=$result
}
function Get-BoundDevSetupFix2($Run,[string]$Path){
 Need ($Run.State.Inputs.Priors.DevSetup.Receipt -ceq $Path) 'NEW_DEVSETUP_EXACT_RECEIPT'
 return (Get-VerifiedPrior $Run $Run.State.Inputs 'DevSetup')
}
function Get-KitSteps([string]$Kind){switch($Kind){
 'Backup'{@('Guard','ValidateInputs','Gate','LogicalBackup')}
 'DevSetup'{@('Guard','ValidateInputs','Gate','DevDirectories','DevArtifacts','DevConfigs','InitializeDevData','CreateDevServices','StartDevMySQL','BootstrapDevCredentials','AttestDevEndpoint','ImportDevCopy','RestrictDevRealm','VerifyDevEnvironment')}
 'DevMigrations'{@('Guard','ValidateInputs','Gate','AttestDevEndpoint','DevPreMigrationBackup','CapturePreimages','ApplyWorld','VerifyWorld','ApplyCharacters','VerifyCharacters','VerifyMigrations')}
 'DevAccept'{@('Guard','ValidateInputs','AttestDevEnvironment','Gate','StartMySQL','StartRealm','StartWorld','DevReady','StopWorld','StopRealm','DevFinalWrites','StopMySQL','VerifyDevAcceptance')}
 default{throw 'NO_PRODUCTION_WORKFLOW_IN_DEV_KIT'}
}}
function InvokeNativeStep($Run,$Inputs,[string]$Step){
 AssertDevNamespace $Run
 switch($Step){
  'Guard'{AssertBaseline $Run;AssertCandidateInputs $Run;$Run.Receipt.CandidateManifestSHA256=$Run.Plan.CandidateBinding.ManifestSHA256;$Run.Receipt.DevPlanSHA256=$Run.Plan.CandidateBinding.DevPlanSHA256;$Run.Receipt.StartedUtc=[DateTimeOffset]::UtcNow.ToString('o')
   if($Run.Kind -ceq 'DevSetup'){Need (!(Test-Path $Run.Plan.Dev.Root)) 'NEW_DEV_ONLY';$b=Get-VerifiedPrior $Run $Inputs 'Backup';$Run.State.LogicalBackup=$b.LogicalBackup;$Run.Receipt.SourceSnapshot=$b.LogicalBackup;$Run.State.CredentialMode='Bootstrap'}
   elseif($Run.Kind -cin @('DevMigrations','DevAccept')){$setup=Get-VerifiedPrior $Run $Inputs 'DevSetup';$Run.State.DevUUID=$setup.DevUUID;$Run.Receipt.DevUUID=$setup.DevUUID;$Run.State.CredentialMode='Admin';if($Run.Kind -ceq 'DevAccept'){[void](Get-VerifiedPrior $Run $Inputs 'DevMigrations')}}
  }
  'ValidateInputs'{if($Run.Kind -ceq 'Backup'){ValidateBackupInputsR2 $Run $Inputs};if($Run.Kind -ceq 'DevSetup'){[void](RequirePrivateInput $Inputs 'DevSecrets')};$Run.State.Inputs=$Inputs}
  'Gate'{if(!(Test-Path $Run.Plan.BackupRoot)){NewPrivate $Run.Plan.BackupRoot};if($Run.Kind -ceq 'DevSetup' -and !(Test-Path (Split-Path $Run.Plan.Dev.Logs))){NewPrivate (Split-Path $Run.Plan.Dev.Logs)}}
  'LogicalBackup'{LogicalBackup $Run (GetValidatedSourceDefaultsR2 $Run)}
  'InitializeDevData'{[void](InvokeFix5DevStep $Run $Inputs $Step);$auto=[IO.File]::ReadAllText((Join-Path $Run.Plan.Dev.Data 'auto.cnf'));$m=[regex]::Match($auto,'(?im)^server-uuid=([a-f0-9-]{36})\s*$');Need $m.Success 'INITIALIZED_UUID';$Run.State.DevUUID=$m.Groups[1].Value;$Run.Receipt.DevUUID=$Run.State.DevUUID}
  'BootstrapDevCredentials'{[void](AttestDevDB $Run);$secret=GetJson $Inputs.DevSecrets;$sql="ALTER USER 'root'@'localhost' IDENTIFIED BY '"+$secret.DevAdminPassword+"'; CREATE USER 'r3dev'@'127.0.0.1' IDENTIFIED BY '"+$secret.DevCorePassword+"';";foreach($db in $Run.Plan.DatabaseNames){$sql+='GRANT ALL PRIVILEGES ON '+$db+".* TO 'r3dev'@'127.0.0.1';"};[void](InvokeDevClient $Run $sql 'BOOTSTRAP-DEV-CREDENTIALS');$sql=$null;$secret=$null;$Run.State.CredentialMode='Admin';[void](AttestDevDB $Run)}
  'ImportDevCopy'{[void](AttestDevDB $Run);$dump=$Run.State.LogicalBackup;Need ((Hash $dump.Path) -ceq $dump.SHA256) 'FRESH_COPY_HASH';[void](InvokeDevClient $Run '' 'IMPORT-NEW-DEV' $dump.Path 3600000);[void](AttestDevDB $Run)}
  'AttestDevEndpoint'{[void](AttestDevDB $Run)}
  'DevReady'{[void](AttestDevDB $Run);Need (DevPortReady $Run $Run.Plan.Dev.World 28085) 'WORLD_OWN_PORT'}
  'DevPreMigrationBackup'{InvokeDevPreMigrationBackup $Run}
  'CapturePreimages'{CaptureDevPreimages $Run}
  'ApplyWorld'{InvokePinnedDevSQLFile $Run $Run.Plan.CandidateBinding.SQL[0].Path $Run.Plan.CandidateBinding.SQL[0].SHA256 'mangos_dev' 'APPLY-WORLD'}
  'VerifyWorld'{VerifyDevWorld $Run}
  'ApplyCharacters'{InvokePinnedDevSQLFile $Run $Run.Plan.CandidateBinding.SQL[1].Path $Run.Plan.CandidateBinding.SQL[1].SHA256 'characters_dev' 'APPLY-CHARACTERS'}
  'VerifyCharacters'{VerifyDevCharacters $Run}
  'VerifyMigrations'{VerifyDevMigrationSets $Run}
  default{Need ($Step -cin @('DevDirectories','DevArtifacts','DevConfigs','CreateDevServices','StartDevMySQL','RestrictDevRealm','VerifyDevEnvironment','AttestDevEnvironment','StartMySQL','StartRealm','StartWorld','StopWorld','StopRealm','StopMySQL','DevFinalWrites','VerifyDevAcceptance')) 'DEV_STEP_ALLOWLIST';[void](InvokeFix5DevStep $Run $Inputs $Step)}
 }
 Ack
}

. (Join-Path $PSScriptRoot 'Resume.R3.ps1')

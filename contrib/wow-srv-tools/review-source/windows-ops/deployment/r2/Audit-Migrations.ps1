. (Join-Path $PSScriptRoot 'Audit.Common.ps1')
Start-Transcript -LiteralPath (Join-Path $Out 'MIGRATION-AUDIT.log') -NoClobber
try{
    $built=ReadJson (Join-Path $Out 'BUILD-VERIFY-RESULT.json');Need ($built.Result -ceq 'PASS') 'VERIFIED_BUILD_REQUIRED'
    $kit='C:\Scripts\SHUTDOWN1053-DEV-MIGRATION-PREP-R2-FIX5-WOW-SRV-20261108-1818-PAYLOAD'
    $script:Plan=ReadJson (Join-Path $kit 'KIT-PLAN.json')
    $script:Options='C:\ProgramData\VMANGOS\R3Approvals\source-backup-candidate.ini'
    $script:QueryCount=0
    $dep=Join-Path $kit 'dependencies\Release.Native.cs'
    $depPin=@(Import-Csv (Join-Path $kit 'EXECUTION-PINS.tsv') -Delimiter "`t"|Where-Object Path -ceq 'dependencies\Release.Native.cs')
    Need ($depPin.Count -eq 1 -and (Hash $dep) -ceq $depPin[0].SHA256) 'SECURE_READER_DEPENDENCY_PIN'
    Add-Type -Path $dep
    $inputs='C:\Scripts\DEV-INPUTS-PREP-R1-WOW-SRV-20261105-0206-PAYLOAD\Inputs.Common.ps1'
    Need ((Hash $inputs) -ceq '8F8A42CEEA8FEF0AEE251ABC79BDEC2C91CA944CCAD7358EF78A0F02569DB41A') 'APPROVED_QUERY_HELPER_PIN'
    foreach($load in @(@{File=$inputs;Names=@('InvokeReadQuery','AssertSourceInstance')},@{File=(Join-Path $kit 'Kit.Common.ps1');Names=@('NoReparse','AssertPrivate')})){
        $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($load.File,[ref]$tokens,[ref]$errors);Need ($errors.Count -eq 0) 'READ_HELPER_SYNTAX'
        foreach($name in $load.Names){$fn=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $name});Need ($fn.Count -eq 1) ('READ_HELPER_UNIQUE '+$name);. ([scriptblock]::Create($fn[0].Extent.Text))}
    }
    AssertPrivate $Options
    Need (!(Test-Path (Join-Path $env:APPDATA 'MySQL\.mylogin.cnf')) -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('MYSQL_TEST_LOGIN_FILE','Process'))) 'IMPLICIT_MYSQL_LOGIN_REQUIRES_REVIEW'
    $script:PrivateRaw=Join-Path $Out ('private-raw-sql-'+[guid]::NewGuid().ToString('N'))
    [WowReleaseV1.Secure]::NewDirectory($script:PrivateRaw,$false)
    $binding=AssertSourceInstance $Plan
    $serviceProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$binding.ServicePID)
    foreach($p in $binding.Processes){Need ($serviceProcess.ExecutablePath -ieq $p.Executable -and $serviceProcess.CreationDate.ToUniversalTime().Ticks -le [DateTimeOffset]::Parse($p.CreatedUtc).UtcDateTime.Ticks) 'SOURCE_PARENT_GENERATION'}
    $identity=InvokeReadQuery 'SOURCE-IDENTITY' 'SELECT /*+ MAX_EXECUTION_TIME(5000) */ @@hostname,@@port,@@datadir,@@server_uuid,@@version,@@version_comment,@@read_only,@@autocommit,CURRENT_USER();'
    $parts=$identity.Trim().Split([char]9);Need ($parts.Count -eq 9 -and $parts[0] -ceq 'WOW-SRV' -and $parts[1] -ceq '3306') 'SOURCE_SQL_HOST_PORT'
    $refPath='C:\GRY\wow\diagnostics\MIGRATION-R3-FIX5-EXECUTE-R1-WOW-SRV-20261108-1948\DB-PREFLIGHT.json'
    $reference=ReadJson $refPath
    Need ($parts[3] -ceq $reference.ServerUUID -and [IO.Path]::GetFullPath($parts[2].Replace('/','\')).TrimEnd('\') -ieq [IO.Path]::GetFullPath($reference.Datadir.Replace('/','\')).TrimEnd('\')) 'SOURCE_UUID_DATADIR_VS_ACCEPTED_INSTANCE'
    $dbNames=($Plan.DatabaseNames|ForEach-Object {"'"+$_+"'"}) -join ','
    $engineText=InvokeReadQuery 'DATABASE-ENGINES' ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,ENGINE,COUNT(*),COALESCE(SUM(DATA_LENGTH),0),COALESCE(SUM(INDEX_LENGTH),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('+$dbNames+") AND TABLE_TYPE='BASE TABLE' GROUP BY TABLE_SCHEMA,ENGINE ORDER BY TABLE_SCHEMA,ENGINE;")
    $engines=@(foreach($line in $engineText.Trim().Split([char]10)){if($line.Trim()){$x=$line.Trim().Split([char]9);Need ($x.Count -eq 5) 'ENGINE_ROW';[pscustomobject]@{Database=$x[0];Engine=$x[1];Tables=[long]$x[2];DataBytes=[long]$x[3];IndexBytes=[long]$x[4]}}})
    foreach($db in $Plan.DatabaseNames){Need (@($engines|Where-Object Database -ceq $db).Count -gt 0) ('DATABASE_NOT_VISIBLE '+$db)}
    $ddl=InvokeReadQuery 'ACTIVE-DDL' ("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND COMMAND<>'Sleep' AND COALESCE(INFO,'') REGEXP '(^|[[:space:];])(ALTER|CREATE|DROP|RENAME|TRUNCATE)[[:space:]]' AND (DB IN ("+$dbNames+") OR DB IS NULL OR COALESCE(INFO,'') REGEXP '(realmd_dev|mangos_dev|characters_dev|logs_dev)');")
    Need ($ddl.Trim() -cmatch '^\d+$') 'DDL_UNKNOWN'
    $grantText=InvokeReadQuery 'BACKUP-GRANTS' 'SHOW GRANTS'
    $grantChecks=@(foreach($privilege in @('SELECT','SHOW VIEW','TRIGGER','EVENT','PROCESS','SHOW_ROUTINE')){[pscustomobject]@{Privilege=$privilege;DirectGrantObserved=($grantText -match ('(?im)(^GRANT\s+ALL PRIVILEGES|(?:GRANT\s+|,\s*)'+[regex]::Escape($privilege)+'(?:,|\s+ON))'));Meaning='Direct textual grant observation, no backup/DDL executed'}})
    $header=Join-Path $Source 'src\shared\migrations_list.h';Need (Test-Path $header) 'BUILT_MIGRATION_HEADER'
    $headerText=[IO.File]::ReadAllText($header);$map=@{WORLD='mangos_dev';CHARACTERS='characters_dev';LOGON='realmd_dev';LOGS='logs_dev'}
    $missingRows=[Collections.Generic.List[object]]::new()
    $sets=@(foreach($array in [regex]::Matches($headerText,'(?s)static const char \*MIGRATIONS_(\w+)\[\]\s*=\s*\{([^}]+)\}')){
        $kind=$array.Groups[1].Value;Need ($map.ContainsKey($kind)) 'MIGRATION_DATABASE_KIND';$db=$map[$kind]
        $required=@([regex]::Matches($array.Groups[2].Value,'"(\d{14})"')|ForEach-Object {$_.Groups[1].Value})
        $answer=InvokeReadQuery ('APPLIED-'+$kind) ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ id FROM '+$db+'.migrations ORDER BY id;')
        $applied=@($answer.Trim() -split "\r?\n"|Where-Object {$_})
        foreach($id in $applied){Need ($id -cmatch '^\d{14}$') 'MIGRATION_ID_SHAPE'}
        $missing=@($required|Where-Object {$_ -cnotin $applied}|Sort-Object)
        $extra=@($applied|Where-Object {$_ -cnotin $required}|Sort-Object)
        foreach($id in $missing){$files=@(Get-ChildItem (Join-Path $Source 'sql\migrations') -Filter ($id+'_*') -File|Where-Object Name -match ('_'+$kind.ToLowerInvariant()+'\.sql$'));if($kind -ceq 'LOGON'){$files=@(Get-ChildItem (Join-Path $Source 'sql\migrations') -Filter ($id+'_logon.sql') -File)};Need ($files.Count -eq 1) ('MISSING_SQL_SOURCE '+$kind+' '+$id);$missingRows.Add([pscustomobject]@{Database=$db;Kind=$kind;Id=$id;Source=$files[0].FullName;SHA256=(Hash $files[0].FullName);Bytes=$files[0].Length;Order=0})}
        [pscustomobject]@{Database=$db;Kind=$kind;RequiredCount=$required.Count;AppliedCount=$applied.Count;LastRequired=($required|Sort-Object|Select-Object -Last 1);LastApplied=($applied|Sort-Object|Select-Object -Last 1);Missing=$missing;Extra=$extra;Required=$required;Applied=$applied}
    })
    Need ($sets.Count -eq 4) 'FOUR_MIGRATION_ARRAYS'
    $versionMeta=InvokeReadQuery 'VERSION-TABLE-METADATA' ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('+$dbNames+") AND (TABLE_NAME LIKE '%version%' OR TABLE_NAME='migrations') ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION;")
    $ordered=@($missingRows.ToArray()|Sort-Object Id);$order=0
    foreach($row in $ordered){$order++;$row.Order=$order}
    Need (@($ordered|Where-Object {$_.Id -cnotin @('20261025125310','20261025125408')}).Count -eq 0) 'UNREVIEWED_MIGRATION_REQUIRES_SQL_REVIEW'
    $impacts=[Collections.Generic.List[object]]::new()
    foreach($row in $ordered){
        $sql=[IO.File]::ReadAllText($row.Source)
        if($row.Kind -ceq 'WORLD'){
            $updateQueries=@([regex]::Matches($sql,'UPDATE\s+`quest_template`\s+SET\s+`RequiredRaces`\s*=\s*(\d+)\s+WHERE\s+`RequiredRaces`\s*=\s*0\s+AND\s+`entry`\s+(IN\s*\([0-9,\s]+\)|=\s*\d+)\s*;'))
            Need ($updateQueries.Count -eq 7) 'REVIEWED_WORLD_UPDATES_7'
            $ix=0;foreach($update in $updateQueries){$ix++;$mask=$update.Groups[1].Value;$predicate=$update.Groups[2].Value -replace '\s+',' ';$count=InvokeReadQuery ('WORLD-IMPACT-'+$ix) ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) FROM mangos_dev.quest_template WHERE RequiredRaces=0 AND entry '+$predicate+';');Need ($count.Trim() -cmatch '^\d+$') 'WORLD_IMPACT_COUNT';$impacts.Add([pscustomobject]@{Migration=$row.Id;Operation='UPDATE RequiredRaces WHERE old=0';NewMask=[long]$mask;RowsObserved=[long]$count.Trim();Identifiers='Source quest-template IDs only; no player rows exported'})}
        }elseif($row.Kind -ceq 'CHARACTERS'){
            $deletes=@([regex]::Matches($sql,'(?s)DELETE\s+`qs`\s+FROM\s+`character_queststatus`\s+`qs`\s+JOIN\s+`characters`\s+`c`\s+ON\s+`c`\.`guid`\s*=\s*`qs`\.`guid`\s+WHERE\s+(.+?);'))
            Need ($deletes.Count -eq 2) 'REVIEWED_CHARACTER_DELETES_2'
            $ix=0;foreach($delete in $deletes){$ix++;$predicate=$delete.Groups[1].Value -replace '\s+',' ';Need ($predicate -match '^`qs`\.`rewarded` = 0 AND `c`\.`race` IN \([0-9, ]+\) AND `qs`\.`quest` IN \([0-9, ]+\)$') 'REVIEWED_DELETE_PREDICATE'
                $countText=InvokeReadQuery ('CHARACTER-IMPACT-'+$ix) ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ qs.status,COUNT(*) FROM characters_dev.character_queststatus qs JOIN characters_dev.characters c ON c.guid=qs.guid WHERE '+$predicate+' GROUP BY qs.status ORDER BY qs.status;')
                $counts=@(foreach($line in @($countText.Trim() -split "\r?\n"|Where-Object {$_})){$x=$line.Split([char]9);Need ($x.Count -eq 2) 'CHARACTER_COUNT_ROW';[pscustomobject]@{Status=[long]$x[0];Rows=[long]$x[1]}})
                $impacts.Add([pscustomobject]@{Migration=$row.Id;Operation='DELETE unrewarded opposite-faction quest status';Predicate=$predicate;RowsObserved=[long](($counts|Measure-Object Rows -Sum).Sum);StatusCounts=$counts;CompletedButUnrewardedIncluded=$true;RewardedRowsPreserved=$true;IdentifiersExported=$false})
            }
        }
    }
    $ordered|Export-Csv (Join-Path $Out 'MISSING-MIGRATIONS.tsv') -Delimiter "`t" -NoTypeInformation -Encoding UTF8
    SaveJson 'MIGRATION-AUDIT-RESULT.json' @{Result='READ_ONLY_AUDIT_COMPLETE';CandidateRuntimeCompatibleNow=($ordered.Count -eq 0);MigrationsRequired=($ordered.Count -gt 0);MissingCount=$ordered.Count;ExtraCount=[int](($sets|ForEach-Object {$_.Extra.Count}|Measure-Object -Sum).Sum);Target=$Target;Header=$header;HeaderSHA256=(Hash $header);SourceInstance=@{Host=$parts[0];Port=[int]$parts[1];Datadir=$parts[2];ServerUUID=$parts[3];Version=$parts[4];VersionComment=$parts[5];ReadOnly=$parts[6];Autocommit=$parts[7];Account=$parts[8]};SourceBinding=$binding;Reference=$refPath;ReferenceSHA256=(Hash $refPath);MigrationSets=$sets;Missing=$ordered;TableEngines=$engines;VersionMetadata=$versionMeta;ActiveDDLCount=[long]$ddl.Trim();BackupGrantObservations=$grantChecks;Impacts=$impacts.ToArray();QueryCount=$script:QueryCount;PlayerIdentifiersExported=$false;RawSQLResults='PRIVATE_LOCAL_ONLY';NoDDLWindowApproved=$false;OperationalBackup='NOT_RUN';SQLApplied='NOT_RUN';Rollback='No automatic DB restore. Procedure DDL and marker-before-DML can leave partial state; fresh backup and reviewed data/marker comparison required.';AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
    Write-Output ('OK=True CHANGE_SCOPE=ReadOnlyMigrationComparison LOG='+$Out+' MISSING='+$ordered.Count+' NEXT_STEP=Review exact SQL impact and separately approve isolated DEV')
}catch{SaveJson 'MIGRATION-AUDIT-FAIL.json' @{Result='FAIL';Error=$_.Exception.ToString();Stack=$_.ScriptStackTrace};throw}finally{Stop-Transcript}

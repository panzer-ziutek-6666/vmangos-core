. (Join-Path $PSScriptRoot Preflight.Common.ps1)
$script:PrivateRaw=NewRaw
AssertPrivate $Options
Need (!(Test-Path (Join-Path $env:APPDATA 'MySQL\.mylogin.cnf')) -and [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable('MYSQL_TEST_LOGIN_FILE','Process'))) 'IMPLICIT_MYSQL_LOGIN_REQUIRES_REVIEW'
$source=AssertSourceInstance $Plan
$instance=InvokeReadQuery 'SOURCE-IDENTITY' 'SELECT /*+ MAX_EXECUTION_TIME(5000) */ @@hostname,@@port,@@datadir,@@server_uuid,@@version,@@version_comment,@@read_only,@@global.event_scheduler,CURRENT_USER();'
$parts=$instance.Trim().Split([char]9)
Need ($parts.Count -eq 9 -and $parts[1] -ceq '3306') 'SOURCE_SQL_IDENTITY'
$mysqlText=[IO.File]::ReadAllText($Plan.ActiveMySQLDefaults)
$m=[regex]::Match($mysqlText,'(?im)^\s*datadir\s*=\s*(.+?)\s*$');Need $m.Success 'SOURCE_CONFIG_DATADIR'
$datadir=[IO.Path]::GetFullPath($m.Groups[1].Value.Trim('"').Replace('/','\')).TrimEnd('\')
Need ([IO.Path]::GetFullPath($parts[2].Replace('/','\')).TrimEnd('\') -ieq $datadir) 'SOURCE_DATADIR_MISMATCH'
$mysqlText=$null
$names=($Plan.DatabaseNames|ForEach-Object {"'"+$_+"'"}) -join ','
$tables=InvokeReadQuery 'DATABASE-ENGINES-SIZES' ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,ENGINE,COUNT(*),COALESCE(SUM(DATA_LENGTH),0),COALESCE(SUM(INDEX_LENGTH),0),COALESCE(SUM(TABLE_ROWS),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('+$names+") AND TABLE_TYPE='BASE TABLE' GROUP BY TABLE_SCHEMA,ENGINE ORDER BY TABLE_SCHEMA,ENGINE;")
$engines=@(foreach($line in $tables.Trim().Split([char]10)){if($line.Trim()){$p=$line.Trim().Split([char]9);Need ($p.Count -eq 6) 'ENGINE_ROW_SHAPE';[pscustomobject]@{Database=$p[0];Engine=$p[1];Tables=[long]$p[2];DataBytes=[long]$p[3];IndexBytes=[long]$p[4];ApproxRows=[long]$p[5]}}})
foreach($name in $Plan.DatabaseNames){Need (@($engines|Where-Object Database -ceq $name).Count -gt 0) 'DATABASE_NOT_VISIBLE'}
$grantText=InvokeReadQuery 'SOURCE-GRANTS' 'SHOW GRANTS'
$grants=@($grantText.Trim().Split([char]10)|ForEach-Object {$_.Trim()})
$checks=@(foreach($privilege in @('SELECT','SHOW VIEW','TRIGGER','EVENT','PROCESS','SHOW_ROUTINE')){
 $found=@($grants|Where-Object {$_ -match ('(?i)(^GRANT\s+ALL PRIVILEGES|(?:GRANT\s+|,\s*)'+[regex]::Escape($privilege)+'(?:,|\s+ON))')})
 [pscustomobject]@{Privilege=$privilege;DirectGrantPresent=($found.Count -gt 0);RequiredFor=$(if($privilege -ceq 'PROCESS'){'DDL visibility'}elseif($privilege -ceq 'SHOW_ROUTINE'){'mysqldump --routines'}else{'Selected dump format'})}
})
$ddl=InvokeReadQuery 'ACTIVE-DDL' ("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND COMMAND<>'Sleep' AND COALESCE(INFO,'') REGEXP '(^|[[:space:];])(ALTER|CREATE|DROP|RENAME|TRUNCATE)[[:space:]]' AND (DB IN ("+$names+") OR DB IS NULL OR COALESCE(INFO,'') REGEXP '(realmd_dev|mangos_dev|characters_dev|logs_dev)');")
Need ($ddl.Trim() -cmatch '^\d+$') 'DDL_COUNT_UNKNOWN'
$meta=InvokeReadQuery 'VERSION-TABLE-METADATA' ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('+$names+") AND (TABLE_NAME LIKE '%version%' OR TABLE_NAME='migrations') ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION;")
$columns=@(foreach($line in $meta.Trim().Split([char]10)){if($line.Trim()){$p=$line.Trim().Split([char]9);[pscustomobject]@{Database=$p[0];Table=$p[1];Column=$p[2];Type=$p[3]}}})
$header='C:\Scripts\S1053-R3-20261104-1921\source\src\shared\migrations_list.h'
$text=[IO.File]::ReadAllText($header);$map=@{CHARACTERS='characters_dev';WORLD='mangos_dev';LOGON='realmd_dev';LOGS='logs_dev'}
$compat=@(foreach($array in [regex]::Matches($text,'(?s)static const char \*MIGRATIONS_(\w+)\[\]\s*=\s*\{([^}]+)\}')){
 $kind=$array.Groups[1].Value;Need ($map.ContainsKey($kind)) 'MIGRATION_ARRAY_UNKNOWN';$db=$map[$kind]
 $required=@([regex]::Matches($array.Groups[2].Value,'"(\d{14})"')|ForEach-Object {$_.Groups[1].Value})
 $answer=InvokeReadQuery ('APPLIED-'+$kind) ("SELECT /*+ MAX_EXECUTION_TIME(5000) */ * FROM "+$db+'.migrations;')
 $applied=@($answer.Trim().Split([char]10)|ForEach-Object {$_.Trim().Split([char]9)[0]})
 $missing=@($required|Where-Object {$_ -cnotin $applied})
 [pscustomobject]@{Database=$db;RequiredCount=$required.Count;AppliedCount=$applied.Count;Missing=$missing;Extra=@($applied|Where-Object {$_ -cnotin $required});RequiredHeaderSHA256=(Hash $header)}
})
$versions=@(foreach($table in @($columns|Where-Object {$_.Table -cmatch '^(db_version|character_db_version|realmd_db_version|logs_db_version)$'}|Select-Object Database,Table -Unique)){
 Need ($table.Database -cmatch '^[a-z_]+$' -and $table.Table -cmatch '^[a-z_]+$') 'VERSION_IDENTIFIERS'
 $s=InvokeReadQuery ('VERSION-'+$table.Database.ToUpperInvariant()) ('SELECT /*+ MAX_EXECUTION_TIME(5000) */ * FROM '+$table.Database+'.'+$table.Table+' LIMIT 1;')
 [pscustomobject]@{Database=$table.Database;Table=$table.Table;Columns=@($columns|Where-Object {$_.Database -ceq $table.Database -and $_.Table -ceq $table.Table}|ForEach-Object Column);Value=$s.Trim()}
})
$headerProof=ReadJson (Join-Path $Out SQL-HEADER-READ.json)
SaveJson 'DB-PREFLIGHT.json' @{Result='READ_COMPLETE';Host=$parts[0];Port=[int]$parts[1];Datadir=$parts[2];ServerUUID=$parts[3];Version=$parts[4];VersionComment=$parts[5];ReadOnly=$parts[6];EventScheduler=$parts[7];CurrentUser=$parts[8];SourceProcessBinding=$source;Databases=$engines;VersionTables=$versions;VersionTableMetadata=$columns;MigrationCompatibility=$compat;CandidateMigrationHeaderSHA256=$headerProof.HeaderSHA256;SQLSourceComparisonScope=$headerProof.Scope;MigrationSQLRequired=@($compat|Where-Object {$_.Missing.Count -gt 0}).Count -gt 0;GrantChecks=$checks;DirectGrants=$grants;ActiveDDLCount=[long]$ddl.Trim();NoDDLWindowApproved=$false;AllowGlobalReadLock=$false;OperationalDumpExecuted=$false;QueryCount=$script:QueryCount;SourceControls=0;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
'OK=True';'CHANGE_SCOPE=SOURCE_MYSQL_READ_ONLY_SELECT_SHOW';'LOG='+$Out;'NEXT_STEP=Blocked execution plan and rollback'
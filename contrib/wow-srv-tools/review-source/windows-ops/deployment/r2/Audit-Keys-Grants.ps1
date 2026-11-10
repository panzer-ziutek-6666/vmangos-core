. (Join-Path $PSScriptRoot 'Audit.Common.ps1')
$script:Plan=ReadJson (Join-Path $PSScriptRoot 'KIT-PLAN.json');$script:Options='C:\ProgramData\VMANGOS\R3Approvals\source-backup-candidate.ini';$script:QueryCount=0
Add-Type -Path (Join-Path $PSScriptRoot 'dependencies\Release.Native.cs')
$dep='C:\Scripts\DEV-INPUTS-PREP-R1-WOW-SRV-20261105-0206-PAYLOAD\Inputs.Common.ps1'
Need ((Hash $dep) -ceq '8F8A42CEEA8FEF0AEE251ABC79BDEC2C91CA944CCAD7358EF78A0F02569DB41A') 'READ_HELPER_PIN'
$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($dep,[ref]$t,[ref]$e)
foreach($n in @('InvokeReadQuery','AssertSourceInstance')){$fn=@($a.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $n});. ([scriptblock]::Create($fn[0].Extent.Text))}
$script:PrivateRaw=Join-Path $Out ('private-keys-'+[guid]::NewGuid().ToString('N'));NewPrivate $PrivateRaw
$keys=InvokeReadQuery 'LIVE-PRIMARY-KEYS' "SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,TABLE_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE INDEX_NAME='PRIMARY' AND ((TABLE_SCHEMA='mangos_dev' AND TABLE_NAME='quest_template') OR (TABLE_SCHEMA='characters_dev' AND TABLE_NAME IN ('characters','character_queststatus'))) GROUP BY TABLE_SCHEMA,TABLE_NAME ORDER BY TABLE_SCHEMA,TABLE_NAME;"
Need ($keys -match 'quest_template\s+entry,patch' -and $keys -match 'character_queststatus\s+guid,quest' -and $keys -match 'characters\s+guid') 'FULL_KEYS'
$grants=InvokeReadQuery 'LIVE-MIGRATION-GRANTS' 'SHOW GRANTS'
$all=($grants -cmatch 'GRANT ALL PRIVILEGES ON \*\.\* TO')
$priv=@(foreach($n in @('SELECT','INSERT','UPDATE','DELETE','CREATE','CREATE ROUTINE','ALTER ROUTINE','EXECUTE','SHOW VIEW','TRIGGER','EVENT','PROCESS','SHOW_ROUTINE')){[pscustomobject]@{Privilege=$n;DirectObserved=($all -or $grants -match ('(?:GRANT\s+|,\s*)'+[regex]::Escape($n)+'(?:,|\s+ON)'))}})
$metadata=InvokeReadQuery 'LIVE-COLUMN-SCHEMA' "SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA,COALESCE(CHARACTER_SET_NAME,''),COALESCE(COLLATION_NAME,''),'ROW_END' FROM information_schema.COLUMNS WHERE (TABLE_SCHEMA='mangos_dev' AND TABLE_NAME='quest_template') OR (TABLE_SCHEMA='characters_dev' AND TABLE_NAME IN ('characters','character_queststatus')) ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION;"
SaveJson 'SQL-KEYS-GRANTS.json' @{Result='PASS_READONLY';PrimaryKeys=$keys.Trim();Privileges=$priv;AllGlobalPrivilegesObserved=$all;ColumnSchema=$metadata.Trim();SourceDefaults=$Options;SQLMutation='NOT_RUN';GrantExecutionNotTested=$true}
Write-Host 'KEYS_GRANTS=PASS_READONLY'

function New-RowSetComparisonSQL([string]$Actual,[string]$Expected,[string[]]$Columns,[string[]]$Keys){
 foreach($table in @($Actual,$Expected)){Need ($table -cmatch '^[a-z0-9_]+\.[a-z0-9_]+$') 'COMPARISON_TABLE_IDENTIFIER'}
 Need ($Keys.Count -gt 0 -and $Columns.Count -ge $Keys.Count) 'COMPARISON_KEYS_COLUMNS'
 foreach($column in $Columns+$Keys){Need ($column -cmatch '^[A-Za-z0-9_]+$') 'COMPARISON_COLUMN_IDENTIFIER'}
 foreach($key in $Keys){Need ($key -cin $Columns) 'KEY_NOT_IN_COLUMNS'}
 $using='USING('+($Keys -join ',')+')';$equal=(@($Columns|ForEach-Object {'a.`'+$_+'` <=> b.`'+$_+'`'}) -join ' AND ');$first=$Keys[0]
 return 'SELECT (SELECT COUNT(*) FROM '+$Expected+' b LEFT JOIN '+$Actual+' a '+$using+' WHERE a.`'+$first+'` IS NULL),(SELECT COUNT(*) FROM '+$Actual+' a LEFT JOIN '+$Expected+' b '+$using+' WHERE b.`'+$first+'` IS NULL),(SELECT COUNT(*) FROM '+$Actual+' a JOIN '+$Expected+' b '+$using+' WHERE NOT ('+$equal+'));'
}
function New-MaskCountSQL([string]$Actual,[string]$Before){
 foreach($table in @($Actual,$Before)){Need ($table -cmatch '^[a-z0-9_]+\.[a-z0-9_]+$') 'MASK_COUNT_TABLE'}
 return 'SELECT COUNT(*) FROM '+$Actual+' a JOIN '+$Before+' b USING(entry,patch) WHERE NOT(a.RequiredRaces <=> b.RequiredRaces);'
}
function VerifyDevWorld($Run){
 $columns=@(GetDevColumns $Run 'mangos_dev' 'quest_template')
 $sql=New-RowSetComparisonSQL 'mangos_dev.quest_template' 'coreupdate_audit.world_expected' $columns @('entry','patch')
 $answer=DevSQL $Run $sql 'VERIFY-WORLD-FULL-KEY';Need ($answer -ceq "0`t0`t0") 'WORLD_MISSING_EXTRA_OR_CONTENT'
 $actual=DevSQL $Run (New-MaskCountSQL 'mangos_dev.quest_template' 'coreupdate_audit.world_before') 'ACTUAL-MASK-COUNT'
 $expected=DevSQL $Run (New-MaskCountSQL 'coreupdate_audit.world_expected' 'coreupdate_audit.world_before') 'EXPECTED-MASK-COUNT'
 Need ($actual -cmatch '^\d+$' -and $actual -ceq $expected) 'MASK_COUNT_DELTA'
 $Run.Receipt.WorldEffect=[pscustomobject]@{PrimaryKey=@('entry','patch');Missing=0;Extra=0;UnexpectedColumns=0;AllColumnsCompared=$true;ActualMaskChanges=[long]$actual;ExpectedMaskChanges=[long]$expected}
}
function Assert-CharactersUnchangedR3($Run){
 $columns=@(GetDevColumns $Run 'characters_dev' 'character_queststatus');$sql=New-RowSetComparisonSQL 'characters_dev.character_queststatus' 'coreupdate_audit.queststatus_before' $columns @('guid','quest')
 $answer=DevSQL $Run $sql 'CHARACTERS-BEFORE-APPLY';Need ($answer -ceq "0`t0`t0") 'CHARACTERS_CHANGED_BEFORE_APPLY'
 $counts=(DevSQL $Run 'SELECT (SELECT COUNT(*) FROM characters_dev.character_queststatus),(SELECT COUNT(*) FROM coreupdate_audit.expected_deleted),(SELECT COUNT(*) FROM characters_dev.migrations WHERE id=20261025125408);' 'CHARACTERS-BEFORE-COUNTS').Split([char]9)
 Need ($counts.Count -eq 3 -and $counts[2] -ceq '0') 'CHARACTERS_MARKER_ALREADY_PRESENT'
 $Run.Receipt.CharactersBefore=[pscustomobject]@{Rows=[long]$counts[0];EligibleForDeletion=[long]$counts[1];Missing=0;Extra=0;Changed=0;Marker=0;PrimaryKey=@('guid','quest')}
}
function Assert-AuditSchemaR3($Run){
 $keys=DevSQL $Run "SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE INDEX_NAME='PRIMARY' AND ((TABLE_SCHEMA='mangos_dev' AND TABLE_NAME='quest_template') OR (TABLE_SCHEMA='characters_dev' AND TABLE_NAME='character_queststatus') OR (TABLE_SCHEMA='coreupdate_audit' AND TABLE_NAME IN ('world_before','world_expected','queststatus_before','expected_deleted'))) ORDER BY TABLE_SCHEMA,TABLE_NAME,SEQ_IN_INDEX;" 'KEYS-AUDIT'
 $groups=@{};foreach($line in $keys -split "`r?`n"){$p=$line.Split([char]9);Need ($p.Count -eq 4) 'KEY_ROW';$id=$p[0]+'.'+$p[1];if(!$groups.ContainsKey($id)){$groups[$id]=@()};$groups[$id]+=@($p[2])}
 foreach($table in @('mangos_dev.quest_template','coreupdate_audit.world_before','coreupdate_audit.world_expected')){Need (($groups[$table] -join ',') -ceq 'entry,patch') 'WORLD_PRIMARY_KEY'}
 foreach($table in @('characters_dev.character_queststatus','coreupdate_audit.queststatus_before','coreupdate_audit.expected_deleted')){Need (($groups[$table] -join ',') -ceq 'guid,quest') 'CHARACTERS_PRIMARY_KEY'}
 $schema=DevSQL $Run "SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA,COALESCE(CHARACTER_SET_NAME,''),COALESCE(COLLATION_NAME,''),'ROW_END' FROM information_schema.COLUMNS WHERE (TABLE_SCHEMA='mangos_dev' AND TABLE_NAME='quest_template') OR (TABLE_SCHEMA='characters_dev' AND TABLE_NAME='character_queststatus') OR (TABLE_SCHEMA='coreupdate_audit' AND TABLE_NAME IN ('world_before','world_expected','queststatus_before')) ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION;" 'AUDIT-SCHEMA'
 $tables=@{};foreach($line in $schema -split "`r?`n"){$p=$line.Split([char]9);Need ($p.Count -eq 10 -and $p[9] -ceq 'ROW_END') 'SCHEMA_ROW_FORMAT';$id=$p[0]+'.'+$p[1];if(!$tables.ContainsKey($id)){$tables[$id]=@()};$tables[$id]+=@(($p[2..($p.Count-1)] -join "`t"))}
 foreach($pair in @(@('mangos_dev.quest_template','coreupdate_audit.world_before'),@('mangos_dev.quest_template','coreupdate_audit.world_expected'),@('characters_dev.character_queststatus','coreupdate_audit.queststatus_before'))){Need (($tables[$pair[0]] -join "`n") -ceq ($tables[$pair[1]] -join "`n")) 'AUDIT_SCHEMA_MISMATCH'}
 $Run.Receipt.AuditKeys=$groups
}
function Export-AuditProofR3($Run,[string]$Tag){
 [void](AttestDevDB $Run);$path=Join-Path $Run.Out ($Tag+'.private.sql');Need (!(Test-Path $path)) 'AUDIT_PROOF_NO_OVERWRITE'
 $tokens=@(('--defaults-file='+$Run.Plan.Dev.Defaults),'--no-login-paths','--protocol=TCP','--host=127.0.0.1','--port=23306','--single-transaction','--no-create-info','--skip-comments','--skip-add-locks','--skip-disable-keys','--complete-insert','--skip-extended-insert','--order-by-primary','--hex-blob','--set-gtid-purged=OFF','--no-tablespaces',('--result-file='+$path),'coreupdate_audit','world_before','world_expected','queststatus_before','characters_before','expected_deleted')
 $r=NativeKit $Run (Join-Path $Run.Plan.MySQLBin 'mysqldump.exe') $tokens $Tag 300000;AssertPrivate $path;Need ((Get-Item $path).Length -gt 10000) 'AUDIT_EXPORT_EMPTY';[void](AttestDevDB $Run)
 return [pscustomobject]@{Path=$path;SHA256=(Hash $path);Bytes=(Get-Item $path).Length;NativeExit=$r.ExitCode;Meaning='Deterministic read-only logical preimages export; not a new source backup'}
}

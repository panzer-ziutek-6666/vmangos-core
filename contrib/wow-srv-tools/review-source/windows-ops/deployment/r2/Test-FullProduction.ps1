. (Join-Path $PSScriptRoot 'FullProduction.ps1')
$testDir=Join-Path $Out ('isolated-tests-'+[guid]::NewGuid().ToString('N'));NewPrivate $testDir
$script:Results=[Collections.Generic.List[object]]::new()
function Case([string]$Name,[scriptblock]$Body){try{& $Body;$script:Results.Add(@{Name=$Name;Result='PASS'})}catch{$script:Results.Add(@{Name=$Name;Result='FAIL';Error=$_.Exception.ToString()});throw}}
function Reject([scriptblock]$Body,[string]$Pattern){$rejected=$false;try{& $Body}catch{$rejected=$true;Need ($_.Exception.Message -match $Pattern) ('WRONG_REFUSAL '+$_.Exception.Message)};Need $rejected 'EXPECTED_REFUSAL'}
$r=NewKitRun 'Migrate' 'Plan';$r.Out=$testDir;$r.Log=Join-Path $testDir 'STAGE.log';$r.Receipt.AuditSchema='vmangos_migration_audit_'+$r.Id;$r.Receipt.SQLAttempted=[ordered]@{}
try{
 Case 'Fresh approval has bounded validity' {Assert-FullApprovalTiming ([pscustomobject]@{IssuedUtc=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');ExpiresUtc=[DateTimeOffset]::UtcNow.AddHours(4).ToString('o')})}
 Case 'Approval issued in the future refused' {Reject {Assert-FullApprovalTiming ([pscustomobject]@{IssuedUtc=[DateTimeOffset]::UtcNow.AddHours(1).ToString('o');ExpiresUtc=[DateTimeOffset]::UtcNow.AddHours(4).ToString('o')})} 'FRESH_APPROVAL'}
 Case 'Approval lasting more than24h refused' {Reject {Assert-FullApprovalTiming ([pscustomobject]@{IssuedUtc=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o');ExpiresUtc=[DateTimeOffset]::UtcNow.AddHours(25).ToString('o')})} 'FRESH_APPROVAL'}
 Case 'Actual complete manifest/artifacts/DEV receipts and independent verifiers' {Assert-FullCandidate $r}
 Case 'Existing private defaults have only user/password and no implicit login' {Assert-FullPrivateDefaults $r $r.Plan.FullCandidate.SourceDefaults}
 Case 'Different private credential path refused before client launch' {Reject {Assert-FullPrivateDefaults $r 'C:\fixture\other.ini'} 'EXACT_EXISTING_CREDENTIAL_PATH'}
 foreach($extra in @('init-command=SELECT 1','!include C:\fixture\other.ini','[mysqld]')){
  Case ('Private defaults directive rejected: '+$extra.Split('=')[0]) {$old=$r.Plan.FullCandidate.SourceDefaults;$fixture=Join-Path $testDir ('client-'+[guid]::NewGuid().ToString('N')+'.ini');try{[IO.File]::WriteAllText($fixture,("[client]`r`nuser=fixture`r`npassword=NOT_A_SECRET`r`n"+$extra),[Text.UTF8Encoding]::new($false));$r.Plan.FullCandidate.SourceDefaults=$fixture;Reject {Assert-FullPrivateDefaults $r $fixture} 'CLIENT_CONFIG'}finally{$r.Plan.FullCandidate.SourceDefaults=$old}}
 }
 Case 'Real ValidateInputs rejects missing NoDDL before task capture or Gate' {$r.State.Approval=[pscustomobject]@{NoDDLWindow=$false};Reject {[void](Invoke-FullStep $r ([pscustomobject]@{SourceDefaults=$r.Plan.FullCandidate.SourceDefaults}) 'ValidateInputs')} 'NO_DDL_WINDOW_REQUIRED'}
 Case 'Candidate descriptor tamper refused' {$old=$r.Plan.FullCandidate.SHA256;try{$r.Plan.FullCandidate.SHA256=('0'*64);Reject {Assert-FullCandidate $r} 'FULL_CANDIDATE'}finally{$r.Plan.FullCandidate.SHA256=$old}}
 Case 'Full-column comparison includes entry,patch and null-safe equality' {$q=New-RowSetComparisonSQL 'mangos_dev.quest_template' 'vmangos_migration_audit_x.world_expected' @('entry','patch','RequiredRaces','Title') @('entry','patch');Need ($q.Contains('USING(entry,patch)') -and $q.Contains('a.`Title` <=> b.`Title`') -and $q.Contains('LEFT JOIN')) 'FULL_QUERY'}
 Case 'Character comparisons use guid,quest and all fields' {$q=New-RowSetComparisonSQL 'characters_dev.character_queststatus' 'vmangos_migration_audit_x.queststatus_expected' @('guid','quest','status','rewarded') @('guid','quest');Need ($q.Contains('USING(guid,quest)') -and $q.Contains('a.`rewarded` <=> b.`rewarded`')) 'CHARACTER_QUERY'}
 Case 'Invalid SQL identifier refused' {Reject {New-RowSetComparisonSQL 'x.y;DROP' 'x.b' @('id') @('id')} 'COMPARISON_TABLE'}
 Case 'New preimage builder uses exact seven updates/two predicates, independent full-row copies' {$q=New-FullPreimageSQL $r;Need (([regex]::Matches($q,'UPDATE '+$r.Receipt.AuditSchema+'\.world_expected')).Count -eq 7 -and ([regex]::Matches($q,'INSERT INTO '+$r.Receipt.AuditSchema+'\.expected_deleted')).Count -eq 2 -and $q.Contains('CREATE TABLE '+$r.Receipt.AuditSchema+'.characters_before LIKE characters_dev.characters') -and $q.Contains('SELECT qs.*')) 'PREIMAGE_SHAPE';[IO.File]::WriteAllText((Join-Path $testDir 'PREIMAGE-QUERY-FIXTURE.sql'),$q,[Text.UTF8Encoding]::new($true))}
 Case 'Audit namespace injection refused' {$old=$r.Receipt.AuditSchema;try{$r.Receipt.AuditSchema='mangos_dev';Reject {New-FullPreimageSQL $r} 'AUDIT_OPERATION_NAMESPACE'}finally{$r.Receipt.AuditSchema=$old}}
 Case 'Private credential tokens carry only path, exact port and no implicit reconnect' {$r.State.MigrationDefaults=@{Path=$r.Plan.FullCandidate.SourceDefaults;SHA256=(Hash $r.Plan.FullCandidate.SourceDefaults)};$tokens=@(Get-FullSQLTokens $r);Need ($tokens.Count -eq 12 -and $tokens[0] -ceq ('--defaults-file='+$r.Plan.FullCandidate.SourceDefaults) -and '--port=3306' -cin $tokens -and '--skip-reconnect' -cin $tokens) 'MYSQL_TOKENS';Need (@($tokens|Where-Object {$_ -match '^--password'}).Count -eq 0) 'SECRET_TOKEN'}
 Case 'Rollback before SQL keeps separate approval gate' {$d=Get-FullRollbackDecision ([pscustomobject]@{SQLAttempted=[pscustomobject]@{}});Need ($d -ceq 'PRE_SQL_FILES_ONLY_SEPARATE_ROLLBACK_APPROVAL_REQUIRED') 'PRE_SQL_ROLLBACK'}
 Case 'Rollback UNKNOWN SQL is refused before mutation' {$d=Get-FullRollbackDecision ([pscustomobject]@{SQLAttempted=[pscustomobject]@{'20261025125310'=[pscustomobject]@{Result='UNKNOWN_UNTIL_VERIFIED'}}});Need ($d -clike 'DATA_CHANGED_OR_UNKNOWN*') 'POST_SQL_ROLLBACK'}
 Case 'Rollback missing history does not mean no SQL' {Reject {Get-FullRollbackDecision ([pscustomobject]@{SQLAttempted=$null})} 'HISTORY_UNKNOWN'}
 # Below: only SQL client / column-metadata boundary is fixture. Real builders,
 # Apply journal, VerifyWorld/Characters, rollback policy and sequencer execute.
 $script:SQLValue="0`t0`t0";$script:SQLCalls=[Collections.Generic.List[string]]::new();$script:FailSQL=$false
 function Get-FullColumns($Run,[string]$Schema,[string]$Table){if($Table -ceq 'quest_template'){@('entry','patch','RequiredRaces','Title')}elseif($Table -ceq 'characters'){@('guid','race','name')}else{@('guid','quest','status','rewarded')}}
 function Invoke-FullSQL($Run,[string]$SQL,[string]$Tag,[switch]$Write,[string]$File){$script:SQLCalls.Add($SQL+'|'+$Tag);if($script:FailSQL){throw 'FIXTURE_CLIENT_NONZERO_NO_RETRY'};if($Tag -clike 'MASK-*'){return '3'};if($Tag -ceq 'DELETED-COUNTS'){return "2`t2`t0"};return $script:SQLValue}
 Case 'Real full-row receiver accepts confirmed zero delta' {Assert-FullRows $r 'mangos_dev.quest_template' ($r.Receipt.AuditSchema+'.world_expected') @('entry','patch')}
 foreach($delta in @("1`t0`t0","0`t1`t0","0`t0`t1",'NULL','')){$script:SQLValue=$delta;Case ('Missing/extra/column/unknown delta refused: '+$delta) {Reject {Assert-FullRows $r 'mangos_dev.quest_template' ($r.Receipt.AuditSchema+'.world_expected') @('entry','patch')} 'FULL_ROWS'}}
 $script:SQLValue="0`t0`t0"
 Case 'Real WorldEffect derives count from SQL results, not historical126' {Verify-FullWorld $r;Need ($r.Receipt.WorldEffect.ActualMaskChanges -eq 3 -and $r.Receipt.WorldEffect.PrimaryKey.Count -eq 2) 'DERIVED_WORLD_COUNT'}
 Case 'Real CharactersEffect verifies expected remainder/all columns and derives deleted count' {Verify-FullCharacters $r;Need ($r.Receipt.CharactersEffect.ActualDeleted -eq 2) 'DERIVED_CHARACTERS_COUNT'}
 Case 'Apply attempt is durable before failing SQL and no replay allowed' {
  $script:FailSQL=$true;Reject {Invoke-FullPinnedMigration $r 0} 'FIXTURE_CLIENT_NONZERO';$saved=GetJson (Join-Path $testDir 'RECEIPT.json');Need ($saved.SQLAttempted.'20261025125310'.Result -ceq 'UNKNOWN_UNTIL_VERIFIED') 'DURABLE_UNKNOWN';$count=$SQLCalls.Count;Reject {Invoke-FullPinnedMigration $r 0} 'ALREADY_ATTEMPTED';Need ($SQLCalls.Count -eq $count) 'NO_REPLAY';$script:FailSQL=$false
 }
 Case 'Successful character attempt calls client once and remains pending data verification' {$before=$SQLCalls.Count;Invoke-FullPinnedMigration $r 1;Need ($SQLCalls.Count -eq ($before+1) -and $r.Receipt.SQLAttempted['20261025125408'].Result -ceq 'UNKNOWN_UNTIL_VERIFIED') 'NATIVE_SUCCESS_NOT_DATA_PROOF'}
 # Actual extended step dispatch and NewNativeDriver callbacks. Unchanged FIX5
 # native production steps are an explicit fixture boundary, never live SCM.
 $script:Dispatch=[Collections.Generic.List[string]]::new()
 function Assert-BackendQuiescent([string]$Name){Need ($Name -cin @('mangosd','realmd')) 'FIXTURE_QUIESCENT_SERVICE'}
 function Get-BackendStopObservation([string]$Name){[pscustomobject]@{State='Running';Processes=@([pscustomobject]@{PID=900001;Path='C:\fixture\mysqld.exe';CreatedUtc='2026-11-09T12:00:00Z'},[pscustomobject]@{PID=900002;Path='C:\fixture\mysqld.exe';CreatedUtc='2026-11-09T12:00:01Z'})}}
 function Get-NetTCPConnection {param($State,$LocalPort,$ErrorAction)[pscustomobject]@{OwningProcess=900002}}
 function Invoke-FullSQLRaw($Run,[string]$SQL,[string]$Tag,[string]$File){return ('WOW-SRV'+"`t3306`t"+$Run.Plan.FullCandidate.SourceDatadir+"`t"+$Run.Plan.FullCandidate.SourceUUID)}
 $script:InheritedFullStep={param($Run,$Inputs,$Step)$script:Dispatch.Add($Step);Ack}
 Case 'Actual extended callback routes StopWorld/StopRealm/backup/StopMySQL/start in contract order' {$d=New-FullDriver $r ([pscustomobject]@{});foreach($n in @('StopWorld','StopRealm','LogicalBackup','StopMySQL','StartMySQL','StartRealm','StartWorld')){$a=& $d[$n];Need ($a.OK -is [bool] -and $a.OK) 'ACK'};Need (($script:Dispatch -join '|') -ceq 'StopWorld|StopRealm|LogicalBackup|StopMySQL|StartMySQL|StartRealm|StartWorld') 'CALLBACK_ORDER'}
 foreach($failed in @('StopWorld','StopRealm','LogicalBackup','ApplyWorld','VerifyWorld','ApplyCharacters','VerifyCharacters','IndependentSQL','StopMySQL','StartWorld','Samples','RestoreTasks')){
  foreach($reason in @('NONZERO','UNKNOWN','TIMEOUT','EVIDENCE_ERROR')){
   $script:Trace=[Collections.Generic.List[string]]::new();$steps=@(Get-FullSteps);$rec=[ordered]@{Result='PREPARED';Phase='Guard';Completed=@();MutationBegun=$false;Error=$null;BarrierError=$null;ObservationError=$null}
   $d=@{Save={param($x)};Observe={param($x)};Barrier={param($x)$script:Trace.Add('BARRIER')}}
   foreach($step in $steps){$name=$step;$d[$step]={if($name -ceq $failed){throw ('FIXTURE_'+$reason)};$script:Trace.Add($name);Ack}.GetNewClosure()}
   Case ('Sequencer blocks successor after '+$failed+'/'+$reason) {Reject {[void](Invoke-KitSequence $steps $d $rec)} ('FIXTURE_'+$reason);$index=[array]::IndexOf($steps,$failed);Need ($rec.Result -ceq 'FAIL_CLOSED' -and @($script:Trace|Where-Object {$_ -ceq $steps[$index+1]}).Count -eq 0 -and $script:Trace.Contains('BARRIER')) 'FAIL_CLOSED_DEPENDENCY'}
  }
 }
 Case 'Full workflow puts verified backup before SQL; independent acceptance before MySQL stop' {$s=@(Get-FullSteps);Need ([array]::IndexOf($s,'StopRealm') -lt [array]::IndexOf($s,'LogicalBackup') -and [array]::IndexOf($s,'VerifyBackup') -lt [array]::IndexOf($s,'ApplyWorld') -and [array]::IndexOf($s,'IndependentSQL') -lt [array]::IndexOf($s,'StopMySQL') -and [array]::IndexOf($s,'Samples') -lt [array]::IndexOf($s,'RestoreTasks')) 'WORKFLOW_ORDER'}
 PutJson (Join-Path $Out 'TARGETED-TESTS.json') @{Result='PASS';PS=$PSVersionTable.PSVersion.ToString();Edition=$PSVersionTable.PSEdition;Count=$Results.Count;Tests=$Results;Boundaries=@('SCM/SQL/registry/tasks inherited FIX5 native steps are fixture-only','SQL comparison responses/metadata are explicit client fixtures, not real DB queries','Existing accepted actual MySQL comparison tests reused for unchanged Comparison.SQL functions','No live controls or SQL mutation');FixtureRoot=$testDir;TestedCode=@(Get-ChildItem $PSScriptRoot -File|Where-Object Name -in @('FullProduction.ps1','Deploy-FullCandidate.ps1','Verify-QuiescentSQL.ps1','Verify-Deployment.ps1','Rollback-FullCandidate.ps1','Comparison.SQL.ps1','Test-FullProduction.ps1')|ForEach-Object {@{Path=$_.Name;SHA256=(Hash $_.FullName)}})}
 Write-Host ('TESTS_PASS='+$Results.Count)
}catch{PutJson (Join-Path $testDir 'FAILED-TESTS.json') @{Result='FAIL';Tests=$Results;Error=$_.Exception.ToString()};throw}

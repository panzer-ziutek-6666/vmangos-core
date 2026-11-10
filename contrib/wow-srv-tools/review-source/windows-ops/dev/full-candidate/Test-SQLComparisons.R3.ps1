. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
$run=NewKitRun 'DevMigrations' 'Execute';$run.State.DevUUID='650601ed-dc07-11f1-b12b-b0227ad7e1e2';$run.State.CredentialMode='Admin';LoadProduction $run;AssertKitPins
$schema='coreupdate_r3_test_0850';$results=@();$okay=$false
function TestQuery([string]$Name,[string]$SQL,[string]$Expected){$answer=DevSQL $run $SQL ('REGRESSION-'+$Name);Need ($answer -ceq $Expected) ('REAL_SQL_REGRESSION '+$Name);$script:results+=@([pscustomobject]@{Name=$Name;Result='PASS';Actual=$answer;Expected=$Expected;SQL=$SQL})}
try{
 Need ((DevSQL $run ("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='"+$schema+"';") 'TEST-NAMESPACE') -ceq '0') 'NEW_TEST_SCHEMA_ONLY'
 [void](DevSQL $run ('CREATE DATABASE '+$schema+'; CREATE TABLE '+$schema+'.w_expected(entry INT NOT NULL,patch INT NOT NULL,RequiredRaces INT NOT NULL,payload VARCHAR(32),PRIMARY KEY(entry,patch)); CREATE TABLE '+$schema+'.w_actual LIKE '+$schema+'.w_expected; CREATE TABLE '+$schema+'.w_before LIKE '+$schema+'.w_expected; INSERT INTO '+$schema+".w_expected VALUES(7,0,77,'a'),(7,1,178,'b'),(8,0,0,'c'); INSERT INTO "+$schema+'.w_actual SELECT * FROM '+$schema+'.w_expected; INSERT INTO '+$schema+'.w_before SELECT entry,patch,0,payload FROM '+$schema+'.w_expected; CREATE TABLE '+$schema+'.c_expected(guid INT NOT NULL,quest INT NOT NULL,status INT,payload VARCHAR(32),PRIMARY KEY(guid,quest)); CREATE TABLE '+$schema+'.c_actual LIKE '+$schema+'.c_expected; INSERT INTO '+$schema+".c_expected VALUES(1,10,0,'a'),(1,11,3,'b'); INSERT INTO "+$schema+'.c_actual SELECT * FROM '+$schema+'.c_expected;') 'CREATE-TEST-TABLES')
 $worldQuery=New-RowSetComparisonSQL ($schema+'.w_actual') ($schema+'.w_expected') @('entry','patch','RequiredRaces','payload') @('entry','patch')
 TestQuery 'WORLD-DUPLICATE-ENTRY-DIFFERENT-PATCH' $worldQuery "0`t0`t0"
 TestQuery 'MASK-COUNT-FULL-KEY' (New-MaskCountSQL ($schema+'.w_actual') ($schema+'.w_before')) '2'
 [void](DevSQL $run ('DELETE FROM '+$schema+'.w_actual WHERE entry=7 AND patch=1;') 'TEST-MISSING-VARIANT');TestQuery 'WORLD-MISSING-VARIANT' $worldQuery "1`t0`t0"
 [void](DevSQL $run ('INSERT INTO '+$schema+'.w_actual SELECT * FROM '+$schema+'.w_expected WHERE entry=7 AND patch=1; INSERT INTO '+$schema+".w_actual VALUES(7,2,0,'extra');") 'TEST-EXTRA-VARIANT');TestQuery 'WORLD-EXTRA-VARIANT' $worldQuery "0`t1`t0"
 [void](DevSQL $run ('DELETE FROM '+$schema+'.w_actual WHERE patch=2; UPDATE '+$schema+'.w_actual SET RequiredRaces=0 WHERE entry=7 AND patch=1;') 'TEST-MASK-CHANGE');TestQuery 'WORLD-MASK-CHANGE' $worldQuery "0`t0`t1";TestQuery 'MASK-COUNT-ONE-VARIANT' (New-MaskCountSQL ($schema+'.w_actual') ($schema+'.w_before')) '1'
 [void](DevSQL $run ('UPDATE '+$schema+'.w_actual SET RequiredRaces=178 WHERE entry=7 AND patch=1; UPDATE '+$schema+".w_actual SET payload='changed' WHERE entry=7 AND patch=0;") 'TEST-NONMASK-CHANGE');TestQuery 'WORLD-OTHER-COLUMN' $worldQuery "0`t0`t1"
 $charsQuery=New-RowSetComparisonSQL ($schema+'.c_actual') ($schema+'.c_expected') @('guid','quest','status','payload') @('guid','quest')
 TestQuery 'CHARACTERS-SAME-GUID-TWO-QUESTS' $charsQuery "0`t0`t0"
 [void](DevSQL $run ('DELETE FROM '+$schema+'.c_actual WHERE guid=1 AND quest=11;') 'TEST-CHARACTER-MISSING');TestQuery 'CHARACTERS-MISSING-QUEST' $charsQuery "1`t0`t0"
 [void](DevSQL $run ('INSERT INTO '+$schema+'.c_actual SELECT * FROM '+$schema+'.c_expected WHERE quest=11; INSERT INTO '+$schema+".c_actual VALUES(1,12,0,'extra');") 'TEST-CHARACTER-EXTRA');TestQuery 'CHARACTERS-EXTRA-QUEST' $charsQuery "0`t1`t0"
 [void](DevSQL $run ('DELETE FROM '+$schema+'.c_actual WHERE quest=12; UPDATE '+$schema+".c_actual SET payload='changed' WHERE quest=10;") 'TEST-CHARACTER-COLUMN');TestQuery 'CHARACTERS-OTHER-COLUMN' $charsQuery "0`t0`t1"
 $proof=Export-AuditProofR3 $run 'AUDIT-AFTER-REAL-SQL-TESTS';$base=GetJson (Join-Path $Out 'PREIMAGES-BASELINE.json');Need ($proof.SHA256 -ceq $base.SHA256) 'OPERATIONAL_PREIMAGES_CHANGED'
 $okay=$true
}catch{$detail=$_.Exception.Message;$position=$_.InvocationInfo.PositionMessage;Write-Host $_}
PutJson (Join-Path $Out 'SQL-COMPARISON-TESTS.json') @{Result=$(if($okay){'PASS'}else{'FAIL'});Cases=$script:results;Error=$(if(!$okay){$detail}else{$null});Position=$(if(!$okay){$position}else{$null});Schema=$schema;Instrumentation='No substituted SQL results or DB engine. Actual pinned mysql.exe and real guarded MySQL DEV23306, actual query generators used by workflow/verifier. Only small synthetic tables in this new schema mutated. Operational audit preimages byte fingerprint unchanged.';ComparisonCodeSHA256=(Hash (Join-Path $Root 'Comparison.R3.ps1'));SQLWasReal=$true;ProductionWrites=0;ServiceControls=0}
if(!$okay){exit 1};exit 0

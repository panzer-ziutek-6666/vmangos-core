. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
. (Join-Path $PSScriptRoot 'Verifier.R2.ps1')
Import-Module NetTCPIP -ErrorAction Stop
$binding=GetJson (Join-Path $PSScriptRoot 'CONTINUATION-BINDING.json')
$fixture=Join-Path $Out ('tests-private-'+[guid]::NewGuid().ToString('N'));NewPrivate $fixture
$script:Fixture=$fixture;$script:Scenario='GOOD1077';$script:FixtureKind='DevSetup';$script:CurrentPlan=GetJson (Join-Path $PSScriptRoot 'KIT-PLAN.json')
$script:BoundVerifier=Join-Path $Out 'verified\DevSetup-5159397b4eeb42e0babb8724c4b64a9c\VERIFIER-R2.json'
$script:MappedVerifier=Join-Path $fixture 'mapped-setup-verifier.json'
$script:RealPrivate=(Get-Command AssertPrivate).ScriptBlock
function ReadJson([string]$Path){if($Path -ceq $script:BoundVerifier){$Path=$script:MappedVerifier};[IO.File]::ReadAllText($Path)|ConvertFrom-Json}
function Hash([string]$Path){if($Path -ceq $script:BoundVerifier){$Path=$script:MappedVerifier};(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
function AssertPrivate([string]$Path){if($Path -ceq $script:BoundVerifier){$Path=$script:MappedVerifier};& $script:RealPrivate $Path}
function Get-CimInstance {param($ClassName,$Filter,$ErrorAction)
 $d=$script:CurrentPlan.Dev;$name=$null;foreach($n in @($d.MySQL,$d.Realm,$d.World)){if($Filter -ceq ("Name='"+$n+"'")){$name=$n}}
 if($ClassName -ceq 'Win32_Service' -and $name){
  $isDB=$name -ceq $d.MySQL;$exe=Join-Path $d.Runtime 'mangosd.exe';$config=Join-Path $d.Runtime 'mangosd.conf'
  if($name -ceq $d.Realm){$exe=Join-Path $d.Runtime 'realmd.exe';$config=Join-Path $d.Runtime 'realmd.conf'}
  if($isDB){$exe=Join-Path $script:CurrentPlan.MySQLBin 'mysqld.exe';$config=$d.MySQLIni}
  $state='Stopped';$number=0;$code=1077
  if($isDB -and $script:FixtureKind -cne 'DevAccept'){$state='Running';$number=51001;$code=0}
  if($script:Scenario -ceq 'GOOD0' -or $script:FixtureKind -ceq 'DevAccept'){$code=0}
  if($name -ceq $d.Realm){switch($script:Scenario){'1067'{$code=1067};'PENDING'{$state='Start Pending';$number=7777;$code=0};'MISSING'{$code=$null};'STOP1077'{$code=1077}}}
  return [pscustomobject]@{Name=$name;State=$state;ProcessId=$number;PathName=($exe+' --defaults-file='+$config+' '+$name);StartMode='Manual';StartName='LocalSystem';ExitCode=$code;ServiceSpecificExitCode=0}
 }
 if($ClassName -ceq 'Win32_Process'){
  if($Filter -ceq "Name='mysqld.exe'"){
   if($script:FixtureKind -ceq 'DevAccept'){return};foreach($n in @(51001,51002)){[pscustomobject]@{ProcessId=$n;ParentProcessId=$(if($n -eq 51001){600}else{51001});ExecutablePath=(Join-Path $script:CurrentPlan.MySQLBin 'mysqld.exe');CreationDate=[DateTime]::UtcNow.Date.AddHours(1);CommandLine=('mysqld --defaults-file='+$d.MySQLIni+' '+$d.MySQL)}};return
  }
  if($Filter -cin @("Name='mangosd.exe'","Name='realmd.exe'")){
   if($script:Scenario -ceq 'FOREIGN' -and $Filter -ceq "Name='realmd.exe'"){[pscustomobject]@{ProcessId=71001;ParentProcessId=600;ExecutablePath=(Join-Path $d.Runtime 'realmd.exe');CreationDate=[DateTime]::UtcNow.Date;CommandLine='realmd -c C:\foreign\realmd.conf'}};return
  }
 }
 if($Filter){CimCmdlets\Get-CimInstance -ClassName $ClassName -Filter $Filter -ErrorAction Stop}else{CimCmdlets\Get-CimInstance -ClassName $ClassName -ErrorAction Stop}
}
function Get-NetTCPConnection {param($State,$LocalPort,$ErrorAction)
 if($LocalPort -in @(23306,23724,28085,27878)){
  if($LocalPort -eq 23306 -and $script:FixtureKind -cne 'DevAccept'){[pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=23306;OwningProcess=51002}};return
 }
 NetTCPIP\Get-NetTCPConnection -State Listen -ErrorAction Stop
}
function InvokeInputFile {param($Run,$Exe,$Tokens,$InputPath,$Tag,$Timeout)
 Need ('--port=23306' -cin $Tokens) 'FIXTURE_SQL_MUST_TARGET_DEV23306';$q=[IO.File]::ReadAllText($InputPath)
 Need ($q.TrimStart().StartsWith('SELECT',[StringComparison]::Ordinal)) 'VERIFIER_MUST_BE_READ_ONLY'
 $value=''
 if($q.StartsWith('SELECT @@port,@@datadir,@@server_uuid,')){$value='23306'+"`t"+$Run.Plan.Dev.Data+"`t650601ed-dc07-11f1-b12b-b0227ad7e1e2`tOFF`t0`t0"}
 elseif($q.StartsWith('SELECT TABLE_SCHEMA,COUNT(*)')){
  $value="characters_dev`t69`nlogs_dev`t10`nmangos_dev`t193`nrealmd_dev`t13"
  if($script:Scenario -ceq 'IMPORT_MISSING'){$value="characters_dev`t69`nlogs_dev`t10`nmangos_dev`t193"}
  if($script:Scenario -ceq 'IMPORT_DUPLICATE'){$value="characters_dev`t69`nlogs_dev`t10`nmangos_dev`t193`nlogs_dev`t10"}
 }
 elseif($q.StartsWith('SELECT COLUMN_NAME')){if($q.Contains('quest_template')){$value="entry`nRequiredRaces`nMinLevel"}else{$value="guid`nquest`nstatus`nrewarded"}}
 elseif($q.StartsWith('SELECT id FROM ')){$db=([regex]::Match($q,'FROM ([a-z_]+)\.migrations')).Groups[1].Value;$map=@{mangos_dev='WORLD';characters_dev='CHARACTERS';realmd_dev='LOGON';logs_dev='LOGS'};$text=[IO.File]::ReadAllText('C:\Scripts\CORE-CAND-20261109-0210\source\src\shared\migrations_list.h');$b=[regex]::Match($text,'(?s)MIGRATIONS_'+$map[$db]+'\[\]\s*=\s*\{(.*?)\};');$value=(@([regex]::Matches($b.Groups[1].Value,'"(\d+)"')|ForEach-Object {$_.Groups[1].Value}) -join "`n")}
 elseif($q.Contains('(SELECT COUNT(*) FROM coreupdate_audit.expected_deleted),(SELECT COUNT(*) FROM coreupdate_audit.queststatus_before)')){$value="4`t4"}
 elseif($q.Contains('coreupdate_audit.characters_before')){$value="0`t0`t0`t0`t0`t0"}
 elseif($q.Contains('coreupdate_audit.world_expected')){$value="0`t0`t0"}
 else{throw 'UNRECOGNIZED_FIXTURE_SELECT'}
 $o=Join-Path $Run.Out ($Tag+'.stdout.log');$e=Join-Path $Run.Out ($Tag+'.stderr.log');[IO.File]::WriteAllText($o,$value);[IO.File]::WriteAllText($e,'');[pscustomobject]@{ExitCode=0;Stdout=$o;Stderr=$e}
}
function NativeKit {param($Run,$Exe,$Tokens,$Tag,$Timeout)throw 'NO_NATIVE_MUTATION_IN_VERIFIER_TEST'}
$results=@();$okay=$false
try{
 $native=Join-Path $fixture 'fixture-native.json';PutJson $native @{Started=$true;StreamsCaptured=$true;ExitCode=0}
 $pre=Join-Path $fixture 'preimage.txt';[IO.File]::WriteAllText($pre,'fixture SQL boundary preimage, not a real DB backup')
 $migrationRun=NewKitRun 'DevMigrations' 'Execute';$migrationRun.Receipt.Result='PASS';$migrationRun.Receipt.Phase='Complete';$migrationRun.Receipt.Completed=@(Get-KitSteps 'DevMigrations');$migrationRun.Receipt.CandidateManifestSHA256=$script:CurrentPlan.CandidateBinding.ManifestSHA256;$migrationRun.Receipt.DevUUID=$binding.DevSetup.UUID;$migrationRun.Receipt.PreMigrationBackup=@{Path=$pre;SHA256=(Hash $pre);NativeExit=0};$migrationReceipt=Join-Path $migrationRun.Out 'RECEIPT.json';PutJson $migrationReceipt $migrationRun.Receipt
 $goodSetup=$null;$goodMigration=$null
 foreach($kind in @('DevSetup','DevMigrations')){
  $script:FixtureKind=$kind;$receipt=$binding.DevSetup.Receipt;$process=$binding.DevSetup.ProcessRecord;if($kind -ceq 'DevMigrations'){$receipt=$migrationReceipt;$process=$native}
  $cases=@('GOOD1077','GOOD0','1067','PENDING','FOREIGN','MISSING');if($kind -ceq 'DevSetup'){$cases+=@('IMPORT_MISSING','IMPORT_DUPLICATE')}
  foreach($case in $cases){$script:Scenario=$case;$v=Invoke-PhaseVerification $receipt $process (Join-Path $fixture ([guid]::NewGuid().ToString('N')+'.json'));$expect=$case -cin @('GOOD1077','GOOD0');Need (($v.Result -ceq 'PASS') -eq $expect) ('VERIFIER_CASE '+$kind+' '+$case+' '+$v.Error);$results+=[pscustomobject]@{Kind=$kind;Case=$case;ExpectedPass=$expect;Result='PASS';Actual=$v.Result;Reason=$v.Error};if($case -ceq 'GOOD1077'){if($kind -ceq 'DevSetup'){$goodSetup=$v}else{$goodMigration=$v}}}
 }
 # Actual next-phase guard and sequencer consume the corrected proof. One exact
 # verifier path is redirected at filesystem-read boundaries to private fixture data.
 PutJson $script:MappedVerifier $goodSetup
 $setupRef=@{Receipt=$binding.DevSetup.Receipt;ReceiptSHA256=$binding.DevSetup.ReceiptSHA256;Verifier=$script:BoundVerifier;VerifierSHA256=(Hash $script:BoundVerifier);Operation=$binding.DevSetup.Operation}
 $migVerifier=Join-Path $migrationRun.Out 'INDEPENDENT-VERIFIER.json';PutJson $migVerifier $goodMigration
 $migRef=@{Receipt=$migrationReceipt;ReceiptSHA256=(Hash $migrationReceipt);Verifier=$migVerifier;VerifierSHA256=(Hash $migVerifier);Operation=$migrationRun.Id}
 foreach($next in @('DevMigrations','DevAccept')){
  $script:FixtureKind=$next;$script:Scenario='GOOD1077';$r=NewKitRun $next 'Execute';$inputs=[pscustomobject]@{Priors=[pscustomobject]@{DevSetup=$setupRef;DevMigrations=$migRef}}
  LoadProduction $r;$driver=NewNativeDriver $r $inputs
  [void](Invoke-KitSequence @('Guard','ValidateInputs') $driver $r.Receipt);Need ($r.Receipt.Result -ceq 'PASS' -and $r.State.DevUUID -ceq $binding.DevSetup.UUID) 'ACTUAL_NEXT_PHASE_CONSUMER';$results+=[pscustomobject]@{Kind=$next;Case='Real sequencer Guard/ValidateInputs consumes exact corrected verification';Result='PASS'}
 }
 $script:FixtureKind='DevAccept'
 $accept=NewKitRun 'DevAccept' 'Execute';$accept.Receipt.Result='PASS';$accept.Receipt.Phase='Complete';$accept.Receipt.Completed=@(Get-KitSteps 'DevAccept');$accept.Receipt.CandidateManifestSHA256=$script:CurrentPlan.CandidateBinding.ManifestSHA256;$accept.Receipt.DevUUID=$binding.DevSetup.UUID;$acceptPath=Join-Path $accept.Out 'RECEIPT.json';PutJson $acceptPath $accept.Receipt
 foreach($case in @('STOP1077','STOP_NONZERO','STOP_UNKNOWN')){
  $script:Scenario=$case
  foreach($n in @($script:CurrentPlan.Dev.World,$script:CurrentPlan.Dev.Realm,$script:CurrentPlan.Dev.MySQL)){$exits=@(foreach($i in 1..$(if($n -ceq $script:CurrentPlan.Dev.MySQL){2}else{1})){@{PID=$i;Path='fixture.exe';CreatedUtc='2026-11-09T00:00:00Z';Measurement=$(if($case -ceq 'STOP_UNKNOWN'){'UNKNOWN'}else{'MEASURED'});NativeExit=$(if($case -ceq 'STOP_NONZERO'){7}elseif($case -ceq 'STOP_UNKNOWN'){$null}else{0})}});PutJson (Join-Path $accept.Out ($n+'-STOP-RESULT.json')) @{Result='PASS';ResultKnown=$true;ProcessExits=$exits;ExpectedProcesses=$exits;PrimaryError=$null;EvidenceErrors=@();CleanupErrors=@()}}
  $v=Invoke-PhaseVerification $acceptPath $native (Join-Path $fixture ([guid]::NewGuid().ToString('N')+'.json'));Need ($v.Result -ceq 'FAIL') ('STOP_MUST_REFUSE '+$case);$results+=[pscustomobject]@{Kind='DevAccept';Case=$case;Result='PASS';Actual=$v.Result;Reason=$v.Error}
 }
 $failProof=$goodSetup.PSObject.Copy();$failProof.Result='FAIL';PutJson $script:MappedVerifier $failProof;$setupRef.VerifierSHA256=Hash $script:BoundVerifier
 $r=NewKitRun 'DevMigrations' 'Execute';LoadProduction $r;$driver=NewNativeDriver $r ([pscustomobject]@{Priors=[pscustomobject]@{DevSetup=$setupRef}});$refused=$false;try{[void](Invoke-KitSequence @('Guard','ValidateInputs','Gate') $driver $r.Receipt)}catch{$refused=$true};Need ($refused -and !$r.Receipt.MutationBegun -and 'Gate' -cnotin $r.Receipt.Completed) 'FAIL_VERIFIER_MUST_BLOCK_NEXT_GATE';$results+=[pscustomobject]@{Kind='DevMigrations';Case='FAIL proof blocks real sequencer before Gate';Result='PASS'}
 $okay=$true
}catch{$errorDetail=$_.Exception.ToString();$errorPosition=$_.InvocationInfo.PositionMessage;Write-Host $_}
PutJson (Join-Path $Out 'VERIFIER-TESTS.json') @{Result=$(if($okay){'PASS'}else{'FAIL'});Cases=$results;Error=$(if(!$okay){$errorDetail}else{$null});Position=$(if(!$okay){$errorPosition}else{$null});Instrumentation='Actual complete LoadProduction, verifier function, candidate/instance guards, DevServiceRecord/Read-StopObservationFix3, SQL-effect comparators, next-phase Get-VerifiedPrior, NewNativeDriver and sequencer. Only individual DEV SCM/CIM/ports and native SQL reads substituted; one exact corrected-verifier filesystem path mapped to private fixture. Native records/migration receipt/preimage explicitly synthetic in fixture. Production SCM/CIM read-only. No tested function replaced.';RealServiceControls=0;RealSQLWrites=0;VerifierSHA256=(Hash (Join-Path $PSScriptRoot 'Verifier.R2.ps1'));CoreSHA256=(Hash (Join-Path $PSScriptRoot 'Candidate.Core.ps1'))}
if(!$okay){exit 1};exit 0

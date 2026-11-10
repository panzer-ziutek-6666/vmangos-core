. (Join-Path $PSScriptRoot 'Candidate.Core.ps1')
$run=NewKitRun 'DevSetup' 'Execute';$run.State.DevUUID='11111111-2222-3333-4444-555555555555';$run.State.CredentialMode='Admin'
LoadProduction $run
$script:TestRun=$run;$script:Scenario='GOOD';$script:Calls=@();$script:Mutations=0
function Hash {param($Path)
 if($Path.StartsWith($script:TestRun.Plan.Dev.Runtime+'\',[StringComparison]::OrdinalIgnoreCase)){
  if($script:Scenario -ceq 'RUNTIME_CHANGED'){return ('0'*64)}
  return (@($script:TestRun.Plan.Artifacts|Where-Object {[IO.Path]::GetFileName($_.Path) -ceq [IO.Path]::GetFileName($Path)})[0].SHA256)
 };return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}
function Get-CimInstance {param($ClassName,$Filter,$ErrorAction)
 $d=$script:TestRun.Plan.Dev;$exe=Join-Path $script:TestRun.Plan.MySQLBin 'mysqld.exe';$config=$d.MySQLIni
 if($ClassName -ceq 'Win32_Service'){return [pscustomobject]@{Name=$d.MySQL;State='Running';ProcessId=41001;PathName=($exe+' --defaults-file='+$config+' '+$d.MySQL);StartMode='Manual';StartName='LocalSystem';ExitCode=0;ServiceSpecificExitCode=0}}
 Need ($ClassName -ceq 'Win32_Process') 'FIXTURE_READ_BOUNDARY'
 if($script:Scenario -ceq 'FOREIGN'){$config='C:\foreign\my.ini'}
 foreach($n in @(41001,41002)){[pscustomobject]@{ProcessId=$n;ParentProcessId=$(if($n -eq 41001){600}else{41001});ExecutablePath=$exe;CreationDate=([DateTime]::UtcNow.Date.AddHours(1));CommandLine=($exe+' --defaults-file='+$config+' '+$d.MySQL)}}
}
function Get-NetTCPConnection {param($State,$LocalPort,$ErrorAction)
 [pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=23306;OwningProcess=$(if($script:Scenario -ceq 'FOREIGN_PORT'){9999}else{41002})}
}
function InvokeInputFile {param($Run,$Exe,$Tokens,$InputPath,$Tag,$Timeout)
 Need ('--port=23306' -cin $Tokens -and '--no-login-paths' -cin $Tokens) 'SQL_BOUNDARY_PORT'
 $q=[IO.File]::ReadAllText($InputPath);$script:Calls+=@($Tag)
 if($q.StartsWith('SELECT @@port,@@datadir,@@server_uuid,')){
  $uuid=$Run.State.DevUUID;$data=$Run.Plan.Dev.Data;$port='23306'
  if($script:Scenario -ceq 'UUID'){$uuid=$Run.Plan.CandidateBinding.SourceUUID};if($script:Scenario -ceq 'DATADIR'){$data=$Run.Plan.CandidateBinding.SourceDatadir};if($script:Scenario -ceq 'SQL3306'){$port='3306'}
  $value=$port+"`t"+$data+"`t"+$uuid+"`tOFF`t0`t0"
 }else{$script:Mutations++;$value='FIXTURE_SQL_RESULT'}
 $p=Join-Path $Run.Out ($Tag+'.stdout.log');$e=Join-Path $Run.Out ($Tag+'.stderr.log');[IO.File]::WriteAllText($p,$value);[IO.File]::WriteAllText($e,'');[pscustomobject]@{Stdout=$p;Stderr=$e;ExitCode=0}
}
function AssertPrivate {param($Path)if($Path -ceq $script:TestRun.Plan.Dev.Defaults){return};NoReparse $Path}
function NativeKit {param($Run,$Exe,$Tokens,$Tag,$Timeout)throw 'SERVICE_CONTROL_FORBIDDEN_IN_GUARD_TEST'}
$results=@()
try{
 foreach($n in @('DevServiceRecord','DevPortReady','DevSQL','AttestDevDB','New-ProductionWorldDriver')){$c=Get-Command $n;Need ($c.ScriptBlock.File.StartsWith($PSScriptRoot,[StringComparison]::OrdinalIgnoreCase)) ('LOADER_PROVENANCE '+$n);$results+=[pscustomobject]@{Case=('Loader '+$n);Result='PASS';File=$c.ScriptBlock.File}}
 $t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'controller\Production.Driver.ps1'),[ref]$t,[ref]$e);$fn=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq 'Read-StopObservationFix3'})[0];Need (([regex]::Replace((Get-Command Read-StopObservationFix3).Definition,'^param\([^\n]+\)\r?\n','').Replace("`r`n","`n").Trim()) -ceq $fn.Body.GetScriptBlock().ToString().Replace("`r`n","`n").Trim()) 'READER_EXACT_IMPORTED_BODY'
 # Actual reader, readiness and SQL guard; only single system/native calls above are substituted.
 $record=DevServiceRecord $run $run.Plan.Dev.MySQL -ReadMode StartWait;Need ($record.Ready -and $record.Processes.Count -eq 2) 'REAL_READER_TWO_PROCESSES'
 DevStart $run $run.Plan.Dev.MySQL -TimeoutSeconds 1
 $driver=NewNativeDriver $run ([pscustomobject]@{})
 $ack=& $driver.AttestDevEndpoint;Assert-KitAck $ack 'AttestDevEndpoint'
 $results+=[pscustomobject]@{Case='Actual DevStart reuse + NewNativeDriver after complete loader + AttestDevEndpoint';Result='PASS';File=$PSScriptRoot}
 foreach($scenario in @('SQL3306','UUID','DATADIR','FOREIGN','FOREIGN_PORT','RUNTIME_CHANGED')){
  $script:Scenario=$scenario;$before=$script:Mutations;$refused=$false
  try{[void](DevSQL $run 'UPDATE fixture_only SET n=1;' ('REJECT-'+$scenario))}catch{$refused=$true;$reason=$_.Exception.Message}
  Need ($refused -and $script:Mutations -eq $before) ('MUTATION_NOT_BLOCKED '+$scenario);$results+=[pscustomobject]@{Case=$scenario;Result='PASS';Reason=$reason}
 }
 $script:Scenario='GOOD'
 foreach($p in @(3306,13306)){$saved=$run.Plan.Dev.MySQLPort;$run.Plan.Dev.MySQLPort=$p;$refused=$false;try{[void](DevSQL $run 'UPDATE fixture_only SET n=1;' 'WRONG-PORT')}catch{$refused=$true;$reason=$_.Exception.Message}finally{$run.Plan.Dev.MySQLPort=$saved};Need $refused 'NAMESPACE_REFUSAL';$results+=[pscustomobject]@{Case=('Namespace '+$p);Result='PASS';Reason=$reason}}
 foreach($kind in @('Artifacts','SQL')){
  $entry=$run.Plan.Artifacts[0];if($kind -ceq 'SQL'){$entry=$run.Plan.CandidateBinding.SQL[0]};$saved=$entry.SHA256;$entry.SHA256='0'*64;$refused=$false
  try{[void](DevSQL $run 'UPDATE fixture_only SET n=1;' 'MODIFIED-PIN')}catch{$refused=$true;$reason=$_.Exception.Message}finally{$entry.SHA256=$saved};Need $refused 'MODIFIED_PIN_REFUSAL';$results+=[pscustomobject]@{Case=('Modified '+$kind);Result='PASS';Reason=$reason}
 }
 $before=$script:Mutations;InvokePinnedDevSQLFile $run $run.Plan.CandidateBinding.SQL[0].Path $run.Plan.CandidateBinding.SQL[0].SHA256 'mangos_dev' 'FIXTURE-APPLY-WORLD';Need ($script:Mutations -eq $before+1) 'EXACT_SQL_CONSUMER'
 $results+=[pscustomobject]@{Case='Actual pinned SQL consumer through read guard to fixture SQL boundary';Result='PASS'}
 $run.Receipt.Result='PASS'
}catch{$run.Receipt.Result='FAIL';$run.Receipt.Error=$_.Exception.ToString();$run.Receipt.Position=$_.InvocationInfo.PositionMessage;Write-Host $_}
PutJson (Join-Path $script:Out 'GUARD-TESTS.json') @{Result=$run.Receipt.Result;Tests=$results;Error=$run.Receipt.Error;Position=$(if($run.Receipt.Contains('Position')){$run.Receipt.Position}else{$null});Instrumentation='Only SCM/CIM single reads, port reads, private fixture file check and native SQL/process boundary. Actual complete loader, DevStart, DevPortReady, DevServiceRecord, reader, candidate guards, SQL consumers, factory are not replaced.';RealServiceControls=0;RealSQLWrites=0;FinalCodePins=@(Get-ChildItem $PSScriptRoot -File|Where-Object Extension -in @('.ps1','.psm1','.json')|ForEach-Object {@{Path=$_.Name;SHA256=(Hash $_.FullName)}})}
if($run.Receipt.Result -cne 'PASS'){exit 1};exit 0

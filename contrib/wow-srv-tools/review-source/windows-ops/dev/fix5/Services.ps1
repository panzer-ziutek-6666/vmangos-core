function Get-DevStopDefinitionFix3($Run,[string]$Name){
 $d=$Run.Plan.Dev;Need ($Name -cin @($d.MySQL,$d.Realm,$d.World)) 'DEV_SERVICE_ALLOWLIST'
 $exe=Join-Path $d.Runtime 'mangosd.exe';$config=Join-Path $d.Runtime 'mangosd.conf';$others=@((Join-Path $Run.Plan.Runtime 'mangosd.exe'))
 if($Name -ceq $d.Realm){$exe=Join-Path $d.Runtime 'realmd.exe';$config=Join-Path $d.Runtime 'realmd.conf';$others=@((Join-Path $Run.Plan.Runtime 'realmd.exe'))}
 if($Name -ceq $d.MySQL){$exe=Join-Path $Run.Plan.MySQLBin 'mysqld.exe';$config=$d.MySQLIni;$others=@()}
 $base=$Run.Out;if([string]::IsNullOrWhiteSpace($base)){$base=$script:Out}
 [pscustomobject]@{Name=$Name;Exe=$exe;Config=$config;OtherImages=$others;OtherConfigs=@($Run.Plan.ActiveMySQLDefaults);EvidenceBase=$base}
}
function DevServiceRecord($Run,[string]$Name,[switch]$Transition,$Expected,$Journal,[ValidateSet('Auto','BeforeStart','StartWait')][string]$ReadMode='Auto'){
 $definition=Get-DevStopDefinitionFix3 $Run $Name
 Read-StopObservationFix3 $definition ([bool]$Transition) $Expected $Journal -ReadMode $ReadMode
}
function DevStop($Run,[string]$Name,[ValidateRange(1,900)][int]$TimeoutSeconds=180){
 $d=$Run.Plan.Dev
 $dependencies={
  if($Name -cne $d.World){$w=DevServiceRecord $Run $d.World;Need ($w.State -ceq 'Stopped' -and $w.Processes.Count -eq 0 -and $w.Win32 -eq 0 -and $w.Specific -eq 0) 'DEV_WORLD_NOT_CONFIRMED_DOWN'}
  if($Name -ceq $d.MySQL){$w=DevServiceRecord $Run $d.Realm;Need ($w.State -ceq 'Stopped' -and $w.Processes.Count -eq 0 -and $w.Win32 -eq 0 -and $w.Specific -eq 0) 'DEV_REALM_NOT_CONFIRMED_DOWN'}
 }.GetNewClosure()
 $strict={param($j)DevServiceRecord $Run $Name -Journal $j}.GetNewClosure()
 $transition={param($j,$expected)DevServiceRecord $Run $Name -Transition -Expected $expected -Journal $j}.GetNewClosure()
 $request={ [void](NativeKit $Run 'C:\Windows\System32\sc.exe' @('stop',$Name) ('STOP-'+$Name) 30000) }.GetNewClosure()
 [void](Invoke-RetainedStopFix3 $Name $strict $transition $request $dependencies $Run.Out (Join-Path $Run.Out ($Name+'-STOP-RESULT.json')) $TimeoutSeconds)
}
function DevPortReady($Run,[string]$Name,[int]$Port,$Expected,[ref]$Observation){
 $s=DevServiceRecord $Run $Name -ReadMode StartWait -Expected $Expected
 if($null -ne $Observation){$Observation.Value=$s}
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
 Need (@($listeners|Where-Object LocalAddress -notin @('127.0.0.1','::1')).Count -eq 0) 'DEV_NOT_LOOPBACK'
 if(!$s.Ready){return $false}
 $pids=@($s.Processes|ForEach-Object PID)
 Need (@($listeners|Where-Object {$_.OwningProcess -notin $pids}).Count -eq 0) 'DEV_PORT_FOREIGN_OWNER'
 if($listeners.Count -eq 0){return $false}
 # Bracket the port read with stable SCM/CIM identity reads of the same generation.
 $after=DevServiceRecord $Run $Name -ReadMode StartWait -Expected $s.Processes
 if($null -ne $Observation){$Observation.Value=$after}
 return $after.Ready
}
function DevSQL($Run,[string]$SQL,[string]$Tag){
 $Tag=$Tag+'-'+[guid]::NewGuid().ToString('N')
 $d=$Run.Plan.Dev;Need (DevPortReady $Run $d.MySQL $d.MySQLPort) 'DEV_DB_ENDPOINT_NOT_OWNED'
 AssertPrivate $d.Defaults;$input=Join-Path $Run.Out ($Tag+'.sql');[IO.File]::WriteAllText($input,$SQL,[Text.UTF8Encoding]::new($false))
 $r=InvokeInputFile $Run (Join-Path $Run.Plan.MySQLBin 'mysql.exe') @(('--defaults-extra-file='+$d.Defaults),'--protocol=TCP','--host=127.0.0.1',('--port='+$d.MySQLPort),'--batch','--skip-column-names') $input $Tag 120000
 return [IO.File]::ReadAllText($r.Stdout).Trim()
}
function AttestDevDB($Run){
 $answer=DevSQL $Run 'SELECT @@port,@@datadir;' 'DEV-INSTANCE'
 $parts=$answer.Split("`t");Need ($parts.Count -eq 2 -and [int]$parts[0] -eq 13306 -and [IO.Path]::GetFullPath($parts[1].Replace('/','\')).TrimEnd('\') -ieq $Run.Plan.Dev.Data) 'DEV_DATABASE_NOT_ISOLATED'
}
function DevStart($Run,[string]$Name,[ValidateRange(1,900)][int]$TimeoutSeconds=180){
 $d=$Run.Plan.Dev;$port=$d.MySQLPort;$timeout=$TimeoutSeconds
 if($Name -ceq $d.Realm){AttestDevDB $Run;$port=$d.RealmPort}
 if($Name -ceq $d.World){Need (DevPortReady $Run $d.Realm $d.RealmPort) 'DEV_REALM_NOT_READY';AttestDevDB $Run;$port=$d.WorldPort;if(!$PSBoundParameters.ContainsKey('TimeoutSeconds')){$timeout=900}}
 $epoch=[DateTimeOffset]::UtcNow;$timer=[Diagnostics.Stopwatch]::StartNew();$issued=$false;$expected=$null
 do{
  $s=DevServiceRecord $Run $Name -ReadMode BeforeStart
  if($s.CanStart){
   $request=NativeKit $Run 'C:\Windows\System32\sc.exe' @('start',$Name) ('START-'+$Name) 30000
   $code=Get-StopFieldFix3 $request 'ExitCode';Need ((Test-StopUIntFix3 $code) -and $code -eq 0) 'DEV_START_NATIVE_FAILURE_OR_UNKNOWN'
   $issued=$true;break
  }
  if($s.Ready){$expected=$s.Processes;break}
  # An already pending START is observed, never re-issued.
  if($s.State -ceq 'Start Pending'){break}
  Need ($timer.Elapsed.TotalSeconds -lt $timeout) 'DEV_READY_TIMEOUT_NO_RETRY';Start-Sleep -Milliseconds 500
 }while($true)
 do{
  $row=$null;$portReady=DevPortReady $Run $Name $port -Expected $expected -Observation ([ref]$row)
  if($row.Ready -and $null -eq $expected){$expected=$row.Processes}
  if($portReady){
   $worldReady=$true
   if($Name -ceq $d.World){$process=@($row.Processes|Where-Object PID -eq $row.PID)[0];$marker=Get-WorldMarkers (Join-Path $d.Logs 'Server.log') ([DateTimeOffset]::Parse($process.CreatedUtc)).UtcDateTime;Need (!$marker.Failure) 'DEV_WORLD_LOG_FAILURE';$worldReady=$null -ne $marker.ReadyUtc}
   if($worldReady){
    $final=DevServiceRecord $Run $Name -ReadMode StartWait -Expected $expected
    if($final.Ready){$ready=$final;break}
   }
  }
  Need ($timer.Elapsed.TotalSeconds -lt $timeout) 'DEV_READY_TIMEOUT_NO_RETRY';Start-Sleep -Milliseconds 500
 }while($true)
 PutJson (Join-Path $Run.Out ($Name+'-READY.json')) @{Service=$ready;Epoch=$epoch.ToString('o');Result='PASS';StartRequested=$issued;ReadinessReverifiedOnly=!$issued;Port=$port}
}

. 'C:\Scripts\CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225-PAYLOAD\Evidence.Common.ps1'
$script:Out='C:\GRY\wow\diagnostics\CORE-FULL-VERIFY-R3-WOW-SRV-20261110-0140'
$helper=Join-Path $PSScriptRoot 'Wait.Samples.R3.ps1';$results=@()
$cases=@(
 @{Name='older-new-duplicate-second';Expected='PASS';Actions=@('old','new2','new2','new6');InitialClock=0},
 @{Name='no-new-samples-fixed-180s';Expected='COLLECTOR_SAMPLES_TIMEOUT';Actions=@('old');InitialClock=0},
 @{Name='wrong-release';Expected='COLLECTOR_RELEASE_MISMATCH';Actions=@('wrongRelease');InitialClock=0},
 @{Name='wrong-sha';Expected='COLLECTOR_RELEASE_MISMATCH';Actions=@('wrongSHA');InitialClock=0},
 @{Name='wrong-pid';Expected='COLLECTOR_GENERATION_CHANGED';Actions=@('wrongPID');InitialClock=0},
 @{Name='wrong-created';Expected='COLLECTOR_GENERATION_CHANGED';Actions=@('wrongCreated');InitialClock=0},
 @{Name='live-generation-change';Expected='COLLECTOR_GENERATION_CHANGED_DURING_WAIT';Actions=@('old','liveChanged');InitialClock=0},
 @{Name='invalid-time';Expected='COLLECTOR_TIME_INVALID_FORMAT';Actions=@('invalidTime');InitialClock=0},
 @{Name='invalid-calendar';Expected='COLLECTOR_TIME_INVALID_VALUE';Actions=@('invalidCalendar');InitialClock=0},
 @{Name='unknown-reader-exception';Expected='UNEXPECTED_READER_FAILURE';Actions=@('unknown');InitialClock=0},
 @{Name='release-exception-not-masked';Expected='RELEASE_STALE';Actions=@('releaseError');InitialClock=0},
 @{Name='future-time';Expected='COLLECTOR_TIME_INVALID_FUTURE';Actions=@('future');InitialClock=0},
 @{Name='unhealthy-section';Expected='COLLECTOR_SECTION_UNHEALTHY';Actions=@('unhealthy');InitialClock=0},
 @{Name='age-over-30';Expected='COLLECTOR_SAMPLE_TOO_OLD';Actions=@('new2');InitialClock=40},
 @{Name='recognized-collision-then-two';Expected='PASS';Actions=@('collision','new2','new4');InitialClock=0},
 @{Name='slow-read-does-not-reset-budget';Expected='COLLECTOR_SAMPLES_TIMEOUT';Actions=@('slowRead');InitialClock=0},
 @{Name='offset-normalized-duplicate';Expected='PASS';Actions=@('old','new2','sameOffset','new6');InitialClock=0}
)
foreach($case in $cases){
 $dir=Join-Path $Out ('tests\'+$case.Name);[void][IO.Directory]::CreateDirectory($dir)
 $module=New-Module -ArgumentList $helper,$case,$dir -ScriptBlock {param($Helper,$Case,$Dir)
  Set-StrictMode -Version Latest;$ErrorActionPreference='Stop';. $Helper
  $script:Base=[DateTimeOffset]::Parse('2026-11-10T00:00:00Z');$script:Clock=[double]$Case.InitialClock;$script:Index=0;$script:LivePID=4242
  function Need([bool]$Value,[string]$Message){if(!$Value){throw $Message}}
  function PutJson([string]$Path,$Value){[IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Value -Depth 15),[Text.UTF8Encoding]::new($true))}
  # Instrument only individual reader, clock/sleep and SCM/CIM boundaries. Real WaitKitSamples,
  # time parsing, identity/health checks, duplicate set, budget and evidence writer execute unchanged.
  function Get-KitUtcNowR3 {$script:Base.AddSeconds($script:Clock+1)}
  function Get-KitElapsedR3($Timer){$script:Clock}
  function Wait-KitPollR3 {$script:Clock+=2}
  function Get-CimInstance {param($ClassName,$Filter,$ErrorAction)
   if($ClassName -ceq 'Win32_Service'){return [pscustomobject]@{State='Running';ProcessId=$script:LivePID}}
   if($ClassName -ceq 'Win32_Process'){return [pscustomobject]@{ProcessId=$script:LivePID;CreationDate=$script:Base.AddMinutes(-1).UtcDateTime;ExecutablePath='C:\GRY\wow\serwer-dev\mangosd.exe'}}
   throw 'UNEXPECTED_CIM_BOUNDARY'
  }
  function ReadCollector {
   $i=[Math]::Min($script:Index,$Case.Actions.Count-1);$action=$Case.Actions[$i];$script:Index++
   if($action -ceq 'unknown'){throw 'UNEXPECTED_READER_FAILURE'}
   if($action -ceq 'releaseError'){throw 'RELEASE_STALE'}
   if($action -ceq 'collision'){throw 'COLLECTOR_READ_TRANSIENT_TIMEOUT code=WIN32_32 elapsedMs=2000'}
   if($action -ceq 'slowRead'){$script:Clock+=181}
   if($action -ceq 'liveChanged'){$script:LivePID=4243}
   $seconds=0;if($action -ceq 'old'){$seconds=-1}elseif($action -match '^new(\d+)$'){$seconds=[int]$matches[1]}elseif($action -ceq 'future'){$seconds=20}else{$seconds=0}
   $time=$script:Base.AddSeconds($seconds).ToString('o');if($action -ceq 'sameOffset'){$time=$script:Base.AddSeconds(2).ToOffset([TimeSpan]::FromHours(1)).ToString('o')}
   if($action -ceq 'invalidTime'){$time='bad-time'};if($action -ceq 'invalidCalendar'){$time='2026-02-31T00:00:00Z'}
   $pidValue=$script:LivePID;if($action -ceq 'wrongPID'){$pidValue=9000}
   $created=$script:Base.AddMinutes(-1);if($action -ceq 'wrongCreated'){$created=$created.AddTicks(10)}
   $id='release';$sha='SHA';$health='ok';if($action -ceq 'wrongRelease'){$id='other'};if($action -ceq 'wrongSHA'){$sha='OTHER'};if($action -ceq 'unhealthy'){$health='error'}
   [pscustomobject]@{ReleaseState=@{phase='stable';active=@{id=$id;sha256=$sha}};Sample=@{collectedAtUtc=$time;world=@{processId=$pidValue;createdUtc=$created.ToString('o')};server=@{status=$health};legacyBots=@{status='ok'};aiBots=@{status='ok'}}}
  }
  $run=[pscustomobject]@{Out=$Dir;Plan=@{Runtime='C:\GRY\wow\serwer-dev'};Receipt=[ordered]@{StartedUtc=$script:Base.ToString('o')};State=@{}}
  $actual='PASS';try{WaitKitSamples $run @{id='release';sha256='SHA'}}catch{$actual=$_.Exception.Message}
  $events=@(Get-Content (Join-Path $Dir 'SAMPLE-WAIT-R3.jsonl')|ForEach-Object {$_|ConvertFrom-Json})
  $ok=if($Case.Expected -ceq 'PASS'){$actual -ceq 'PASS' -and $run.State.FreshSamples -eq 2}else{$actual -match [regex]::Escape($Case.Expected)}
  if($Case.Name -ceq 'older-new-duplicate-second' -or $Case.Name -ceq 'offset-normalized-duplicate'){$ok=$ok -and @($events|Where-Object Reason -ceq 'BEFORE_WAIT_BOUNDARY').Count -eq 1 -and @($events|Where-Object Reason -ceq 'DUPLICATE_COLLECTED_TIME').Count -eq 1 -and @($events|Where-Object Decision -ceq 'ACCEPT').Count -eq 2}
  if($Case.Expected -ceq 'COLLECTOR_SAMPLES_TIMEOUT'){$ok=$ok -and $script:Clock -ge 180 -and @($events|Where-Object Decision -ceq 'ACCEPT').Count -eq 0}
  $boundaries=@($events.WaitBoundaryUtc|Sort-Object -Unique);$ok=$ok -and $boundaries.Count -eq 1
  $script:TestResult=[pscustomobject]@{Name=$Case.Name;Expected=$Case.Expected;Actual=$actual;Pass=$ok;ReaderCalls=$script:Index;VirtualElapsedSeconds=$script:Clock;FixedBoundaryCount=$boundaries.Count;FunctionFile=(Get-Command WaitKitSamples).ScriptBlock.File;Instrumentation='Individual ReadCollector, CIM, clock/elapsed/sleep boundaries; real wait/parse/identity/health/dedup/budget/evidence code';Evidence=$Dir}
 }
 try{$results+=@(& $module {$script:TestResult})}finally{Remove-Module $module -Force}
}
SaveJson 'WAIT-TESTS-R3.json' @{PS=$PSVersionTable.PSVersion.ToString();Result=$(if(@($results|Where-Object Pass -ne $true).Count){'FAIL'}else{'PASS'});HelperSHA256=(Hash $helper);BoundaryInstrumentation='Only individual ReadCollector, CIM, clock/elapsed/sleep; no whole tested function replaced';Tests=$results}
$results|ForEach-Object {Write-Host ($_.Name+'='+$_.Pass+'; actual='+$_.Actual)}
Need (@($results|Where-Object Pass -ne $true).Count -eq 0) 'WAIT_TEST_FAILURE'

. 'C:\Scripts\CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225-PAYLOAD\Kit.Common.ps1'
$out='C:\GRY\wow\diagnostics\PERFORMANCE-WORKFLOW-R1-WOW-SRV-20261109-2313';$window=GetJson (Join-Path $out 'SUMMARY.json')
$from=[DateTimeOffset]::Parse($window.StartedUtc).ToUniversalTime();$to=[DateTimeOffset]::Parse($window.EndedUtc).ToUniversalTime();$path='C:\GRY\wow\serwer-dev\logs\Perf.log'
$f=[IO.File]::Open($path,'Open','Read',([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete));$size=$f.Length;$offset=[Math]::Max(0,$size-16MB);[void]$f.Seek($offset,[IO.SeekOrigin]::Begin);$reader=[IO.StreamReader]::new($f,[Text.Encoding]::UTF8,$true,65536)
$rows=[Collections.Generic.List[object]]::new();$earliest=$null;$latest=$null;$lines=0
try{
 if($offset -gt 0){[void]$reader.ReadLine()}
 while(!$reader.EndOfStream){$line=$reader.ReadLine();$lines++;$m=[regex]::Match($line,'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (.*)$');if(!$m.Success){continue}
  $utc=[DateTime]::ParseExact($m.Groups[1].Value,'yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeLocal).ToUniversalTime();if($null -eq $earliest){$earliest=$utc};$latest=$utc
  if($utc -lt $from.UtcDateTime.AddSeconds(-1) -or $utc -gt $to.UtcDateTime){continue}
  $body=$m.Groups[2].Value;$type=$null;$ms=$null;$map=$null;$instance=$null
  if($body -match '^Slow world update:\s*(\d+)ms'){$type='WorldTickDeltaSlow';$ms=[long]$Matches[1]}
  elseif($body -match '^Update map system:\s*(\d+)ms \[(\d+)ms for async\]'){$type='MapSystemSlow';$ms=[long]$Matches[1];$rows.Add([pscustomobject]@{AtUtc=$utc.ToString('o');Kind='MapSystemAsyncWaitSlow';Map=$null;Instance=$null;Milliseconds=[long]$Matches[2]})}
  elseif($body -match '^Update single map\s+(\d+) inst\s+(\d+):\s*(\d+)ms'){$type='SingleMapSlow';$map=[long]$Matches[1];$instance=[long]$Matches[2];$ms=[long]$Matches[3]
   foreach($part in [regex]::Matches($body,'(sess|players|cells|sendObjUpdates|relocations|players2)\s+(\d+)ms')){$rows.Add([pscustomobject]@{AtUtc=$utc.ToString('o');Kind=('MapPhase.'+$part.Groups[1].Value);Map=$map;Instance=$instance;Milliseconds=[long]$part.Groups[2].Value})}
  }elseif($body -match '^Update async queries:\s*(\d+)ms'){$type='AsyncQueryResultsSlow';$ms=[long]$Matches[1]}
  if($null -ne $type){$rows.Add([pscustomobject]@{AtUtc=$utc.ToString('o');Kind=$type;Map=$map;Instance=$instance;Milliseconds=$ms})}
 }
}finally{$reader.Dispose();$f.Dispose()}
function Stats($Values){$a=@($Values|Sort-Object);if(!$a.Count){return @{N=0;Status='UNMEASURED'}};$p=@{N=$a.Count;Status='MEASURED_THRESHOLD_FILTERED'};foreach($q in @(50,95,99)){$p['p'+$q]=$a[[Math]::Max(0,[int][Math]::Ceiling($a.Count*$q/100.0)-1)]};return $p}
$groups=@(foreach($g in $rows|Group-Object Kind,Map,Instance){@{Group=$g.Name;Stats=(Stats @($g.Group.Milliseconds))}})
$coverage=($offset -eq 0 -or ($null -ne $earliest -and $earliest -le $from.UtcDateTime))
$rows|Export-Csv (Join-Path $out 'EXISTING-PERF-NUMERIC.csv') -NoTypeInformation -Encoding UTF8
PutJson (Join-Path $out 'INSTRUMENTATION-SUMMARY.json') @{Result='READ_ONLY';Source=$path;BytesReadMaximum=16MB;FileBytes=$size;TailOffset=$offset;LinesScanned=$lines;WindowStartedUtc=$from.ToString('o');WindowEndedUtc=$to.ToString('o');EarliestTailUtc=$(if($earliest){$earliest.ToString('o')}else{$null});LatestTailUtc=$(if($latest){$latest.ToString('o')}else{$null});FullWindowCoveredByTail=$coverage;Groups=$groups;SampleDefinition='Existing threshold-filtered slow events only; percentiles do NOT describe all world/map ticks. World field is inter-tick diff, not exclusive CPU execution time.';WorldAllTicks='UNMEASURED';SQLQueueDepth='UNMEASURED_PRIVATE_IN_MEMORY_NO_EXPORT';ProductionInstrumentationChanges='NONE';RawLogOrPlayerDataExported=$false}
Write-Host ('PERF_LOG_NUMERIC_EVENTS='+$rows.Count+'; full_window='+$coverage)

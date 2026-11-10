function Get-KitUtcNowR3 { [DateTimeOffset]::UtcNow }
function Get-KitElapsedR3($Timer) { $Timer.Elapsed.TotalSeconds }
function Wait-KitPollR3 { Start-Sleep -Milliseconds 2000 }
function Parse-KitSampleTimeR3([string]$Text){
 Need ($Text -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') 'COLLECTOR_TIME_INVALID_FORMAT'
 $time=[DateTimeOffset]::MinValue
 Need ([DateTimeOffset]::TryParse($Text,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$time)) 'COLLECTOR_TIME_INVALID_VALUE'
 $time.ToUniversalTime()
}
function Read-KitLiveWorldR3($Run){
 $s=Get-CimInstance Win32_Service -Filter "Name='mangosd'" -ErrorAction Stop
 Need ($null -ne $s -and $s.State -ceq 'Running' -and $null -ne $s.ProcessId -and $s.ProcessId -isnot [bool] -and $s.ProcessId -gt 0) 'COLLECTOR_LIVE_SERVICE_INVALID'
 $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$s.ProcessId) -ErrorAction Stop
 Need ($null -ne $p -and $null -ne $p.CreationDate -and $p.ProcessId -eq $s.ProcessId -and $p.ExecutablePath -ceq (Join-Path $Run.Plan.Runtime 'mangosd.exe')) 'COLLECTOR_LIVE_PROCESS_INVALID'
 [pscustomobject]@{PID=[long]$p.ProcessId;CreatedTicks=$p.CreationDate.ToUniversalTime().Ticks;Path=[string]$p.ExecutablePath}
}
function Write-KitSampleEventR3($Run,$Boundary,$Timer,[string]$Decision,[string]$Reason,$Collected,$Age,[string]$ExceptionType){
 $event=[ordered]@{ObservedUtc=(Get-KitUtcNowR3).ToString('o');Decision=$Decision;Reason=$Reason;CollectedAtUtc=$Collected;WaitBoundaryUtc=$Boundary.ToString('o');AgeSeconds=$Age;ElapsedSeconds=(Get-KitElapsedR3 $Timer);BudgetSeconds=180;ExceptionType=$ExceptionType}
 [IO.File]::AppendAllText((Join-Path $Run.Out 'SAMPLE-WAIT-R3.jsonl'),((ConvertTo-Json -InputObject $event -Depth 5 -Compress)+"`r`n"),[Text.UTF8Encoding]::new($false))
}
function WaitKitSamples($Run,$Reference){
 # One caller-established boundary and one monotonic budget, never reset per read or rejection.
 $boundary=Parse-KitSampleTimeR3 $Run.Receipt.StartedUtc
 $timer=[Diagnostics.Stopwatch]::StartNew();$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 $collectedText=$null;$age=$null
 Write-KitSampleEventR3 $Run $boundary $timer 'BEGIN' 'FIXED_WAIT_BOUNDARY' $null $null $null
 try{
  $liveAnchor=Read-KitLiveWorldR3 $Run
  while($true){
   Need ((Get-KitElapsedR3 $timer) -lt 180) 'COLLECTOR_SAMPLES_TIMEOUT'
   $collectedText=$null;$age=$null
   try{$read=ReadCollector}catch{
    # Only the already classified coherent-publication collision is waitable.
    # Release/health/integrity/generation failures and unknown exceptions are fatal.
    if($_.Exception.Message -notmatch '^COLLECTOR_READ_TRANSIENT_TIMEOUT\b'){throw}
    Write-KitSampleEventR3 $Run $boundary $timer 'REJECT' 'RECOGNIZED_PUBLICATION_COLLISION' $null $null $_.Exception.GetType().FullName
    Need ((Get-KitElapsedR3 $timer) -lt 180) 'COLLECTOR_SAMPLES_TIMEOUT';Wait-KitPollR3;continue
   }
   Need ((Get-KitElapsedR3 $timer) -lt 180) 'COLLECTOR_SAMPLES_TIMEOUT'
   $collectedText=[string]$read.Sample.collectedAtUtc
   $now=Get-KitUtcNowR3;$collected=Parse-KitSampleTimeR3 $collectedText;$age=($now-$collected).TotalSeconds
   Need ($read.ReleaseState.phase -ceq 'stable' -and $read.ReleaseState.active.id -ceq $Reference.id -and $read.ReleaseState.active.sha256 -ceq $Reference.sha256) 'COLLECTOR_RELEASE_MISMATCH'
   Need ($read.Sample.server.status -ceq 'ok' -and $read.Sample.legacyBots.status -ceq 'ok' -and $read.Sample.aiBots.status -ceq 'ok') 'COLLECTOR_SECTION_UNHEALTHY'
   $live=Read-KitLiveWorldR3 $Run
   Need ($live.PID -eq $liveAnchor.PID -and $live.CreatedTicks -eq $liveAnchor.CreatedTicks -and $live.Path -ceq $liveAnchor.Path) 'COLLECTOR_GENERATION_CHANGED_DURING_WAIT'
   $created=Parse-KitSampleTimeR3 ([string]$read.Sample.world.createdUtc)
   Need ($read.Sample.world.processId -isnot [bool] -and $null -ne $read.Sample.world.processId -and $read.Sample.world.processId -eq $live.PID -and $created.UtcTicks -eq $live.CreatedTicks) 'COLLECTOR_GENERATION_CHANGED'
   Need ($age -ge 0) 'COLLECTOR_TIME_INVALID_FUTURE'
   if($collected.UtcTicks -lt $boundary.UtcTicks){
    Write-KitSampleEventR3 $Run $boundary $timer 'REJECT' 'BEFORE_WAIT_BOUNDARY' $collectedText $age $null
   }else{
    Need ($age -le 30) 'COLLECTOR_SAMPLE_TOO_OLD'
    $key=$collected.UtcTicks.ToString([Globalization.CultureInfo]::InvariantCulture)
    if($seen.Add($key)){
     PutJson (Join-Path $Run.Out ('COLLECTOR-SAMPLE-'+$seen.Count+'.json')) $read
     Write-KitSampleEventR3 $Run $boundary $timer 'ACCEPT' 'NEW_FRESH_HEALTHY_SAMPLE' $collectedText $age $null
    }else{Write-KitSampleEventR3 $Run $boundary $timer 'REJECT' 'DUPLICATE_COLLECTED_TIME' $collectedText $age $null}
   }
   Need ((Get-KitElapsedR3 $timer) -lt 180) 'COLLECTOR_SAMPLES_TIMEOUT'
   if($seen.Count -ge 2){$Run.State.FreshSamples=2;$Run.Receipt.SampleWaitR3=@{BoundaryUtc=$boundary.ToString('o');BudgetSeconds=180;ElapsedSeconds=(Get-KitElapsedR3 $timer);DistinctHealthySamples=2};return}
   Wait-KitPollR3
  }
 }catch{
  $primary=$_
  try{Write-KitSampleEventR3 $Run $boundary $timer 'FAIL' $primary.Exception.Message $collectedText $age $primary.Exception.GetType().FullName}catch{$Run.Receipt.SampleWaitEvidenceError=$_.Exception.ToString()}
  throw $primary
 }finally{$timer.Stop()}
}

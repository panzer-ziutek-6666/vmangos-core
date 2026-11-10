[CmdletBinding()]
param([ValidateRange(300,300)][int]$DurationSeconds=300,[ValidateRange(2,10)][int]$IntervalSeconds=5,[string]$OutputRoot='C:\GRY\wow\diagnostics\PERFORMANCE-WORKFLOW-R1-WOW-SRV-20261109-2313')
. 'C:\Scripts\CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225-PAYLOAD\FullProduction.ps1'
Guard;AssertKitPins
Need (!(Test-Path $OutputRoot)) 'NEW_EVIDENCE_DIRECTORY_REQUIRED'
NewPrivate $OutputRoot;$script:Out=$OutputRoot
$run=NewKitRun 'ReadOnlyPerformance' 'Plan';LoadProduction $run
$status=Get-CurrentStatus;Need $status.Ready 'STACK_NOT_READY';Assert-FullDEVStopped
AssertBaseline $run
$baseline=Snapshot;$m=Get-CimInstance Win32_Service -Filter "Name='mangosd'";$world=[Diagnostics.Process]::GetProcessById([int]$m.ProcessId)
$generation=[pscustomobject]@{PID=$world.Id;ApiCreatedTicks=$world.StartTime.ToUniversalTime().Ticks;CreatedUtc=$world.StartTime.ToUniversalTime().ToString('o');Path=$world.MainModule.FileName}
Need ($generation.Path -ceq 'C:\GRY\wow\serwer-dev\mangosd.exe') 'WORLD_IMAGE'
$logical=[Environment]::ProcessorCount
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PerfThreadR1 {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenThread(uint access,bool inherit,uint id);
 [DllImport("kernel32.dll")] static extern int GetThreadDescription(IntPtr h,out IntPtr text);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static string Name(uint id){IntPtr h=OpenThread(0x0800,false,id);if(h==IntPtr.Zero)return null;
  try{IntPtr p; if(GetThreadDescription(h,out p)!=0)return null;try{return Marshal.PtrToStringUni(p);}finally{LocalFree(p);}}finally{CloseHandle(h);}}
}
'@
function Percentiles($Values){$a=@($Values|Where-Object {$null -ne $_}|Sort-Object);if(!$a.Count){return @{N=0;Status='UNMEASURED';p50=$null;p95=$null;p99=$null}};$v=@{N=$a.Count;Status='MEASURED'};foreach($q in @(50,95,99)){$ix=[Math]::Max(0,[int][Math]::Ceiling($a.Count*$q/100.0)-1);$v['p'+$q]=[double]$a[$ix]};return $v}
function AssertControlTasksUnchanged($Run,$Before){$now=@(ReadControlTasksR2 $Run);foreach($b in $Before){$a=@($now|Where-Object Name -ceq $b.Name);Need ($a.Count -eq 1 -and $a[0].Enabled -ceq $b.Enabled -and $a[0].State -ceq $b.State) 'TASK_STATE_CHANGED'}}
function ThreadSnapshot($Process){
 $rows=@();foreach($t in $Process.Threads){try{$start=$t.StartTime.ToUniversalTime().Ticks;$key=[string]$t.Id+'|'+$start;if(!$script:Names.ContainsKey($key)){$script:Names[$key]=[PerfThreadR1]::Name([uint32]$t.Id)};$rows+=@([pscustomobject]@{TID=$t.Id;StartTicks=$start;CPUms=$t.TotalProcessorTime.TotalMilliseconds;Name=$script:Names[$key]})}catch{$script:ThreadReadFailures++}}
 return $rows
}
$counterPaths=@('\Processor(*)\% Processor Time','\Memory\Available MBytes','\Memory\Committed Bytes','\Memory\% Committed Bytes In Use','\Memory\Pages/sec','\Memory\Page Reads/sec','\Memory\Page Writes/sec','\PhysicalDisk(*)\% Disk Time','\PhysicalDisk(*)\Current Disk Queue Length','\PhysicalDisk(*)\Avg. Disk sec/Read','\PhysicalDisk(*)\Avg. Disk sec/Write','\PhysicalDisk(*)\Disk Bytes/sec')
$script:Names=@{};$script:ThreadReadFailures=0;$threadPrev=@{};$procPrev=@{};$previousSeconds=0.0
foreach($t in @(ThreadSnapshot $world)){$threadPrev[[string]$t.TID+'|'+$t.StartTicks]=$t.CPUms}
$world.Dispose()
$allCounters=[Collections.Generic.List[object]]::new();$allProcess=[Collections.Generic.List[object]]::new();$allThreads=[Collections.Generic.List[object]]::new();$telemetry=[Collections.Generic.List[object]]::new();$errors=[Collections.Generic.List[object]]::new()
$beforePins=@(foreach($p in $run.Plan.FixedInputs){@{Path=$p.Path;SHA256=(Hash $p.Path)}})
$regBefore=Get-ReleaseRegistryState $run.State.Release;$taskBefore=@(ReadControlTasksR2 $run)
$logPath='C:\GRY\wow\serwer-dev\logs\Server.log';$startLogBytes=(Get-Item $logPath).Length
PutJson (Join-Path $Out 'PREFLIGHT.json') @{Host=$env:COMPUTERNAME;Account=[Security.Principal.WindowsIdentity]::GetCurrent().Name;PS=$PSVersionTable.PSVersion.ToString();DesktopX64=$true;CWD=(Get-Location).Path;Runtime=$baseline;Status=$status;Generation=$generation;LogicalProcessors=$logical;Registry=$regBefore;Tasks=$taskBefore;Pins=$beforePins;Mode='READ_ONLY';ScriptSHA256=(Hash $PSCommandPath)}
$started=[DateTimeOffset]::UtcNow;$timer=[Diagnostics.Stopwatch]::StartNew();$next=0.0;$tick=0;$okay=$false
Start-Transcript -LiteralPath (Join-Path $Out 'MEASUREMENT.log') -NoClobber
try{
 while($timer.Elapsed.TotalSeconds -lt $DurationSeconds){
  if($timer.Elapsed.TotalSeconds -lt $next){Start-Sleep -Milliseconds ([int](1000*($next-$timer.Elapsed.TotalSeconds)))}
  $counterErrors=@();$batch=Get-Counter -Counter $counterPaths -MaxSamples 1 -ErrorAction SilentlyContinue -ErrorVariable counterErrors
  $time=[DateTimeOffset]::UtcNow;$seconds=$timer.Elapsed.TotalSeconds;$elapsed=$seconds-$previousSeconds
  foreach($e in $counterErrors){$errors.Add(@{AtUtc=$time.ToString('o');Kind='COUNTER';Error=$e.Exception.Message})}
  if($batch){foreach($c in $batch.CounterSamples){if($c.Status -eq 0 -and ![double]::IsNaN($c.CookedValue) -and ![double]::IsInfinity($c.CookedValue)){$allCounters.Add([pscustomobject]@{AtUtc=$time.ToString('o');ElapsedSeconds=$seconds;Path=$c.Path;Value=[double]$c.CookedValue})}else{$errors.Add(@{AtUtc=$time.ToString('o');Kind='COUNTER_INVALID';Path=$c.Path;Status=$c.Status})}}}
  $p=[Diagnostics.Process]::GetProcessById($generation.PID)
  try{Need ($p.StartTime.ToUniversalTime().Ticks -eq $generation.ApiCreatedTicks -and $p.MainModule.FileName -ceq $generation.Path -and !$p.HasExited) 'WORLD_GENERATION_CHANGED';$current=@(ThreadSnapshot $p)}finally{$p.Dispose()}
  $threadNext=@{};foreach($t in $current){$key=[string]$t.TID+'|'+$t.StartTicks;$threadNext[$key]=$t.CPUms;if($threadPrev.ContainsKey($key)){$delta=$t.CPUms-$threadPrev[$key];Need ($delta -ge 0) 'THREAD_CPU_BACKWARDS';$allThreads.Add([pscustomobject]@{AtUtc=$time.ToString('o');ElapsedSeconds=$seconds;IntervalSeconds=$elapsed;TID=$t.TID;StartTicks=$t.StartTicks;Description=$t.Name;DeltaCPUms=$delta;CorePercent=100*$delta/($elapsed*1000)})}}
  $threadPrev=$threadNext
  foreach($name in @('mangosd','realmd','mysqld')){foreach($p in Get-Process -Name $name -ErrorAction SilentlyContinue){try{$key=[string]$p.Id+'|'+$p.StartTime.ToUniversalTime().Ticks;$cpu=$p.TotalProcessorTime.TotalMilliseconds;$delta=$null;if($procPrev.ContainsKey($key)){$delta=$cpu-$procPrev[$key]};$procPrev[$key]=$cpu;$allProcess.Add([pscustomobject]@{AtUtc=$time.ToString('o');ElapsedSeconds=$seconds;PID=$p.Id;Name=$p.ProcessName;Generation=$key;DeltaCPUms=$delta;CorePercent=$(if($null -ne $delta){100*$delta/($elapsed*1000)}else{$null});HostPercent=$(if($null -ne $delta){100*$delta/($elapsed*1000*$logical)}else{$null});WorkingSetBytes=$p.WorkingSet64;PrivateBytes=$p.PrivateMemorySize64;Threads=$p.Threads.Count;Handles=$p.HandleCount;AffinityHex=('0x{0:X}' -f $p.ProcessorAffinity.ToInt64())})}finally{$p.Dispose()}}}
  if($tick%2 -eq 0){try{$pair=Read-CollectorPairR2 $run.State.Release -TimeoutMilliseconds 500;$s=$pair.Sample;$age=($time-[DateTimeOffset]::Parse($s.collectedAtUtc)).TotalSeconds;Need ($pair.State.phase -ceq 'stable' -and $pair.State.active.sha256 -ceq $regBefore.active.sha256 -and $s.world.processId -eq $generation.PID -and $age -ge -2 -and $age -le 30) 'TELEMETRY_NOT_CURRENT';$telemetry.Add([pscustomobject]@{AtUtc=$time.ToString('o');CollectedAtUtc=$s.collectedAtUtc;AgeSeconds=$age;ActiveSessions=$s.server.data.activeSessions;LegacyOnlineBots=$s.legacyBots.data.online;AIRandomCandidates=$s.aiBots.data.onlineRandomAiCandidates;OtherOnlineCharacters=$s.aiBots.data.onlineOtherCharacters;ServerStatus=$s.server.status;LegacyStatus=$s.legacyBots.status;AIStatus=$s.aiBots.status})}catch{$errors.Add(@{AtUtc=$time.ToString('o');Kind='TELEMETRY';Error=$_.Exception.Message})}}
  $tick++;$previousSeconds=$seconds;$next+=$IntervalSeconds
 }
 $ended=[DateTimeOffset]::UtcNow;$duration=$timer.Elapsed.TotalSeconds
 $summary=[ordered]@{Result='PASS';StartedUtc=$started.ToString('o');EndedUtc=$ended.ToString('o');DurationSeconds=$duration;SampleTicks=$tick;LogicalProcessors=$logical;Generation=$generation;PercentileMethod='nearest-rank over valid samples; counter warmup/new threads excluded';Counters=@();Processes=@();Threads=@();Telemetry=@();Unmeasured=@{WorldUpdateMilliseconds='UNMEASURED';MapUpdateMilliseconds='UNMEASURED';SQLQueueDepth='UNMEASURED';HumanPlayersExact='UNMEASURED'};ThreadReadFailures=$script:ThreadReadFailures;Errors=$errors.Count}
 foreach($g in $allCounters|Group-Object Path){$summary.Counters+=@(@{Path=$g.Name;Stats=(Percentiles @($g.Group.Value))})}
 foreach($g in $allProcess|Group-Object Generation){$summary.Processes+=@(@{Name=$g.Group[0].Name;PID=$g.Group[0].PID;HostPercent=(Percentiles @($g.Group.HostPercent));CorePercent=(Percentiles @($g.Group.CorePercent));WorkingSetBytes=(Percentiles @($g.Group.WorkingSetBytes));PrivateBytes=(Percentiles @($g.Group.PrivateBytes));Threads=(Percentiles @($g.Group.Threads))})}
 foreach($g in $allThreads|Group-Object TID,StartTicks){$summary.Threads+=@(@{TID=$g.Group[0].TID;StartTicks=$g.Group[0].StartTicks;Description=$g.Group[0].Description;TotalDeltaCPUms=($g.Group|Measure-Object DeltaCPUms -Sum).Sum;CorePercent=(Percentiles @($g.Group.CorePercent))})}
 foreach($name in @('ActiveSessions','LegacyOnlineBots','AIRandomCandidates','OtherOnlineCharacters')){$summary.Telemetry+=@(@{Name=$name;Stats=(Percentiles @($telemetry|ForEach-Object {$_.$name}));Meaning='Existing collector fields; active sessions/other characters are not an exact human count'})}
 Need ($duration -ge 300 -and @($summary.Counters|Where-Object Path -match 'processor\(\d+\)').Count -eq $logical) 'DURATION_OR_LOGICAL_CPU_COVERAGE'
 $allCounters|Export-Csv (Join-Path $Out 'COUNTERS.csv') -NoTypeInformation -Encoding UTF8
 $allProcess|Export-Csv (Join-Path $Out 'PROCESSES.csv') -NoTypeInformation -Encoding UTF8
 $allThreads|Export-Csv (Join-Path $Out 'THREADS.csv') -NoTypeInformation -Encoding UTF8
 $telemetry|Export-Csv (Join-Path $Out 'TELEMETRY.csv') -NoTypeInformation -Encoding UTF8
 PutJson (Join-Path $Out 'READ-ERRORS.json') @($errors)
 foreach($f in $beforePins){Need ((Hash $f.Path) -ceq $f.SHA256) 'PROTECTED_RUNTIME_CHANGED'}
 $after=Snapshot;foreach($b in $baseline.Services){$a=@($after.Services|Where-Object Name -ceq $b.Name)[0];Need ($a.State -ceq $b.State -and $a.PID -eq $b.PID -and ([DateTimeOffset]::Parse($a.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($b.CreatedUtc)).UtcTicks) 'SERVICE_GENERATION_CHANGED'}
 AssertControlTasksUnchanged $run $taskBefore
 $regAfter=Get-ReleaseRegistryState $run.State.Release;Need ($regAfter.phase -ceq 'stable' -and $regAfter.sequence -eq $regBefore.sequence -and $regAfter.active.sha256 -ceq $regBefore.active.sha256) 'RELEASE_CHANGED'
 PutJson (Join-Path $Out 'SUMMARY.json') $summary;PutJson (Join-Path $Out 'AFTER.json') @{Runtime=$after;Registry=$regAfter;ProtectedFiles='UNCHANGED';Tasks='UNCHANGED'}
 $okay=$true
}catch{PutJson (Join-Path $Out 'MEASUREMENT-FAIL.json') @{Error=$_.Exception.ToString();ElapsedSeconds=$timer.Elapsed.TotalSeconds};throw}
finally{Write-Host ('OK='+$okay);Write-Host 'CHANGE_SCOPE=READ_ONLY_PERFORMANCE';Write-Host 'UNCHANGED=Runtime,DB,services,tasks,configurations,collector,R2';Write-Host ('LOG='+$Out+'\MEASUREMENT.log');Write-Host 'NEXT_STEP=Analyze evidence and prepare at most two DEV comparisons; R2 remains independent';Stop-Transcript|Out-Null}

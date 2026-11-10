$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -cne 'WOW-SRV' -or $PSVersionTable.PSEdition -cne 'Desktop' -or ![Environment]::Is64BitProcess){throw 'HOST_PS51'}
$out='C:\GRY\wow\diagnostics\PERFORMANCE-WORKFLOW-R1-WOW-SRV-20261109-2313'
$candidate='C:\Scripts\CORE-CAND-20261109-0210\source';$active='C:\Scripts\S1053-R3-20261104-1921\source'
$items=@('src\game\Maps\Map.cpp','src\game\Maps\MapManager.cpp','src\game\World.cpp','src\mangosd\WorldRunnable.cpp','src\shared\ThreadPool.cpp','src\shared\Database\SqlDelayThread.cpp','src\shared\Database\Database.cpp')
$jobs=@(foreach($n in $items){[pscustomobject]@{Kind='Source';Relative=$n;Candidate=(Join-Path $candidate $n);Active=(Join-Path $active $n)}})+@([pscustomobject]@{Kind='Graph';Root='C:\Scripts\CORE-CAND-20261109-0210\build'})
$body={param($job)
 $ErrorActionPreference='Stop'
 if($job.Kind -ceq 'Graph'){
  foreach($f in Get-ChildItem $job.Root -Filter '*.vcxproj' -Recurse -File){$xml=[xml][IO.File]::ReadAllText($f.FullName);$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('m','http://schemas.microsoft.com/developer/msbuild/2003');[pscustomobject]@{Kind='Project';Name=$f.BaseName;Path=$f.FullName;TranslationUnits=@($xml.SelectNodes('//m:ClCompile[@Include]',$ns)).Count;References=@($xml.SelectNodes('//m:ProjectReference[@Include]',$ns)|ForEach-Object {[IO.Path]::GetFileNameWithoutExtension($_.Include)});MultiProcessorCompilation=@($xml.SelectNodes('//m:MultiProcessorCompilation',$ns)|ForEach-Object {$_.InnerText});CL_MPCount=@($xml.SelectNodes('//m:CL_MPCount',$ns)|ForEach-Object {$_.InnerText});PrecompiledHeaders=@($xml.SelectNodes('//m:PrecompiledHeader',$ns)|ForEach-Object {$_.InnerText}|Sort-Object -Unique)}}
 }else{
  $text=[IO.File]::ReadAllText($job.Candidate);$lines=$text -split "`r?`n";$hits=@();for($i=0;$i -lt $lines.Count;$i++){if($lines[$i] -match 'CONFIG_UINT32_(MAP_OBJECTSUPDATE|MAP_VISIBILITYUPDATE|MAPUPDATE_INSTANCED|MTCELLS|CONTINENTS_MOTION|ASYNC_TASKS)|m_(motion|visibility|cell|object|continent|instanceCreation)?[Tt]hreads|processWorkload|perfmon|[Pp]erformance[Mm]onitor|SQL.*[Qq]ueue|[Qq]ueue.*[Ss]ize|sWorld.Update\(diff\)|updateTime'){for($j=[Math]::Max(0,$i-2);$j -le [Math]::Min($lines.Count-1,$i+4);$j++){$hits+=@([pscustomobject]@{Line=$j+1;Text=$lines[$j]})}}}
  $oldHash=$null;if(Test-Path $job.Active){$oldHash=(Get-FileHash $job.Active).Hash};$newHash=(Get-FileHash $job.Candidate).Hash
  [pscustomobject]@{Kind='Source';Relative=$job.Relative;Candidate=$job.Candidate;Active=$job.Active;ActiveSHA256=$oldHash;CandidateSHA256=$newHash;Unchanged=($oldHash -ceq $newHash);LineCount=$lines.Count;Excerpts=@($hits|Sort-Object Line -Unique)}
 }
}
$pool=[RunspaceFactory]::CreateRunspacePool(1,3);$pool.Open();$pending=@();$watch=[Diagnostics.Stopwatch]::StartNew()
try{
 foreach($j in $jobs){$p=[PowerShell]::Create();$p.RunspacePool=$pool;[void]$p.AddScript($body.ToString()).AddArgument($j);$pending+=@(@{PS=$p;Async=$p.BeginInvoke()})}
 $result=@(foreach($p in $pending){try{$v=$p.PS.EndInvoke($p.Async);if($p.PS.HadErrors){throw ($p.PS.Streams.Error|Out-String)};$v}finally{$p.PS.Dispose()}})
 [IO.File]::WriteAllText((Join-Path $out 'BOUNDED-SOURCE-ANALYSIS.json'),(ConvertTo-Json -InputObject @{MaxReadTasks=3;DurationSeconds=$watch.Elapsed.TotalSeconds;Items=$result;MutatingCommands='NONE';Runtime='READ_ONLY'} -Depth 12),[Text.UTF8Encoding]::new($true))
 Write-Host ('BOUNDED_READS=PASS; items='+$result.Count+'; max=3; seconds='+$watch.Elapsed.TotalSeconds)
}finally{$pool.Close();$pool.Dispose()}

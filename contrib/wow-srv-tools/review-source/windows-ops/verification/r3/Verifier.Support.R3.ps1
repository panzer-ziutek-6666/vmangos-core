function Assert-StaticEvidencePoolR3($Run){
 $root='C:\Scripts\CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225-PAYLOAD'
 $base='C:\GRY\wow\diagnostics\CORE-FULL-PRODUCTION-R2-EXECUTE-R1-WOW-SRV-20261109-2345'
 $p=GetJson (Join-Path $base 'OPERATION-POINTERS.json');$old=GetJson (Join-Path $base 'VERIFIER-POINTERS.json')
 $jobs=@(@{Path=(Join-Path $root 'KIT-PLAN.json');Expected='FD1C405883A520F03EB10FAB8A822D2791E2689CDCD9A1A3A3B9E869C2759AF2'},@{Path=(Join-Path $root 'EXECUTION-PINS.tsv');Expected='67961407812B30A5017766CB2F22A87F46A1B0DA9F3A3524E327740C24B23F3C'},@{Path=$p.Receipt;Expected='7319312BECC2CD707CF67747932AEEE4D5A366800E2A5C497AF3D993EF92EAD2'},@{Path=$p.ProcessRecord;Expected=$p.ProcessRecordSHA256},@{Path=$old.ResultPath;Expected=$old.ResultSHA256})
 foreach($f in Import-Csv (Join-Path $root 'EXECUTION-PINS.tsv') -Delimiter "`t"){$jobs+=@(@{Path=(Join-Path $root $f.Path);Expected=$f.SHA256})}
 foreach($f in Import-Csv (Join-Path $PSScriptRoot 'R3-CODE-PINS.tsv') -Delimiter "`t"){$jobs+=@(@{Path=(Join-Path $PSScriptRoot $f.Path);Expected=$f.SHA256})}
 # Reuse the established PS5.1 pool pattern: immutable path/hash jobs only, no shared Run or receipt.
 $pool=[RunspaceFactory]::CreateRunspacePool(1,3);$pending=@();$rows=@();$watch=[Diagnostics.Stopwatch]::StartNew();$pool.Open()
 try{
  foreach($job in $jobs){$ps=[PowerShell]::Create();$ps.RunspacePool=$pool;[void]$ps.AddScript({param([string]$Path,[string]$Expected)
   $ErrorActionPreference='Stop'
   try{$h=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash;[pscustomobject]@{Path=$Path;ExpectedSHA256=$Expected;ActualSHA256=$h;Result=$(if($h -ceq $Expected){'PASS'}else{'FAIL_HASH'});Error=$null}}
   catch{[pscustomobject]@{Path=$Path;ExpectedSHA256=$Expected;ActualSHA256=$null;Result='ERROR';Error=$_.Exception.ToString()}}
  }.ToString()).AddArgument([string]$job.Path).AddArgument([string]$job.Expected);$pending+=@(@{PS=$ps;Async=$ps.BeginInvoke();Path=$job.Path})}
  foreach($item in $pending){try{$result=@($item.PS.EndInvoke($item.Async));$rows+=@($result);foreach($errorRecord in $item.PS.Streams.Error){$rows+=@([pscustomobject]@{Path=$item.Path;Result='WORKER_ERROR';Error=$errorRecord.ToString()})};if($result.Count -ne 1){$rows+=@([pscustomobject]@{Path=$item.Path;Result='INVALID_WORKER_OUTPUT';Error='Expected one scalar result'})}}catch{$rows+=@([pscustomobject]@{Path=$item.Path;Result='ENDINVOKE_ERROR';Error=$_.Exception.ToString()})}finally{$item.PS.Dispose()}}
 }finally{$pool.Close();$pool.Dispose()}
 PutJson (Join-Path $Run.Out 'STATIC-EVIDENCE-POOL.json') @{MaxReadTasks=3;Jobs=$jobs.Count;Seconds=$watch.Elapsed.TotalSeconds;Items=$rows;Isolation='Only independent immutable path/hash arguments; no shared mutable context or receipt'}
 Need ($rows.Count -eq $jobs.Count -and @($rows|Where-Object Result -cne 'PASS').Count -eq 0) 'STATIC_EVIDENCE_HASH_OR_READ_FAILURE'
}
function Assert-ExactR3Inputs([string]$Receipt,[string]$ProcessRecord){
 $base='C:\GRY\wow\diagnostics\CORE-FULL-PRODUCTION-R2-EXECUTE-R1-WOW-SRV-20261109-2345';$p=GetJson (Join-Path $base 'OPERATION-POINTERS.json')
 Need ($p.Operation -ceq 'f6b5458df54f445e978f35479e7c8798' -and $Receipt -ceq $p.Receipt -and $ProcessRecord -ceq $p.ProcessRecord -and (Hash $Receipt) -ceq '7319312BECC2CD707CF67747932AEEE4D5A366800E2A5C497AF3D993EF92EAD2') 'EXACT_DEPLOYMENT_R3_BINDING'
}
function Read-RuntimeBracketR3($Run){
 $status=Get-CurrentStatus;Need $status.Ready 'R3_RUNTIME_NOT_READY'
 $mysql=Get-BackendStopObservation 'VMANGOS-MySQL';Need ($mysql.State -ceq 'Running' -and @($mysql.Processes).Count -eq 2) 'R3_MYSQL_PAIR_NOT_READY'
 [pscustomobject]@{Snapshot=(Snapshot);MySQLProcesses=@($mysql.Processes);WorldGeneration=$status.Services.Mangosd.Generation;Registry=(Get-ReleaseRegistryState $Run.State.Release);Maintenance=(Read-ControlState $Run.Plan.Maintenance 'mangosd')}
}
function Assert-RuntimeBracketR3($Before,$After){
 foreach($b in $Before.Snapshot.Services){$a=@($After.Snapshot.Services|Where-Object Name -ceq $b.Name);Need ($a.Count -eq 1 -and $a[0].State -ceq $b.State -and $a[0].PID -eq $b.PID -and $a[0].Path -ceq $b.Path -and ([DateTimeOffset]::Parse($a[0].CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($b.CreatedUtc)).UtcTicks) 'R3_SERVICE_GENERATION_CHANGED'}
 foreach($b in $Before.MySQLProcesses){$a=@($After.MySQLProcesses|Where-Object PID -eq $b.PID);Need ($a.Count -eq 1 -and $a[0].Path -ceq $b.Path -and ([DateTimeOffset]::Parse($a[0].CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($b.CreatedUtc)).UtcTicks) 'R3_MYSQL_GENERATION_CHANGED'}
 Need (@($Before.Snapshot.Listeners).Count -eq @($After.Snapshot.Listeners).Count) 'R3_LISTENER_COUNT_CHANGED'
 foreach($b in $Before.Snapshot.Listeners){Need (@($After.Snapshot.Listeners|Where-Object {$_.PID -eq $b.PID -and $_.Port -eq $b.Port -and $_.Address -ceq $b.Address}).Count -eq 1) 'R3_LISTENER_OWNER_CHANGED'}
 Need ($Before.WorldGeneration -ceq $After.WorldGeneration -and $After.Registry.phase -ceq 'stable' -and $After.Registry.sequence -eq $Before.Registry.sequence -and $After.Registry.active.id -ceq $Before.Registry.active.id -and $After.Registry.active.sha256 -ceq $Before.Registry.active.sha256 -and $After.Maintenance.Phase -ceq 'Stable' -and $After.Maintenance.Sequence -eq $Before.Maintenance.Sequence -and $After.Maintenance.Generation -ceq $Before.Maintenance.Generation) 'R3_RUNTIME_RELEASE_OR_INTENT_CHANGED'
}

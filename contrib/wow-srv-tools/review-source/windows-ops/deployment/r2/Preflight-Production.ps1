. (Join-Path $PSScriptRoot 'FullProduction.ps1')
AssertKitPins
$r=NewKitRun 'Migrate' 'Plan';LoadProduction $r;AssertBaseline $r;AssertTaskBaseline $r
$bracketBefore=Snapshot
Assert-FullCandidate $r;Assert-FullDEVStopped
Need (!(Test-Path $r.Plan.VersionRoot) -and !(Test-Path $r.Plan.FullCandidate.SymbolRoot)) 'NEW_CONTROLLER_OR_SYMBOL_NAMESPACE_EXISTS'
foreach($name in @('inputs-core-full-production-r2.json','MigrateFull-core-full-production-r2.json')){Need (!(Test-Path (Join-Path 'C:\ProgramData\VMANGOS\R3Approvals' $name))) 'R2_EXECUTION_INPUT_ALREADY_ISSUED'}
$status=Get-CurrentStatus;Need $status.Ready 'CURRENT_SOURCE_NOT_READY'
$state=Read-ControlState $r.Plan.Maintenance 'mangosd';$reg=Get-ReleaseRegistryState $r.State.Release
Need ($state.Phase -ceq 'Stable' -and $reg.phase -ceq 'stable' -and $reg.active.id -ceq $r.Plan.BeforeRelease.id) 'CURRENT_SOURCE_NOT_STABLE'
Need (!(Test-Path (Join-Path $r.Plan.Maintenance 'planned-reboot-claim.json'))) 'REBOOT_CLAIM_UNRESOLVED'
$locks=@();foreach($name in @('Global\WOW-SRV-R3-Operation','Global\VMANGOS-AdminPanel-Control')){$m=[Threading.Mutex]::new($false,$name);$own=$m.WaitOne(0);try{Need $own 'CONCURRENT_CONTROL';$locks+=@($name)}finally{if($own){$m.ReleaseMutex()};$m.Dispose()}}
$lock=[IO.File]::Open((Join-Path $r.Plan.Maintenance 'operation.lock'),'Open','Read','None');$lock.Dispose()
$dev=@(foreach($n in @('VMANGOS-R3DEV-MySQL','VMANGOS-R3DEV-realmd','VMANGOS-R3DEV-mangosd','VMANGOS-COREUPD-DEV-MySQL','VMANGOS-COREUPD-DEV-realmd','VMANGOS-COREUPD-DEV-mangosd')){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$n+"'");Need ($s.State -ceq 'Stopped' -and $s.ProcessId -eq 0) 'DEV_NOT_STOPPED';@{Name=$s.Name;State=$s.State;PID=[long]$s.ProcessId}})
foreach($p in @(13306,13724,18085,17878,23306,23724,28085,27878)){Need (@(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue).Count -eq 0) 'DEV_LISTENER_REMAINS'}
$sample=ReadCollector;Need ($sample.ReleaseState.active.id -ceq $r.Plan.BeforeRelease.id) 'COLLECTOR_RELEASE'
$pdb=GetJson $r.Plan.FullCandidate.BuildRecord;Need ($pdb.Result -ceq 'PASS' -and @($pdb.Pairs|Where-Object Match -cne 'PASS').Count -eq 0) 'ACCEPTED_BUILD_AND_SYMBOL_PAIRS'
$private='C:\ProgramData\VMANGOS\R3Approvals\source-backup-candidate.ini';AssertPrivate $private
Assert-FullPrivateDefaults $r $private;$r.State.MigrationDefaults=@{Path=$private;SHA256=(Hash $private)};Assert-FullEndpoint $r
Assert-FullSQLSets $r $false
$now=Snapshot
foreach($b in $bracketBefore.Services){$current=@($now.Services|Where-Object Name -ceq $b.Name);Need ($current.Count -eq 1 -and $current[0].PID -eq $b.PID -and ([DateTimeOffset]::Parse($current[0].CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($b.CreatedUtc)).UtcTicks -and $current[0].State -ceq $b.State) 'RUNTIME_CHANGED_DURING_CURRENT_PREFLIGHT'}
foreach($b in $bracketBefore.Listeners){Need (@($now.Listeners|Where-Object {$_.Port -eq $b.Port -and $_.PID -eq $b.PID -and $_.Address -ceq $b.Address}).Count -eq 1) 'LISTENER_CHANGED_DURING_CURRENT_PREFLIGHT'}
$provenance=@(foreach($name in @('New-ProductionWorldDriver','Get-CurrentStatus','Get-BackendStopObservation')){$c=Get-Command $name;$sha=[Security.Cryptography.SHA256]::Create();try{$h=([BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($c.Definition)))).Replace('-','')}finally{$sha.Dispose()};@{Name=$name;File=$c.ScriptBlock.File;DefinitionSHA256=$h;Source='AST lift of pinned production source by LoadProduction, no operational entry executed'}})
SaveJson 'LIVE-PREFLIGHT-FINAL.json' @{Result='PASS_READONLY';AtUtc=[DateTimeOffset]::UtcNow.ToString('o');Runtime=$status;Registry=$reg;Maintenance=$state;Tasks=@(ReadControlTasksR2 $r);Collector=@{Release=$sample.ReleaseState.active;CollectedAtUtc=$sample.Sample.collectedAtUtc;World=$sample.Sample.world;CodeRoot=$sample.CodeRoot;ContractSHA256=$sample.ContractSHA256};DEV=$dev;LocksAvailable=$locks;BackupDefaultsReadable=$true;FreeBytesC=(Get-PSDrive C).Free;MigrationDefaults='Existing source-backup-candidate.ini: direct global privileges confirmed read-only; writes still need separate user approval';MySQLPair=$r.Receipt.LastSourceAttestation;LoaderProvenance=$provenance;ProductionGenerationsListenersProtectedFiles='UNCHANGED';Deployment='NOT_RUN';Gate='NOT_RUN';SQLApplied='NOT_RUN';Approved=$false;NoDDLWindow=$false}
Write-Host 'LIVE_PREFLIGHT=PASS_READONLY'

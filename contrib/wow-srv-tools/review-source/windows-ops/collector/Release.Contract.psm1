Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not ('WowReleaseV1.Secure' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'Release.Native.cs')}
function Fail([string]$Code){throw $Code}
function Require([bool]$Test,[string]$Code){if(-not $Test){Fail $Code}}
function Shape($Object,[string[]]$Keys){
    Require ($null -ne $Object) 'RELEASE_SHAPE'
    if($Object -is [Collections.IDictionary]){
        $names=@(foreach($entry in $Object.GetEnumerator()){Require ($entry.Key -is [string]) 'RELEASE_SHAPE';$entry.Key})
    }elseif($Object -is [Management.Automation.PSCustomObject]){
        $names=@($Object.PSObject.Properties.Name)
    }else{Fail 'RELEASE_SHAPE'}
    Require ($names.Count -eq $Keys.Count) 'RELEASE_SHAPE'
    foreach($key in $Keys){Require (@($names|Where-Object{$_ -ceq $key}).Count -eq 1) 'RELEASE_SHAPE'}
}
function SHA([string]$File){[WowReleaseV1.Secure]::Hash($File)}
function Json($Value){ConvertTo-Json -InputObject $Value -Depth 15 -Compress}
function Parse([string]$Text){[WowReleaseV1.JsonKeys]::Check($Text);ConvertFrom-Json -InputObject $Text}
function ReadPrivate([string]$Path){Parse ([WowReleaseV1.Secure]::Read($Path,$false))}
function WritePrivate([string]$Path,$Value){[WowReleaseV1.Secure]::Atomic($Path,(Json $Value),$false)}
function ValidID([string]$ID){Require ($ID -cmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$') 'RELEASE_ID'}
function ValidHash([string]$Value){Require ($Value -cmatch '^[0-9A-F]{64}$') 'RELEASE_HASH_FORMAT'}
function New-ReleaseContext([string]$RegistryRoot,[string]$RuntimeRoot,[string]$SnapshotPath,[switch]$Isolated){
    foreach($p in @($RegistryRoot,$RuntimeRoot,$SnapshotPath)){[WowReleaseV1.Secure]::Canonical($p)}
    if($Isolated){Require ($RegistryRoot.StartsWith('C:\Scripts\RELEASE-CONTRACT-TEST-',[StringComparison]::Ordinal)) 'ISOLATION_ROOT';$parent=[IO.Path]::GetDirectoryName($RegistryRoot);Require ($RuntimeRoot.StartsWith($parent+'\') -and $SnapshotPath.StartsWith($parent+'\')) 'ISOLATION_SCOPE'}
    else{Require ($RegistryRoot -ceq 'C:\ProgramData\VMANGOS\AdminPanelCollector\release-registry' -and $RuntimeRoot -ceq 'C:\GRY\wow\serwer-dev' -and $SnapshotPath -ceq 'C:\ProgramData\VMANGOS\AdminPanelTelemetry\snapshot.json') 'PRODUCTION_CONTEXT';[WowReleaseV1.Secure]::Verify([IO.Path]::GetDirectoryName($RegistryRoot),$true,$false)}
    [pscustomobject]@{Root=$RegistryRoot;Runtime=$RuntimeRoot;Snapshot=$SnapshotPath;Isolated=[bool]$Isolated;FreshSeconds=30}
}
function Initialize-ReleaseRegistry($Context){
    if(-not [IO.Directory]::Exists($Context.Root)){[WowReleaseV1.Secure]::NewDirectory($Context.Root,$false)}
    [WowReleaseV1.Secure]::Verify($Context.Root,$true,$false)
    foreach($n in @('manifests','proofs','approvals')){$p=Join-Path $Context.Root $n;if(-not [IO.Directory]::Exists($p)){[WowReleaseV1.Secure]::NewDirectory($p,$false)};[WowReleaseV1.Secure]::Verify($p,$true,$false)}
    $lock=Join-Path $Context.Root 'registry.lock';if(-not [IO.File]::Exists($lock)){[WowReleaseV1.Secure]::NewFile($lock,[byte[]]@(),$false)}
    $p=Join-Path $Context.Root 'state.json'
    if(-not [IO.File]::Exists($p)){WritePrivate $p ([ordered]@{schemaVersion=1;sequence=0;phase='uninitialized';active=$null;previous=$null;transaction=$null;changedUtc=[DateTimeOffset]::UtcNow.ToString('o')})}
}
function LockRegistry($Context){[WowReleaseV1.Secure]::Verify($Context.Root,$true,$false);$ms=30000;if($Context.Isolated){$ms=100};[WowReleaseV1.Secure]::Lock((Join-Path $Context.Root 'registry.lock'),$ms)}
function ValidateManifest($m){
    Shape $m @('schemaVersion','releaseId','revision','origin','binaries');Require ($m.schemaVersion -eq 1) 'RELEASE_SCHEMA';ValidID $m.releaseId
    Shape $m.revision @('commit','runtimePrefix');Require ($m.revision.commit -cmatch '^[0-9a-f]{40}$' -and $m.revision.runtimePrefix -cmatch '^[0-9a-f]{20,40}$' -and $m.revision.commit.StartsWith($m.revision.runtimePrefix,[StringComparison]::Ordinal)) 'RELEASE_REVISION_SCHEMA'
    Shape $m.origin @('buildProofSHA256','purpose','patches','evidence');ValidHash $m.origin.buildProofSHA256;Require ($m.origin.purpose -cin @('production','synthetic-test')) 'RELEASE_PURPOSE'
    Require (@($m.origin.patches).Count -le 32 -and @($m.origin.evidence).Count -ge 1 -and @($m.origin.evidence).Count -le 32) 'RELEASE_ORIGIN'
    foreach($p in @($m.origin.patches)){Shape $p @('path','sha256');Require ($p.path -is [string] -and $p.path.Length -ge 1 -and $p.path.Length -le 240) 'RELEASE_PATCH';ValidHash $p.sha256}
    foreach($e in @($m.origin.evidence)){Shape $e @('path','sha256');ValidHash $e.sha256}
    Shape $m.binaries @('mangosd','realmd')
    foreach($role in @('mangosd','realmd')){$b=$m.binaries.$role;Shape $b @('name','bytes','sha256');Require ($b.name -ceq ($role+'.exe') -and $b.bytes -is [ValueType] -and $b.bytes -ge 1 -and $b.bytes -le 67108864 -and [math]::Truncate([double]$b.bytes) -eq $b.bytes) 'RELEASE_BINARY_SCHEMA';ValidHash $b.sha256}
}
function ValidateProof($p,[string]$RuntimeRoot){
    Shape $p @('schemaVersion','releaseId','sourceCommit','runtimeRevisionPrefix','purpose','status','artifacts','patches','evidence');Require ($p.schemaVersion -eq 1 -and $p.purpose -cin @('production','synthetic-test')) 'BUILD_PROOF_SCHEMA';ValidID $p.releaseId
    Shape $p.status @('configure','build','verifier');Require ($p.status.configure -ceq 'PASS' -and $p.status.build -ceq 'PASS' -and $p.status.verifier -ceq 'PASS') 'BUILD_NOT_VERIFIED'
    Require (@($p.artifacts).Count -eq 2) 'BUILD_ARTIFACT_SET'
    foreach($role in @('mangosd','realmd')){$a=@($p.artifacts|Where-Object name -ceq ($role+'.exe'));Require ($a.Count -eq 1) 'BUILD_ARTIFACT_SET';Shape $a[0] @('name','sourcePath','bytes','sha256');ValidHash $a[0].sha256
        [WowReleaseV1.Secure]::Canonical($a[0].sourcePath);Require (-not $a[0].sourcePath.StartsWith($RuntimeRoot+'\',[StringComparison]::OrdinalIgnoreCase) -and -not $a[0].sourcePath.StartsWith('C:\GRY\wow\serwer-dev\',[StringComparison]::OrdinalIgnoreCase)) 'BUILD_SOURCE_RUNTIME_DENIED'
        Require ((Get-Item -LiteralPath $a[0].sourcePath).Length -eq $a[0].bytes -and (SHA $a[0].sourcePath) -ceq $a[0].sha256) 'BUILD_ARTIFACT_MISMATCH'
    }
    foreach($e in @($p.evidence)){Require ((SHA $e.path) -ceq $e.sha256) 'BUILD_EVIDENCE_MISMATCH'}
}
function New-VerifiedReleaseManifest([string]$BuildProofPath,[string]$OutputPath,[string]$RuntimeRoot='C:\GRY\wow\serwer-dev'){
    $p=Parse ([IO.File]::ReadAllText($BuildProofPath));ValidateProof $p $RuntimeRoot
    $b=[ordered]@{};foreach($r in @('mangosd','realmd')){$a=@($p.artifacts|Where-Object name -ceq ($r+'.exe'))[0];$b[$r]=[ordered]@{name=$a.name;bytes=$a.bytes;sha256=$a.sha256}}
    $m=[ordered]@{schemaVersion=1;releaseId=$p.releaseId;revision=[ordered]@{commit=$p.sourceCommit;runtimePrefix=$p.runtimeRevisionPrefix};origin=[ordered]@{buildProofSHA256=(SHA $BuildProofPath);purpose=$p.purpose;patches=@($p.patches);evidence=@($p.evidence)};binaries=$b}
    ValidateManifest (Parse (Json $m));Require (-not [IO.File]::Exists($OutputPath)) 'MANIFEST_ALREADY_EXISTS';[IO.File]::WriteAllText($OutputPath,(Json $m),[Text.UTF8Encoding]::new($false));$m
}
function Get-RegisteredRelease($Context,$Reference){
    Shape $Reference @('id','sha256');ValidID $Reference.id;ValidHash $Reference.sha256
    $file=Join-Path $Context.Root ('manifests\'+$Reference.id+'.json');Require ((SHA $file) -ceq $Reference.sha256) 'RELEASE_MANIFEST_HASH';$m=ReadPrivate $file;ValidateManifest $m;Require ($m.releaseId -ceq $Reference.id) 'RELEASE_ID_MISMATCH'
    Require ($Context.Isolated -or $m.origin.purpose -ceq 'production') 'SYNTHETIC_RELEASE_PRODUCTION_DENIED'
    $a=ReadPrivate (Join-Path $Context.Root ('approvals\'+$Reference.id+'.json'));Shape $a @('schemaVersion','releaseId','manifestSHA256','buildProofSHA256','registeredUtc','registeredBy');Require ($a.schemaVersion -eq 1 -and $a.releaseId -ceq $m.releaseId -and $a.manifestSHA256 -ceq $Reference.sha256 -and $a.buildProofSHA256 -ceq $m.origin.buildProofSHA256) 'RELEASE_APPROVAL'
    $proof=Join-Path $Context.Root ('proofs\'+$Reference.id+'.json');[void](ReadPrivate $proof);Require ((SHA $proof) -ceq $m.origin.buildProofSHA256) 'RELEASE_PROOF_HASH';return $m
}
function Register-VerifiedRelease($Context,[string]$ManifestPath,[string]$BuildProofPath){
    $m=Parse ([IO.File]::ReadAllText($ManifestPath));ValidateManifest $m;$p=Parse ([IO.File]::ReadAllText($BuildProofPath));ValidateProof $p $Context.Runtime
    Require ($p.releaseId -ceq $m.releaseId -and $p.sourceCommit -ceq $m.revision.commit -and $p.runtimeRevisionPrefix -ceq $m.revision.runtimePrefix -and $p.purpose -ceq $m.origin.purpose -and ($Context.Isolated -or $p.purpose -ceq 'production') -and (SHA $BuildProofPath) -ceq $m.origin.buildProofSHA256) 'RELEASE_BUILD_BINDING'
    Require ((Json @($p.patches)) -ceq (Json @($m.origin.patches)) -and (Json @($p.evidence)) -ceq (Json @($m.origin.evidence))) 'RELEASE_PROVENANCE_BINDING'
    foreach($r in @('mangosd','realmd')){$a=@($p.artifacts|Where-Object name -ceq ($r+'.exe'))[0];Require ($a.sha256 -ceq $m.binaries.$r.sha256 -and $a.bytes -eq $m.binaries.$r.bytes) 'RELEASE_BUILD_BINDING'}
    $reference=[pscustomobject]@{id=$m.releaseId;sha256=(SHA $ManifestPath)};$lock=LockRegistry $Context
    try{$file=Join-Path $Context.Root ('manifests\'+$m.releaseId+'.json')
        if([IO.File]::Exists($file)){[void](Get-RegisteredRelease $Context $reference);return $reference}
        [WowReleaseV1.Secure]::NewFile((Join-Path $Context.Root ('proofs\'+$m.releaseId+'.json')),[IO.File]::ReadAllBytes($BuildProofPath),$false)
        [WowReleaseV1.Secure]::NewFile($file,[IO.File]::ReadAllBytes($ManifestPath),$false)
        WritePrivate (Join-Path $Context.Root ('approvals\'+$m.releaseId+'.json')) ([ordered]@{schemaVersion=1;releaseId=$m.releaseId;manifestSHA256=$reference.sha256;buildProofSHA256=$m.origin.buildProofSHA256;registeredUtc=[DateTimeOffset]::UtcNow.ToString('o');registeredBy=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value})
        [void](Get-RegisteredRelease $Context $reference);return $reference
    }finally{$lock.Dispose()}
}
function ReadState($Context){
    $s=ReadPrivate (Join-Path $Context.Root 'state.json');Shape $s @('schemaVersion','sequence','phase','active','previous','transaction','changedUtc')
    Require ($s.schemaVersion -eq 1 -and $s.sequence -is [ValueType] -and $s.sequence -ge 0 -and [math]::Truncate([double]$s.sequence) -eq $s.sequence -and $s.phase -cin @('uninitialized','stable','transition')) 'RELEASE_STATE'
    if($null -ne $s.previous){[void](Get-RegisteredRelease $Context $s.previous)}
    if($s.phase -ceq 'uninitialized'){Require ($null -eq $s.active -and $null -eq $s.previous -and $null -eq $s.transaction) 'RELEASE_STATE'}
    else{Require ($null -ne $s.active) 'RELEASE_STATE';[void](Get-RegisteredRelease $Context $s.active)}
    if($s.phase -ceq 'stable'){Require ($null -eq $s.transaction) 'RELEASE_STATE'}
    if($s.phase -ceq 'transition'){Shape $s.transaction @('id','kind','target','beforeActive','beforePrevious','begunUtc','commitRequested');Require ($s.transaction.id -cmatch '^[0-9a-f]{32}$' -and $s.transaction.kind -cin @('deploy','rollback') -and $s.transaction.commitRequested -is [bool] -and (Json $s.transaction.beforeActive) -ceq (Json $s.active) -and (Json $s.transaction.beforePrevious) -ceq (Json $s.previous)) 'RELEASE_TRANSACTION';[void](Get-RegisteredRelease $Context $s.transaction.target)}
    return $s
}
function SaveState($Context,$State){$State.sequence=[long]$State.sequence+1;$State.changedUtc=[DateTimeOffset]::UtcNow.ToString('o');WritePrivate (Join-Path $Context.Root 'state.json') $State}
function Test-ReleaseSet($Manifest,[string]$ArtifactRoot,[string]$ObservedRevision){
    ValidateManifest $Manifest
    foreach($r in @('mangosd','realmd')){$b=$Manifest.binaries.$r;$f=Join-Path $ArtifactRoot $b.name;Require ([IO.File]::Exists($f) -and (Get-Item -LiteralPath $f).Length -eq $b.bytes -and (SHA $f) -ceq $b.sha256) 'RELEASE_PAIR_MISMATCH'}
    Require ($ObservedRevision -is [string] -and $ObservedRevision.StartsWith($Manifest.revision.runtimePrefix,[StringComparison]::Ordinal) -and ($ObservedRevision.Length -eq $Manifest.revision.runtimePrefix.Length -or $ObservedRevision.Substring($Manifest.revision.runtimePrefix.Length,1) -cmatch '[0-9a-f +(-]')) 'RELEASE_REVISION_MISMATCH'
    [pscustomobject]@{Compatible=$true;ReleaseId=$Manifest.releaseId;BothBinaries='MATCH';Revision='MATCH'}
}
function Get-CoreProcessPair {
    $items=@();foreach($name in @('mangosd','realmd')){$s=Get-CimInstance Win32_Service -Filter ("Name='"+$name+"'");Require ($s.State -ceq 'Running' -and $s.ProcessId -gt 0) 'RELEASE_WORLD_UNAVAILABLE';$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$s.ProcessId);Require ($null -ne $p -and $p.ExecutablePath -ieq ('C:\GRY\wow\serwer-dev\'+$name+'.exe')) 'RELEASE_PROCESS_IDENTITY';$items+=[pscustomobject]@{name=$name;processId=[int]$p.ProcessId;createdUtc=$p.CreationDate.ToUniversalTime().ToString('o')}}
    $ports=@(Get-NetTCPConnection -State Listen|Where-Object LocalPort -in @(3724,8085,7878));foreach($port in @(3724,8085,7878)){$role='mangosd';if($port -eq 3724){$role='realmd'};$owner=@($items|Where-Object name -ceq $role)[0].processId;$l=@($ports|Where-Object LocalPort -eq $port);Require ($l.Count -ge 1 -and @($l|Where-Object OwningProcess -ne $owner).Count -eq 0) 'RELEASE_PORT_OWNER';if($port -eq 7878){Require (@($l|Where-Object{$_.LocalAddress -notin @('127.0.0.1','::1')}).Count -eq 0) 'RELEASE_SOAP_SCOPE'}};return ,$items
}
function ValidateSample($Context,$Manifest,$Sample,[object[]]$Processes,[DateTimeOffset]$At=[DateTimeOffset]::UtcNow){
    Shape $Sample @('schemaVersion','collectedAtUtc','world','server','legacyBots','aiBots');Shape $Sample.world @('processId','createdUtc');Require ($Sample.schemaVersion -eq 1) 'RELEASE_SAMPLE_SCHEMA'
    $now=$At;$sampleAt=[DateTimeOffset]::Parse($Sample.collectedAtUtc);Require ($sampleAt.Offset -eq [TimeSpan]::Zero -and ($now-$sampleAt).TotalSeconds -ge -2 -and ($now-$sampleAt).TotalSeconds -le $Context.FreshSeconds) 'RELEASE_STALE_SAMPLE'
    $world=@($Processes|Where-Object name -ceq 'mangosd');$realm=@($Processes|Where-Object name -ceq 'realmd');Require ($world.Count -eq 1 -and $realm.Count -eq 1 -and $Sample.world.processId -eq $world[0].processId -and [DateTimeOffset]::Parse($Sample.world.createdUtc) -eq [DateTimeOffset]::Parse($world[0].createdUtc)) 'RELEASE_SAMPLE_GENERATION'
    foreach($n in @('server','legacyBots','aiBots')){Shape $Sample.$n @('status','errorCode','observedAtUtc','data');$time=[DateTimeOffset]::Parse($Sample.$n.observedAtUtc);Require ($time -ge [DateTimeOffset]::Parse($Sample.world.createdUtc) -and $time -le $sampleAt -and ($now-$time).TotalSeconds -le $Context.FreshSeconds) 'RELEASE_STALE_SAMPLE';Require ($Sample.$n.status -cin @('ok','error')) 'RELEASE_SAMPLE_SCHEMA';if($Sample.$n.status -ceq 'ok'){Require ($null -ne $Sample.$n.data -and $null -eq $Sample.$n.errorCode) 'RELEASE_SAMPLE_SCHEMA'}else{Require ($null -eq $Sample.$n.data -and $Sample.$n.errorCode -cmatch '^[A-Z0-9_]{1,48}$') 'RELEASE_SAMPLE_SCHEMA'}}
    $dataFields=@{
        server=@('coreRevision','uptimeDisplay','activeSessions','queuedSessions','peakActiveSessions','peakQueuedSessions')
        legacyBots=@('configuredMin','configuredMax','registered','loading','online','chatting','nonNativeBotSessions','totalWorldSessions')
        aiBots=@('prefix','prefixOrigin','configuredAccounts','configuredMinBots','configuredMaxBots','inventoryObservedAtUtc','accountsInventory','charactersInventory','onlineCharactersTotal','onlineRandomAiCandidates','onlineOtherCharacters','onlineOrphanCharacters','onlineRandomAiAccounts')
    }
    foreach($n in @('server','legacyBots','aiBots')){if($Sample.$n.status -ceq 'ok'){
        $d=$Sample.$n.data;Shape $d $dataFields[$n]
        foreach($key in $dataFields[$n]){if($key -in @('coreRevision','uptimeDisplay','prefix','prefixOrigin','inventoryObservedAtUtc')){Require ($d.$key -is [string] -and $d.$key.Length -ge 1 -and $d.$key.Length -le 512) 'RELEASE_SAMPLE_SCHEMA'}else{
            if($null -eq $d.$key -and $key -in @('configuredMinBots','configuredMaxBots')){continue}
            Require ($d.$key -is [ValueType] -and $d.$key -isnot [bool] -and [double]$d.$key -ge 0 -and [double]$d.$key -le 1000000000 -and [math]::Truncate([double]$d.$key) -eq [double]$d.$key) 'RELEASE_SAMPLE_COUNTER'
        }}
        if($n -ceq 'aiBots'){$inventoryAt=[DateTimeOffset]::Parse($d.inventoryObservedAtUtc);Require ($inventoryAt.Offset -eq [TimeSpan]::Zero -and $inventoryAt -ge [DateTimeOffset]::Parse($Sample.world.createdUtc) -and $inventoryAt -le [DateTimeOffset]::Parse($Sample.$n.observedAtUtc) -and ($now-$inventoryAt).TotalSeconds -le $Context.FreshSeconds) 'RELEASE_STALE_SAMPLE'}
    }}
    Require ($Sample.server.status -ceq 'ok' -and $null -ne $Sample.server.data) 'RELEASE_REVISION_UNOBSERVED'
    [void](Test-ReleaseSet $Manifest $Context.Runtime ([string]$Sample.server.data.coreRevision))
}
function Invalidate($Context,[string]$Code,$World=$null){
    if($null -eq $World -and [IO.File]::Exists($Context.Snapshot)){try{$World=(Parse ([WowReleaseV1.Secure]::Read($Context.Snapshot,$true))).world}catch{}}
    if($null -eq $World -or $World.processId -le 0){if([IO.File]::Exists($Context.Snapshot)){[WowReleaseV1.Secure]::Delete($Context.Snapshot,$true)};return}
    $now=[DateTimeOffset]::UtcNow.ToString('o');$error=[ordered]@{status='error';errorCode=$Code;observedAtUtc=$now;data=$null}
    $doc=[ordered]@{schemaVersion=1;collectedAtUtc=$now;world=$World;server=$error;legacyBots=$error;aiBots=$error}
    [WowReleaseV1.Secure]::Atomic($Context.Snapshot,(Json $doc),$true)
}
function Set-InitialRelease($Context,$Reference,$Sample,[object[]]$Processes){$lock=LockRegistry $Context;try{$s=ReadState $Context;Require ($s.phase -ceq 'uninitialized') 'RELEASE_ALREADY_INITIALIZED';$m=Get-RegisteredRelease $Context $Reference;ValidateSample $Context $m $Sample $Processes;Invalidate $Context 'COLLECTOR_INITIALIZING' $Sample.world;$s.active=$Reference;$s.phase='stable';SaveState $Context $s}finally{$lock.Dispose()}}
function Begin-ReleaseTransition($Context,$Target,[string]$OperationId,[switch]$Rollback){
    Require ($OperationId -cmatch '^[0-9a-f]{32}$') 'RELEASE_OPERATION_ID';$lock=LockRegistry $Context
    try{$s=ReadState $Context;$beforeActive=$s.active;$beforePrevious=$s.previous
        if($Rollback){if($s.phase -ceq 'transition'){$Target=$s.transaction.beforeActive;$beforeActive=$s.transaction.beforeActive;$beforePrevious=$s.transaction.beforePrevious}else{Require ($s.phase -ceq 'stable' -and $null -ne $s.previous) 'RELEASE_NO_PREVIOUS';$Target=$s.previous}}
        else{Require ($s.phase -ceq 'stable') 'RELEASE_TRANSITION_EXISTS';$old=Get-RegisteredRelease $Context $s.active;[void](Test-ReleaseSet $old $Context.Runtime $old.revision.runtimePrefix)}
        [void](Get-RegisteredRelease $Context $Target);Invalidate $Context 'RELEASE_TRANSITION'
        $s.phase='transition';$s.transaction=[pscustomobject]@{id=$OperationId;kind=$(if($Rollback){'rollback'}else{'deploy'});target=$Target;beforeActive=$beforeActive;beforePrevious=$beforePrevious;begunUtc=[DateTimeOffset]::UtcNow.ToString('o');commitRequested=$false};SaveState $Context $s;return $s
    }finally{$lock.Dispose()}
}
function Request-ReleaseCommit($Context,[string]$OperationId){$lock=LockRegistry $Context;try{$s=ReadState $Context;Require ($s.phase -ceq 'transition' -and $s.transaction.id -ceq $OperationId) 'RELEASE_OPERATION_MISMATCH';$s.transaction.commitRequested=$true;SaveState $Context $s}finally{$lock.Dispose()}}
function Invoke-ManifestCollector($Context,[scriptblock]$ReadSample,[scriptblock]$GetProcesses){
    $stage='registry-lock'
    $lock=LockRegistry $Context
    try{$stage='registry-state';$s=ReadState $Context
        if($s.phase -ceq 'uninitialized' -or ($s.phase -ceq 'transition' -and -not $s.transaction.commitRequested)){Invalidate $Context 'RELEASE_TRANSITION';return [pscustomobject]@{State='transition';Healthy=$false;Sampled=$false}}
        $ref=$s.active;if($s.phase -ceq 'transition'){$ref=$s.transaction.target}
        $stage='release-manifest';$m=Get-RegisteredRelease $Context $ref
        # Hash pair before transport and again after; observed revision comes ONLY from SOAP/sample.
        $stage='binary-pair';[void](Test-ReleaseSet $m $Context.Runtime $m.revision.runtimePrefix)
        $stage='process-before';$before=& $GetProcesses;$stage='engine-read';$sample=& $ReadSample $m
        $stage='process-after';$after=& $GetProcesses;Require ((Json $before) -ceq (Json $after)) 'RELEASE_PROCESS_CHANGED';$stage='sample-validation';ValidateSample $Context $m $sample @($after)
        if($s.phase -ceq 'transition'){$t=$s.transaction;$s.active=$t.target;if($t.target.id -ceq $t.beforeActive.id){$s.previous=$t.beforePrevious}else{$s.previous=$t.beforeActive};$s.phase='stable';$s.transaction=$null;SaveState $Context $s}
        $stage='publication';[WowReleaseV1.Secure]::Atomic($Context.Snapshot,(Json $sample),$true)
        WritePrivate (Join-Path $Context.Root 'last-sample.json') ([ordered]@{schemaVersion=1;sequence=$s.sequence;release=$s.active;processes=@($after);snapshotSHA256=(SHA $Context.Snapshot);collectedAtUtc=$sample.collectedAtUtc})
        WritePrivate (Join-Path $Context.Root 'collector-diagnostic.json') ([ordered]@{schemaVersion=1;stage='complete';cause=$null;exceptionClass=$null;observedUtc=[DateTimeOffset]::UtcNow.ToString('o')})
        [pscustomobject]@{State='published';Healthy=($sample.server.status -ceq 'ok' -and $sample.legacyBots.status -ceq 'ok' -and $sample.aiBots.status -ceq 'ok');Sampled=$true;ReleaseId=$m.releaseId}
    }catch{
        $cause='UNCLASSIFIED_SUPPRESSED';if($_.Exception.Message -cmatch '^(RELEASE|BUILD|COLLECTOR|WORLD|SOAP|MYSQL|WORKER)_[A-Z0-9_]{1,90}$'){$cause=$_.Exception.Message}
        try{WritePrivate (Join-Path $Context.Root 'collector-diagnostic.json') ([ordered]@{schemaVersion=1;stage=$stage;cause=$cause;exceptionClass=$_.Exception.GetType().Name;observedUtc=[DateTimeOffset]::UtcNow.ToString('o')})}catch{}
        Invalidate $Context 'RELEASE_VALIDATION_FAILED';throw
    }finally{$lock.Dispose()}
}
function Test-ActiveRelease($Context,[scriptblock]$GetProcesses){$lock=LockRegistry $Context;try{$s=ReadState $Context;Require ($s.phase -ceq 'stable') 'RELEASE_TRANSITION';$m=Get-RegisteredRelease $Context $s.active;$doc=Parse ([WowReleaseV1.Secure]::Read($Context.Snapshot,$true));$receipt=ReadPrivate (Join-Path $Context.Root 'last-sample.json');Require ($receipt.sequence -eq $s.sequence -and $receipt.release.id -ceq $s.active.id -and $receipt.release.sha256 -ceq $s.active.sha256 -and $receipt.snapshotSHA256 -ceq (SHA $Context.Snapshot)) 'RELEASE_SAMPLE_RECEIPT';$processes=& $GetProcesses;Require ((Json $receipt.processes) -ceq (Json @($processes))) 'RELEASE_PROCESS_CHANGED';ValidateSample $Context $m $doc @($processes);[pscustomobject]@{Compatible=$true;ReleaseId=$m.releaseId;Sequence=$s.sequence;Revision=$doc.server.data.coreRevision}}finally{$lock.Dispose()}}
function Test-ReleaseDeployPreflight($Context,$Candidate,[string]$CandidateArtifactRoot,[scriptblock]$GetProcesses){$active=Test-ActiveRelease $Context $GetProcesses;$lock=LockRegistry $Context;try{$m=Get-RegisteredRelease $Context $Candidate;[void](Test-ReleaseSet $m $CandidateArtifactRoot $m.revision.runtimePrefix);[pscustomobject]@{ContractVersion=1;Active=$active;CandidateReleaseId=$m.releaseId;CandidatePair='MATCH_VERIFIED_BUILD';CandidateRunningRevision='NOT_RUN';CompatibilityDefinition='Release.Contract.psm1/Test-ReleaseSet';Deployment='NOT_RUN'}}finally{$lock.Dispose()}}
function Get-ReleaseRegistryState($Context){$lock=LockRegistry $Context;try{ReadState $Context}finally{$lock.Dispose()}}
function Set-ReleaseUnavailable($Context){Invalidate $Context 'RELEASE_VALIDATION_FAILED'}
function New-ReleaseObservationWitness($Context,$Reference,$Sample,[object[]]$Processes){$m=Get-RegisteredRelease $Context $Reference;ValidateSample $Context $m $Sample $Processes;[pscustomobject]@{reference=$Reference;sample=$Sample;processes=$Processes;validatedUtc=[DateTimeOffset]::UtcNow.ToString('o')}}
function Initialize-ReleaseFromWitness($Context,$Witness,[object[]]$Processes){$lock=LockRegistry $Context;try{$s=ReadState $Context;Require ($s.phase -ceq 'uninitialized') 'RELEASE_ALREADY_INITIALIZED';$at=[DateTimeOffset]::Parse($Witness.validatedUtc);Require (([DateTimeOffset]::UtcNow-$at).TotalSeconds -le 120 -and (Json $Witness.processes) -ceq (Json $Processes)) 'RELEASE_INSTALL_GENERATION_CHANGED';$m=Get-RegisteredRelease $Context $Witness.reference;ValidateSample $Context $m $Witness.sample $Processes $at;Invalidate $Context 'COLLECTOR_INITIALIZING' $Witness.sample.world;$s.active=$Witness.reference;$s.phase='stable';SaveState $Context $s}finally{$lock.Dispose()}}
Export-ModuleMember -Function New-ReleaseContext,Initialize-ReleaseRegistry,New-VerifiedReleaseManifest,Register-VerifiedRelease,Get-RegisteredRelease,Set-InitialRelease,Test-ReleaseSet,Get-CoreProcessPair,Begin-ReleaseTransition,Request-ReleaseCommit,Invoke-ManifestCollector,Test-ActiveRelease,Test-ReleaseDeployPreflight,Get-ReleaseRegistryState,Set-ReleaseUnavailable,New-ReleaseObservationWitness,Initialize-ReleaseFromWitness

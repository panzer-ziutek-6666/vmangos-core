. (Join-Path $PSScriptRoot Preflight.Common.ps1)
$script:PrivateRaw=NewRaw
$run=[pscustomobject]@{Plan=$Plan;Out=$PrivateRaw;Kind='Migrate';Id=[guid]::NewGuid().ToString('N');Mode='Plan';Log=(Join-Path $PrivateRaw preflight.log);State=@{};Receipt=[ordered]@{WrittenHashes=@{}}}
$devAcceptReceipt=ReadJson $Accepted
[void](Get-AcceptedDevAcceptanceFix4 $run $Accepted)
AssertBaseline $run
$before=Snapshot;$source=AssertSourceInstance $Plan
$services=@(foreach($name in @('mangosd','realmd','VMANGOS-MySQL')){ServiceMetadata $name})
$dev=@(foreach($name in @($Plan.Dev.MySQL,$Plan.Dev.Realm,$Plan.Dev.World)){
 $s=DevServiceRecord $run $name
 Need ($s.State -ceq 'Stopped' -and $s.PID -eq 0 -and $s.Processes.Count -eq 0 -and $s.Win32 -eq 0 -and $s.Specific -eq 0) 'DEV_NOT_STOPPED'
 [pscustomobject]@{Name=$name;State=$s.State;PID=$s.PID;Win32=$s.Win32;Specific=$s.Specific;Processes=$s.Processes}
})
Need (@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -in @(13306,13724,18085,17878)).Count -eq 0) 'DEV_PORT_PRESENT'
SaveJson 'HOST-EARLY-OBSERVATION.json' @{Source=$before;SourceInstance=$source;Services=$services;DEV=$dev;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
$availability=@(foreach($name in @('Global\WOW-SRV-R3-Operation','Global\VMANGOS-AdminPanel-Control')){
 $m=[Threading.Mutex]::new($false,$name);$owned=$false
 try{$owned=$m.WaitOne(0);Need $owned ('OPERATION_BUSY '+$name);[pscustomobject]@{Name=$name;Available=$true}}
 finally{if($owned){$m.ReleaseMutex()};$m.Dispose()}
})
$locks=@(foreach($p in @((Join-Path $Plan.Maintenance operation.lock),(Join-Path $Plan.Registry registry.lock))){
 AssertPrivate $p;$f=$null
 try{$f=[IO.File]::Open($p,'Open','Read','None');[pscustomobject]@{Path=$p;Available=$true;Mode='Open existing / Read / NoShare; no create or write'}}
 catch [IO.IOException]{[pscustomobject]@{Path=$p;Available=$false;Reason=$_.Exception.Message;HResult=$_.Exception.HResult;Meaning='One-shot lock observation; not retried'}}
 finally{if($null -ne $f){$f.Dispose()}}
})
AssertTaskBaseline $run
$tasks=@(foreach($t in $Plan.Tasks){$a=Get-ScheduledTask -TaskName $t.Name -TaskPath $t.Path;[pscustomobject]@{Name=$t.Name;Path=$t.Path;State=[string]$a.State;Enabled=$a.Settings.Enabled;Actions=@($a.Actions|ForEach-Object {[pscustomobject]@{Exe=$_.Execute;Arguments=$_.Arguments;Cwd=$_.WorkingDirectory}})}})
Import-Module (Join-Path $Kit 'controller\Maintenance.psm1') -Force;$maintenance=Read-ControlState $Plan.Maintenance 'mangosd'
$pointer=ReadProtected $Plan.CollectorPointer
$state=ReadProtected (Join-Path $Plan.Registry state.json)
Need ($state.phase -ceq 'stable' -and $state.active.id -ceq $Plan.BeforeRelease.id -and $state.active.sha256 -ceq $Plan.BeforeRelease.sha256) 'ACTIVE_REGISTRY_MISMATCH'
Need ($maintenance.Phase -ceq 'Stable') 'MANUAL_MAINTENANCE_BLOCKS_MIGRATION'
$activePath=Join-Path $Plan.Registry ('manifests\'+$state.active.id+'.json')
Need ((Hash $activePath) -ceq $state.active.sha256) 'ACTIVE_MANIFEST_PIN'
$active=ReadJson $activePath
$candidate=ReadJson (Join-Path $Kit RELEASE-MANIFEST.json)
$codePath=Join-Path $Plan.CollectorRoot collector-code.json
Need ((Hash $codePath) -ceq $Plan.CollectorCodeSHA256 -and $pointer.codeManifestSHA256 -ceq $Plan.CollectorCodeSHA256 -and $pointer.collectorVersion -ceq $Plan.CollectorVersion) 'COLLECTOR_CODE_PIN'
$code=ReadJson $codePath
foreach($f in $code.files){Need ((Hash (Join-Path $Plan.CollectorRoot $f.name)) -ceq $f.sha256) 'INSTALLED_COLLECTOR_FILE_CHANGED'}
$baseline=@(foreach($f in $Plan.FixedInputs){[pscustomobject]@{Path=$f.Path;SHA256=(Hash $f.Path);SDDL=(Get-Acl $f.Path).Sddl}})
$artifact=@(foreach($f in $Plan.Artifacts){Need ((Hash $f.Path) -ceq $f.SHA256) 'R3_PIN_CHANGED';[pscustomobject]@{Role=$f.Role;Path=$f.Path;Bytes=(Get-Item $f.Path).Length;SHA256=(Hash $f.Path)}})
$activeBuild='C:\GRY\wow\dev\iso-autohonor-build-r2-20261028-2107'
$candidateSource='C:\Scripts\S1053-R3-20261104-1921\source'
$identity='C:\Scripts\SHUTDOWN1053-ISOLATED-PREP-R3-WOW-SRV-20261104-1908-PAYLOAD\dependencies\CoreBuildIdentity.cs'
Need ((Hash $identity) -ceq '6D91B1A2C22C18775A3520DBC01966CF5EA314003ED325F05750245CF37CA9DF') 'IDENTITY_HELPER_PIN'
Add-Type -Path $identity
$pairs=@(foreach($kind in @('Active','Candidate')){foreach($name in @('mangosd','realmd')){
 $exe=if($kind -ceq 'Active'){Join-Path $Plan.Runtime ($name+'.exe')}else{@($Plan.Artifacts|Where-Object Role -ceq ($name+'.exe'))[0].Path}
 $pdb=if($kind -ceq 'Active'){Join-Path $activeBuild ('build\symbols\Release\'+$name+'.pdb')}else{@($Plan.Artifacts|Where-Object Role -ceq ($name+'.pdb'))[0].Path}
 $id=[CoreBuildIdentity]::ExeId($exe);$symbol=[CoreBuildIdentity]::PdbId($pdb);Need ($id -ceq $symbol) 'EXE_PDB_MISMATCH'
 if($kind -ceq 'Active'){Need ((Hash $exe) -ceq $active.binaries.$name.sha256) 'ACTIVE_EXE_MANIFEST_MISMATCH'}
 [pscustomobject]@{Kind=$kind;EXE=$exe;EXESHA256=(Hash $exe);PDB=$pdb;PDBSHA256=(Hash $pdb);ExeId=$id;PdbId=$symbol;Match=$true}
}})
$dlls=@(foreach($f in $Plan.Artifacts|Where-Object Role -ceq 'APPLOCAL_DLL'){
 $name=[IO.Path]::GetFileName($f.Path);$runtime=Join-Path $Plan.Runtime $name
 [pscustomobject]@{Name=$name;ActivePath=$runtime;ActiveSHA256=(Hash $runtime);CandidatePath=$f.Path;CandidateSHA256=$f.SHA256;SameBytes=((Hash $runtime) -ceq $f.SHA256);PlannedReplace=$false}
})
Need (@($dlls|Where-Object {!$_.SameBytes}).Count -eq 0) 'DLL_COHORT_DIFFERS_PLAN_ONLY_REPLACES_EXES'
$files=@(foreach($f in $Plan.Files){[pscustomobject]@{Id=$f.Id;Group=$f.Group;Source=$f.Source;SourceSHA256=$f.SHA256;Target=$f.Target;BeforeExists=(Test-Path $f.Target);BeforeSHA256=$(if(Test-Path $f.Target){Hash $f.Target}else{$null});BackupRelative=($f.Id+'.bak')}})
$header=Join-Path $candidateSource 'src\shared\migrations_list.h';$oldHeader=Join-Path $activeBuild 'source\src\shared\migrations_list.h'
Need ((Hash $header) -ceq 'FAB762B8660B571F73BDBAAFA6593C989DDCA5049B54D74B94078FAC4D380A22' -and (Hash $header) -ceq (Hash $oldHeader)) 'CANDIDATE_MIGRATION_REQUIREMENTS_CHANGED'
SaveJson 'SQL-HEADER-READ.json' @{CandidateSource=$candidateSource;ActiveSource=(Join-Path $activeBuild source);Header=$header;HeaderSHA256=(Hash $header);ActiveHeaderSHA256=(Hash $oldHeader);Scope='Fresh exact migration header comparison, applied sets read separately from each DB; full historical SQL audit not repeated'}
$run.State=@{}
$loadAt=[DateTimeOffset]::UtcNow.ToString('o')
LoadProduction $run
$status=Get-CurrentStatus
$backend=@(foreach($name in @('mangosd','realmd','VMANGOS-MySQL')){Get-BackendStopObservation $name})
Need ($status.Ready -and $status.ObservationConsistent -and @($backend|Where-Object State -cne 'Running').Count -eq 0) 'ACTUAL_POST_LOADER_READ_NOT_READY'
SaveJson 'PRODUCTION-LOADER-READCHECK.json' @{Result='PASS';CompleteRun=@{Id=$run.Id;Kind=$run.Kind;Mode=$run.Mode;Out=$run.Out;Runtime=$run.Plan.Runtime;Maintenance=$run.Plan.Maintenance};ReturnedAtUtc=[DateTimeOffset]::UtcNow.ToString('o');LoadStartedUtc=$loadAt;Status=$status;Backend=$backend;ControllerEntryExecuted=$false;GateExecuted=$false;MutatingCallbacksInvoked=0;ServiceControls=0;RegistryWrites=0;ReadinessSQL='Actual existing controller SELECT1; password only in local process environment, not arguments or logs'}
# Approved R2 reader: coherent publication acquisition only, no collector transport or registry mutator.
Import-Module (Join-Path $Plan.CollectorRoot Release.Contract.psm1) -Force -DisableNameChecking
. (Join-Path $Kit 'dependencies\ReadCollector.R2.ps1')
$context=New-ReleaseContext $Plan.Registry $Plan.Runtime 'C:\ProgramData\VMANGOS\AdminPanelTelemetry\snapshot.json'
$telemetry=Read-CollectorPairR2 $context
SaveJson 'TELEMETRY-READ.json' @{Consistent=$telemetry.Consistent;Receipt=$telemetry.Receipt;Sample=$telemetry.Sample;State=$telemetry.State;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
$tools=@(foreach($n in @('mysql.exe','mysqldump.exe','mysqld.exe')){$p=Join-Path $Plan.MySQLBin $n;[pscustomobject]@{Path=$p;Exists=(Test-Path $p);SHA256=(Hash $p)}})
AssertPrivate $Options;AssertPrivate 'C:\ProgramData\VMANGOS\R3Approvals'
$free=[IO.DriveInfo]::new('C:\').AvailableFreeSpace
Need ($free -gt 4GB) 'INSUFFICIENT_FREE_SPACE'
SaveJson 'PREFLIGHT-HOST.json' @{Observation='COMPLETE';Host=$env:COMPUTERNAME;Account=[Security.Principal.WindowsIdentity]::GetCurrent().Name;Administrator=$true;PS=$PSVersionTable.PSVersion.ToString();Edition=$PSVersionTable.PSEdition;X64=[Environment]::Is64BitProcess;Cwd=$PWD.Path;Source=$before;SourceInstance=$source;Services=$services;DEV=$dev;Tasks=$tasks;Mutexes=$availability;FileLocks=$locks;Maintenance=$maintenance;RebootClaimExists=(Test-Path (Join-Path $Plan.Maintenance planned-reboot-claim.json));CollectorPointer=$pointer;Registry=$state;CandidateAlreadyRegistered=(Test-Path (Join-Path $Plan.Registry ('manifests\'+$candidate.releaseId+'.json')));VersionRootExists=(Test-Path $Plan.VersionRoot);BundlePointerExists=(Test-Path $Plan.BundlePointer);RollbackRoot=$Plan.BackupRoot;RollbackRootExists=(Test-Path $Plan.BackupRoot);FreeBytes=$free;Tools=$tools;Artifacts=$artifact;Pairs=$pairs;DLLs=$dlls;ProtectedBaseline=$baseline;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
SaveJson 'FILE-EXECUTION-MANIFEST.json' @{Files=$files;VersionPins=$Plan.VersionPins;TaskDefinitionSources=(Join-Path $Kit tasks);CollectorCodeUnchanged=$true;SQLWritesPlanned=$false;BackupOperationId='Fresh migration GUID not yet allocated';BackupFilesPattern=($Plan.BackupRoot+'\<MigrationGUID>-files');LogicalBackupPattern=($Plan.BackupRoot+'\<MigrationGUID>-logical\four-databases.sql')}
'OK=True';'CHANGE_SCOPE=READ_ONLY_HOST_AND_CODE_PREFLIGHT';'LOG='+$Out;'NEXT_STEP=Source read-only SQL and concrete blocked/ready plan'
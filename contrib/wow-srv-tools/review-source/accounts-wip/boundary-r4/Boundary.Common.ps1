Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:BoundaryLibraryRoot=$PSScriptRoot
. (Join-Path $PSScriptRoot 'Registry.Pins.ps1')
. (Join-Path $PSScriptRoot 'Task.Security.ps1')
function Need([bool]$Condition,[string]$Code) { if(-not $Condition){throw $Code} }
function JsonFile([string]$Path) { return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json) }
function Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function PrivateBytes([switch]$Directory) {
    # Creator owner: BA for elevated preparation, SYSTEM for task outputs.
    # Never adjust the caller/source token or an existing object's ACL.
    $sddl=if($Directory){'D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'}else{'D:P(A;;FA;;;SY)(A;;FA;;;BA)'}
    $sd=[Security.AccessControl.RawSecurityDescriptor]::new($sddl)
    $bytes=New-Object byte[] $sd.BinaryLength;$sd.GetBinaryForm($bytes,0);return ,$bytes
}
function PutPrivate([string]$Path,[byte[]]$Bytes) {
    $stream=[VmangosA147.PrivateIo]::NewFile($Path,(PrivateBytes))
    try{$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function PutJson([string]$Path,$Value) { PutPrivate $Path ([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 16))) }
function AssertPrivate([string]$Path,[switch]$Directory) {
    $acl=Get-Acl -LiteralPath $Path
    $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    Need ($owner -in @('S-1-5-18','S-1-5-32-544') -and $acl.AreAccessRulesProtected) ('PRIVATE_OWNER_DACL '+$Path)
    $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));Need ($rules.Count -eq 2) ('PRIVATE_ACES '+$Path)
    $seen=@{}
    foreach($rule in $rules){
        $sid=$rule.IdentityReference.Value
        Need ($sid -in @('S-1-5-18','S-1-5-32-544') -and -not $seen.ContainsKey($sid) -and
            $rule.AccessControlType -eq 'Allow' -and -not $rule.IsInherited -and [int]$rule.FileSystemRights -eq 2032127 -and
            [int]$rule.InheritanceFlags -eq $(if($Directory){3}else{0}) -and [int]$rule.PropagationFlags -eq 0) ('PRIVATE_RULE '+$Path)
        $seen[$sid]=$true
    }
}
function Pin([string]$Path) {
    $item=Get-Item -LiteralPath $Path -Force
    Need (-not $item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) ('FILE_KIND '+$Path)
    return [pscustomobject]@{Path=$item.FullName;Length=$item.Length;SHA256=(Hash $Path);ModifiedUtc=$item.LastWriteTimeUtc.ToString('o')}
}
function Get-ProtectedFilePin([string]$Path){return [pscustomobject]@{File=(Pin $Path);SDDL=(Get-Acl -LiteralPath $Path).Sddl}}
function CheckPins($Pins,[switch]$Mtime) {
    foreach($expected in @($Pins)){
        $actual=Pin $expected.Path
        Need ($actual.Length -eq $expected.Length -and $actual.SHA256 -ceq $expected.SHA256) ('INPUT_PIN '+$expected.Path)
        if($Mtime){Need ($actual.ModifiedUtc -ceq $expected.ModifiedUtc) ('INPUT_MTIME '+$expected.Path)}
    }
}
function CheckPayloadPins($Contract,[string]$BasePath){
    foreach($expected in @($Contract.PayloadPins)){
        Need ($expected.Name -cmatch '\A[A-Za-z0-9._-]+\z') 'PAYLOAD_LEAF_NAME'
        $actual=Pin (Join-Path $BasePath $expected.Name)
        Need ($actual.SHA256 -ceq $expected.SHA256 -and $actual.Length -eq $expected.Length) ('PAYLOAD_PIN '+$expected.Name)
    }
}
function CheckContract($Contract){
    $fields=@('Schema','Stage','Host','FixtureRoot','InstalledExe','BootstrapSHA256','CandidateSource','InstallPins','PayloadPins','IisPipelineTested','LiveConnections','TaskSecurity')
    Need (((@($Contract.PSObject.Properties.Name | Sort-Object)) -join '|') -ceq (($fields|Sort-Object) -join '|')) 'CONTRACT_FIELDS'
    $fixed='C:\VMANGOS-Accounts-Fixture-A139-1f07880aecf4453d8e77d99dc8fa3f7d'
    Need ($Contract.Schema -ceq 'ACCOUNTS-BOUNDARY-CONTRACT-1' -and $Contract.Host -ceq 'WOW-SRV' -and $Contract.FixtureRoot -ceq $fixed -and
        $Contract.InstalledExe -ceq ($fixed+'\bootstrap\Vmangos.Accounts.Bootstrap.exe') -and
        $Contract.BootstrapSHA256 -ceq '280D22B56A54962221AFBDB4039D53C1BB25E29EBA0BCB529A90FF08716EA621' -and
        @($Contract.InstallPins).Count -eq 20 -and @($Contract.PayloadPins).Count -eq 12 -and -not $Contract.IisPipelineTested -and $Contract.LiveConnections -eq 0) 'CONTRACT_VALUES'
    Need ($Contract.Stage -ceq 'ACCOUNTS-BOUNDARY-PREP-R4-WOW-SRV-20261027-2355') 'R4_CONTRACT_STAGE'
    AssertSame $Contract.TaskSecurity (Get-BoundaryTaskPolicy)
    $seen=@{}
    foreach($pin in @($Contract.InstallPins)){
        Need ($pin.Path.StartsWith($fixed+'\',[StringComparison]::Ordinal) -and $pin.Path.IndexOf('..',[StringComparison]::Ordinal) -lt 0 -and
            $pin.Path.IndexOf(':',2) -lt 0 -and [IO.Path]::GetFullPath($pin.Path) -ceq $pin.Path -and -not $seen.ContainsKey($pin.Path) -and
            $pin.SHA256 -cmatch '\A[0-9A-F]{64}\z' -and $pin.Length -gt 0 -and $pin.Length -le 16777216) 'INSTALL_PIN_SCHEMA'
        $seen[$pin.Path]=$true
    }
    Need ($seen.ContainsKey($Contract.InstalledExe)) 'MISSING_BOOTSTRAP_PIN'
    foreach($name in @('Boundary.Common.ps1','NativeVerifyProtocol.ps1','OwnedCapture.cs','SYSTEM-BOUNDARY.ps1','DotnetPins.json','Invoke-AccountsBoundary.ps1','Verify-AccountsBoundaryResult.ps1','Registry.Pins.ps1','Release.Native.cs','Attempt.Journal.ps1','Task.Security.ps1','Task.Token.cs')){
        Need (@($Contract.PayloadPins|Where-Object Name -CEQ $name).Count -eq 1) 'PAYLOAD_PIN_SET'
    }
}
function CheckHost {
    Need ($env:COMPUTERNAME -ieq 'WOW-SRV' -and [Environment]::Is64BitProcess -and
        $PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'WOW_SRV_PS51_X64_REQUIRED'
    $id=[Security.Principal.WindowsIdentity]::GetCurrent()
    try{Need (([Security.Principal.WindowsPrincipal]::new($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'ADMIN_REQUIRED'}finally{$id.Dispose()}
}
function ReadCapture([ValidateSet('Verify','Fixture')][string]$Phase,$Capture) {
    Need ($Capture.NaturalExit -and -not $Capture.WasTerminated -and $Capture.ReadersCompleted -and
        $null -eq $Capture.ReaderFailure -and -not $Capture.OutputLimitExceeded -and $Capture.JobQuiescent -and
        $Capture.JobFinalActive -eq 0 -and $Capture.Stderr.Length -eq 0) 'CAPTURE_OR_QUIESCENCE_FAILURE'
    if($Phase -ceq 'Verify'){
        $parsed=Read-NativeVerifyOutput -Stdout $Capture.Stdout -ExitCode $Capture.ExitCode
        Need ($parsed.Kind -ceq 'Verified') ('NATIVE_REFUSED '+$parsed.DetailLine)
    }else{
        Need ($Capture.ExitCode -eq 0 -and $Capture.Stdout -cmatch '\AA142_NATIVE_PREENTRY_COMPLETED=True OWN_LAUNCHER_EXIT=0 JOB_QUIESCENT=True LIVE_CONNECTIONS=0 IIS_PIPELINE_TESTED=False\r?\n\z') 'FIXTURE_PROTOCOL_FAILURE'
    }
    return $true
}
function Get-BoundaryHostSnapshot {
    # Metadata only. No command lines, config bodies, SOAP/SQL/HTTP, secret or runtime log content.
    $services=@(Get-CimInstance Win32_Service -Filter "Name='mangosd' OR Name='realmd' OR Name='VMANGOS-MySQL'" | Sort-Object Name | ForEach-Object {
        $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.ProcessId)
        Need ($_.State -ceq 'Running' -and $null -ne $p) ('SERVICE_NOT_RUNNING '+$_.Name)
        [pscustomobject]@{Name=$_.Name;State=$_.State;Mode=$_.StartMode;Pid=$_.ProcessId;Path=$p.ExecutablePath;Created=$p.CreationDate.ToUniversalTime().ToString('o')}
    });Need ($services.Count -eq 3) 'SERVICE_COUNT'
    $tasks=@(Get-ScheduledTask | Where-Object {$_.TaskName -like 'VMANGOS-ACCOUNTS-*' -or $_.TaskName -ceq 'VMANGOS-ADMIN-PANEL-TELEMETRY'} | Sort-Object TaskName | ForEach-Object {
        if($_.TaskName -like 'VMANGOS-ACCOUNTS-*'){Need (-not $_.Settings.Enabled -and [string]$_.State -ceq 'Disabled') ('OLD_ACCOUNT_TASK_NOT_DISABLED '+$_.TaskName)}
        $xml=Export-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath
        $sha=[Security.Cryptography.SHA256]::Create();try{$digest=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($xml))).Replace('-','')}finally{$sha.Dispose()}
        $taskFile=Join-Path 'C:\Windows\System32\Tasks' ($_.TaskPath.Trim('\')+'\'+$_.TaskName).TrimStart('\')
        [pscustomobject]@{Name=$_.TaskName;State=[string]$_.State;XmlHash=$digest;SDDL=(Get-Acl -LiteralPath $taskFile).Sddl}
    });Need (@($tasks | Where-Object Name -Like 'VMANGOS-ACCOUNTS-*').Count -eq 3) 'OLD_ACCOUNT_TASK_COUNT'
    $ports=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -In @(3306,3724,7878,8085) | Sort-Object LocalPort,LocalAddress | Select-Object LocalPort,LocalAddress,OwningProcess)
    $files=@();foreach($p in @('C:\GRY\wow\serwer-dev\mangosd.exe','C:\GRY\wow\serwer-dev\realmd.exe','C:\Windows\System32\inetsrv\config\applicationHost.config')){$files+=Get-ProtectedFilePin $p}
    $env:GIT_OPTIONAL_LOCKS='0'
    $git=@(& git -C 'C:\GRY\wow\dev\vmangos-core' -c core.fsmonitor=false status --porcelain=v1 --untracked-files=all);Need ($LASTEXITCODE -eq 0) 'GIT_STATUS'
    $head=(& git -C 'C:\GRY\wow\dev\vmangos-core' rev-parse HEAD);Need ($LASTEXITCODE -eq 0 -and $head -ceq 'b1c0e16e228738dd16f04122ddffd17a6c916b70') 'CORE_HEAD'
    $sourceFiles=@()
    foreach($relative in @('src/game/Chat/Chat.cpp','src/game/Handlers/ChatHandler.cpp','src/game/Objects/Player.cpp','src/mangosd/remote/RemoteAccess/RASocket.cpp','src/mangosd/remote/soap/MaNGOSsoap.cpp')){$sourceFiles+=Pin (Join-Path 'C:\GRY\wow\dev\vmangos-core' $relative)}
    foreach($p in @(Get-ChildItem 'C:\GRY\wow\dev\vmangos-core\contrib\admin-panel' -File -Recurse | Sort-Object FullName)){$sourceFiles+=Pin $p.FullName}
    $sourceFiles+=Pin 'C:\GRY\wow\dev\vmangos-core\contrib\admin-panel.zip'
    $pointer=JsonFile 'C:\ProgramData\VMANGOS\AdminPanelCollector\collector-current.json'
    Need ($pointer.collectorVersion -cmatch '\A[A-Za-z0-9_.-]{1,95}\z') 'COLLECTOR_VERSION'
    $workerPath='C:\ProgramData\VMANGOS\AdminPanelCollector\versions\'+$pointer.collectorVersion+'\Run-TelemetryWorker.ps1'
    $workers=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($workerPath)})
    Need ($workers.Count -eq 1 -and $workers[0].ExecutablePath -ceq 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe') 'COLLECTOR_PROCESS_IDENTITY'
    $collector=[pscustomobject]@{Pid=$workers[0].ProcessId;Created=$workers[0].CreationDate.ToUniversalTime().ToString('o');Path=$workers[0].ExecutablePath;Worker=$workerPath}
    return [pscustomobject]@{Services=$services;Tasks=$tasks;Ports=$ports;Files=$files;Git=$git;Head=$head;SourceFiles=$sourceFiles;Collector=$collector}
}
function Get-AppPoolProcessCandidates {
    # Read only: no HTTP, token modification, pool control or historical PID.
    foreach($p in @(Get-CimInstance Win32_Process -Filter "Name='w3wp.exe'" | Sort-Object ProcessId)){
        $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
        Need ($owner.ReturnValue -eq 0) 'APPPOOL_OWNER_QUERY_FAILED'
        [pscustomobject]@{Pid=[int]$p.ProcessId;Path=[string]$p.ExecutablePath;CreatedUtc=$p.CreationDate.ToUniversalTime().ToString('o');UserSid=[string]$owner.Sid}
    }
}
function Get-AppPoolObservations {
    try{return [pscustomobject]@{QuerySucceeded=$true;Workers=@(Get-AppPoolProcessCandidates);Error=$null;ObservedUtc=[DateTime]::UtcNow.ToString('o')}}
    catch{return [pscustomobject]@{QuerySucceeded=$false;Workers=@();Error=$_.Exception.GetType().FullName;ObservedUtc=[DateTime]::UtcNow.ToString('o')}}
}
function Select-RequiredAppPoolWorker($Observation){
    Need $Observation.QuerySucceeded 'FIXTURE_APPPOOL_OBSERVATION_UNAVAILABLE'
    $sid='S-1-5-82-2192834305-681035450-1731772730-1791053079-2169464979'
    $matches=@($Observation.Workers|Where-Object {$_.UserSid -ceq $sid -and $_.Path -ieq 'C:\Windows\System32\inetsrv\w3wp.exe'})
    Need ($matches.Count -eq 1) 'FIXTURE_PROPER_APPPOOL_WORKER_REQUIRED'
    Need ($matches[0].Pid -gt 0 -and [DateTimeOffset]::Parse($matches[0].CreatedUtc).UtcDateTime -le [DateTime]::UtcNow) 'FIXTURE_APPPOOL_GENERATION'
    # Fixed identity fields only. Observation timestamp is never an invariant.
    return [pscustomobject]@{Pid=$matches[0].Pid;Path=$matches[0].Path.ToUpperInvariant();CreatedUtc=$matches[0].CreatedUtc;UserSid=$matches[0].UserSid}
}
function Initialize-RegistrySecurity {
    if(-not ('WowReleaseV1.Secure' -as [type])){Add-Type -Path (Join-Path $script:BoundaryLibraryRoot 'Release.Native.cs')}
}
function Get-CollectorProtection([string]$CollectorRoot){
    Initialize-RegistrySecurity
    [WowReleaseV1.Secure]::Verify($CollectorRoot,$true,$false)
    $registry=Join-Path $CollectorRoot 'release-registry'
    $pointerPath=Join-Path $CollectorRoot 'collector-current.json'
    [WowReleaseV1.Secure]::Verify($pointerPath,$false,$false)
    $pointer=JsonFile $pointerPath
    Need ($pointer.schemaVersion -eq 1 -and $pointer.contractVersion -eq 1 -and $pointer.collectorVersion -cmatch '\A[A-Za-z0-9_.-]{1,95}\z') 'COLLECTOR_POINTER_SCHEMA'
    $codeRoot=Join-Path $CollectorRoot ('versions\'+$pointer.collectorVersion)
    [WowReleaseV1.Secure]::Verify($codeRoot,$true,$false)
    $catalogPath=Join-Path $codeRoot 'collector-code.json'
    [WowReleaseV1.Secure]::Verify($catalogPath,$false,$false)
    Need ((Hash $catalogPath) -ceq $pointer.codeManifestSHA256) 'COLLECTOR_CATALOG_BINDING'
    $catalog=JsonFile $catalogPath
    Need ($catalog.schemaVersion -eq 1 -and $catalog.contractVersion -eq 1 -and $catalog.collectorVersion -ceq $pointer.collectorVersion) 'COLLECTOR_CATALOG_SCHEMA'
    $names=@('Collect-Telemetry.Core.ps1','Release.Contract.psm1','Release.Native.cs','Run-TelemetryWorker.ps1','Transport.Helpers.cs','collector-policy.json')
    Need (@($catalog.files).Count -eq $names.Count) 'COLLECTOR_CODE_FILE_SET'
    $codePins=@()
    foreach($name in $names){
        $rows=@($catalog.files|Where-Object {$_.name -ceq $name});Need ($rows.Count -eq 1) 'COLLECTOR_CODE_FILE_SET'
        $p=Join-Path $codeRoot $name;[WowReleaseV1.Secure]::Verify($p,$false,$false)
        Need ((Hash $p) -ceq $rows[0].sha256 -and (Get-Item -LiteralPath $p).Length -eq $rows[0].bytes) ('COLLECTOR_CODE_PIN '+$name)
        $codePins+=[pscustomobject]@{Path=$p;Bytes=$rows[0].bytes;SHA256=$rows[0].sha256;SDDL=(Get-Acl -LiteralPath $p).Sddl}
    }
    Need (@(Get-ChildItem -LiteralPath $codeRoot -File).Count -eq 7) 'COLLECTOR_CODE_DISK_SET'
    foreach($p in @($pointerPath,$catalogPath)){$codePins+=[pscustomobject]@{Path=$p;Bytes=(Get-Item -LiteralPath $p).Length;SHA256=(Hash $p);SDDL=(Get-Acl -LiteralPath $p).Sddl}}
    $directories=@(foreach($p in @($CollectorRoot,(Join-Path $CollectorRoot 'versions'),$codeRoot,$registry,(Join-Path $registry 'manifests'),(Join-Path $registry 'proofs'),(Join-Path $registry 'approvals'))){
        [WowReleaseV1.Secure]::Verify($p,$true,$false)
        if($p -in @((Join-Path $registry 'manifests'),(Join-Path $registry 'proofs'),(Join-Path $registry 'approvals'))){Need (@(Get-ChildItem -LiteralPath $p -Directory).Count -eq 0) 'REGISTRY_UNEXPECTED_SUBDIRECTORY'}
        [pscustomobject]@{Path=$p;SDDL=(Get-Acl -LiteralPath $p).Sddl}
    })
    # Exact reviewed scope: state.json + manifests/ + proofs/ + approvals/.
    # No last-sample, collector-diagnostic, registry.lock or publication mtime.
    $registryPins=Get-RegistryPins $registry
    $state=JsonFile (Join-Path $registry 'state.json')
    Need ($state.schemaVersion -eq 1 -and $state.phase -ceq 'stable' -and $state.sequence -ge 1 -and $null -eq $state.transaction) 'RELEASE_TRANSITION_OR_INVALID_STATE'
    return [pscustomobject]@{RegistryPins=$registryPins;CodePins=$codePins;DirectoryAcls=$directories}
}
function Snapshot {
    param([Parameter(Mandatory=$true)][ValidateSet('BootstrapUpdate','NativeVerify','Fixture')][string]$Operation,
        [string]$CollectorRoot='C:\ProgramData\VMANGOS\AdminPanelCollector')
    $hostState=Get-BoundaryHostSnapshot
    $protection=Get-CollectorProtection $CollectorRoot
    $pool=Get-AppPoolObservations
    $required=if($Operation -ceq 'Fixture'){Select-RequiredAppPoolWorker $pool}else{$null}
    return [pscustomobject]@{Schema='BOUNDARY-SNAPSHOT-3';Operation=$Operation;Invariant=[pscustomobject]@{HostState=$hostState;CollectorProtection=$protection;RequiredAppPool=$required};Observations=[pscustomobject]@{AppPool=$pool}}
}
function AssertSnapshotSame($Before,$After){
    Need ($Before.Schema -ceq 'BOUNDARY-SNAPSHOT-3' -and $After.Schema -ceq 'BOUNDARY-SNAPSHOT-3' -and $Before.Operation -ceq $After.Operation -and $Before.Operation -cin @('BootstrapUpdate','NativeVerify','Fixture')) 'SNAPSHOT_OPERATION_MISMATCH'
    if($Before.Operation -ceq 'Fixture'){Need ($null -ne $Before.Invariant.RequiredAppPool -and $null -ne $After.Invariant.RequiredAppPool) 'FIXTURE_REQUIRED_GENERATION_MISSING'}
    else{Need ($null -eq $Before.Invariant.RequiredAppPool -and $null -eq $After.Invariant.RequiredAppPool) 'NON_FIXTURE_POOL_INVARIANT_REFUSED'}
    AssertSame $Before.Invariant $After.Invariant
}
function AssertSame($Before,$After){Need ((ConvertTo-Json -InputObject $Before -Depth 16 -Compress) -ceq (ConvertTo-Json -InputObject $After -Depth 16 -Compress)) 'BEFORE_AFTER_CHANGED'}
function SnapshotInstall($Contract){
    $rows=@()
    foreach($p in @($Contract.InstallPins)){
        $f=Pin $p.Path;$acl=Get-Acl -LiteralPath $p.Path
        $rows+=[pscustomobject]@{File=$f;Sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]14)}
    }
    foreach($directory in @($Contract.FixtureRoot,(Join-Path $Contract.FixtureRoot 'bootstrap'),(Join-Path $Contract.FixtureRoot 'worker'),(Join-Path $Contract.FixtureRoot 'client'),(Join-Path $Contract.FixtureRoot 'launcher'),(Join-Path $Contract.FixtureRoot 'system-temp'),(Join-Path $Contract.FixtureRoot 'client-temp'))){
        $item=Get-Item -LiteralPath $directory -Force;Need ($item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) ('DIR_KIND '+$directory)
        $acl=Get-Acl -LiteralPath $directory
        $rows+=[pscustomobject]@{Directory=$directory;Sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]14)}
    }
    return ,$rows
}

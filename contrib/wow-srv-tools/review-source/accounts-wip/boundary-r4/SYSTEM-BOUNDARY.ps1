Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$configPath=Join-Path $root 'RUN.json'
$utf8=[Text.UTF8Encoding]::new($false)
$ok=$false;$child=$null;$lease=$null;$capture=$null;$errorInfo=$null;$selfDisabled=$false;$attempted=$false;$stage='ENTRY'
try{
    . (Join-Path $root 'Boundary.Common.ps1')
    . (Join-Path $root 'NativeVerifyProtocol.ps1')
    CheckHost
    AssertPrivate $root -Directory;AssertPrivate $configPath
    $config=JsonFile $configPath
    Need ($config.Phase -cin @('Verify','Fixture')) 'WORKER_PHASE'
    Need ($PSCommandPath -ceq (Join-Path $config.Root 'SYSTEM-BOUNDARY.ps1') -and $root -ceq $config.Root) 'WORKER_PATH'
    Need ([DateTime]::UtcNow -lt [DateTime]::Parse($config.DeadlineUtc).ToUniversalTime()) 'WORKER_EXPIRED'
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try{Need ($identity.User.Value -ceq 'S-1-5-18') 'WORKER_SYSTEM_REQUIRED'}finally{$identity.Dispose()}
    Need ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) 'WORKER_SESSION0'
    $stage='SELF_DISABLE'
    $service=New-Object -ComObject Schedule.Service;$service.Connect();$folder=$service.GetFolder('\');$task=$folder.GetTask($config.TaskName)
    Need ($task.Definition.RegistrationInfo.Description -ceq $config.RunId) 'WORKER_TASK_IDENTITY'
    $task.Enabled=$false;Need (-not $task.Enabled) 'SELF_DISABLE_FAILED';$selfDisabled=$true
    $stage='INPUT_SEAL'
    CheckPins $config.PayloadPins
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $root 'OwnedCapture.cs'))) -Language CSharp -ReferencedAssemblies 'System.dll','System.Core.dll','System.Xml.dll','System.Security.dll','System.IO.Compression.dll'
    [VmangosA147.OwnedIo]::NoImpersonation()
    PutJson (Join-Path $root 'SYSTEM-CLAIM.json') @{RunId=$config.RunId;ClaimedUtc=[DateTime]::UtcNow.ToString('o')}
    $contract=JsonFile (Join-Path $root 'Boundary.Contract.json')
    CheckContract $contract
    CheckPins $contract.InstallPins
    $lease=[VmangosA147.InstallLease]::new()
    foreach($pin in @($contract.InstallPins)){
        $actual=Pin $pin.Path
        $lease.Add($pin.Path,$pin.SHA256,[long]$pin.Length,$actual.ModifiedUtc)
    }
    $lease.Revalidate()
    if($config.Phase -ceq 'Fixture'){
        $required=Select-RequiredAppPoolWorker (Get-AppPoolObservations)
        AssertSame $config.RequiredAppPool $required
        # New synthetic journal directory only; the pinned managed initializer
        # uses CREATE_NEW for its files and never repairs/truncates existing data.
        [VmangosA147.PrivateIo]::Directory((Join-Path $contract.FixtureRoot 'private'),(PrivateBytes -Directory))
        AssertPrivate (Join-Path $contract.FixtureRoot 'private') -Directory
    }
    $stage='NATIVE_'+$config.Phase
    Need ([DateTime]::UtcNow -lt [DateTime]::Parse($config.DeadlineUtc).ToUniversalTime()) 'WORKER_EXPIRED_BEFORE_NATIVE'
    $argument=if($config.Phase -ceq 'Verify'){'--verify-installed'}else{'--fixture-launch'}
    $timeout=if($config.Phase -ceq 'Verify'){60000}else{360000}
    $attempted=$true
    $child=[VmangosA147.Child]::new($contract.InstalledExe,$argument,([IO.Path]::GetDirectoryName($contract.InstalledExe)),[string[]]@('PATH=C:\Windows\System32'),$true)
    $natural=$child.Wait($timeout);$child.Finish()
    $capture=[pscustomobject]@{ExitCode=$child.ExitCode;Stdout=$child.StandardOutput;Stderr=$child.StandardError;NaturalExit=$natural;WasTerminated=$child.WasTerminated;ReadersCompleted=$child.ReadersCompleted;ReaderFailure=$child.ReaderFailure;OutputLimitExceeded=$child.OutputLimitExceeded;JobQuiescent=$child.JobQuiescent;JobFinalActive=$child.JobFinalActive;Pid=$child.Id}
    $null=ReadCapture $config.Phase $capture
    if($config.Phase -ceq 'Fixture'){AssertSame $config.RequiredAppPool (Select-RequiredAppPoolWorker (Get-AppPoolObservations))}
    $lease.Revalidate();[VmangosA147.OwnedIo]::NoImpersonation();$ok=$true
}catch{
    $errorInfo=[pscustomobject]@{Stage=$stage;Message=$_.Exception.Message;Line=$_.InvocationInfo.ScriptLineNumber}
}finally{
    if($null -ne $child){try{$child.Finish();$child.Dispose()}catch{$ok=$false;$errorInfo=[pscustomobject]@{Stage='CHILD_CLEANUP';Message=$_.Exception.Message}}}
    if($null -ne $lease){try{$lease.Revalidate();$lease.Dispose()}catch{$ok=$false;$errorInfo=[pscustomobject]@{Stage='LEASE_CLEANUP';Message=$_.Exception.Message}}}
    # Result retained even on protocol refusal. A failed result is never converted to PASS.
    if(Get-Command PutJson -ErrorAction SilentlyContinue){
        try{PutJson (Join-Path $root 'SYSTEM-RESULT.json') ([pscustomobject]@{Schema='ACCOUNTS-BOUNDARY-1';RunId=$config.RunId;Phase=$config.Phase;Ok=$ok;UserSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;SessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;SelfDisabled=$selfDisabled;NativeAttempted=$attempted;Native=$capture;Error=$errorInfo;CompletedUtc=[DateTime]::UtcNow.ToString('o');LiveConnections=0;IisPipelineTested=$false;CreateAccountLiveReady=$false})}catch{$ok=$false}
    }
}
if($ok){exit 0}else{exit 1}

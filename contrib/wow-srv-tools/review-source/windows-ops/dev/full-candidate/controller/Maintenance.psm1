Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(-not ('AdminControlStoreV1.Atomic' -as [type])){Add-Type -TypeDefinition 'namespace AdminControlStoreV1 { public static class Atomic { public static void Replace(string source,string destination) { System.IO.File.Replace(source,destination,null); } } }'}
function Require([bool]$ok,[string]$message){if(!$ok){throw $message}}
function Assert-PrivateControlPath([string]$Path){
    $full=[IO.Path]::GetFullPath($Path);$next=$full
    while($next){if(Test-Path -LiteralPath $next){Require (-not ((Get-Item -LiteralPath $next -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) ('REPARSE '+$next)};$next=[IO.Path]::GetDirectoryName($next.TrimEnd('\'))}
    $acl=Get-Acl -LiteralPath $full
    $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    Require ($owner -cin @('S-1-5-18','S-1-5-32-544')) ('PRIVATE_OWNER '+$full)
    foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){Require ($ace.IdentityReference.Value -cin @('S-1-5-18','S-1-5-32-544') -and $ace.AccessControlType -eq 'Allow') ('PRIVATE_DACL '+$full)}
}
function Set-NewControlOwner([string]$Path){$acl=Get-Acl -LiteralPath $Path;$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));Set-Acl -LiteralPath $Path -AclObject $acl}
function Write-ControlAtomic([string]$Path,$Value){
    Assert-PrivateControlPath ([IO.Path]::GetDirectoryName($Path))
    if(Test-Path -LiteralPath $Path){Assert-PrivateControlPath $Path}
    $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp';$bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 12 -Compress))
    $stream=[IO.FileStream]::new($temp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
    try{Set-NewControlOwner $temp;$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    if(Test-Path -LiteralPath $Path){[AdminControlStoreV1.Atomic]::Replace($temp,$Path)}else{[IO.File]::Move($temp,$Path)}
    Assert-PrivateControlPath $Path
}
function New-ControlStore([string]$Root,[string]$Service){
    Require (!(Test-Path -LiteralPath $Root)) 'STORE_ALREADY_EXISTS'
    $security=[Security.AccessControl.DirectorySecurity]::new();$security.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
    [void][IO.Directory]::CreateDirectory($Root,$security);Assert-PrivateControlPath $Root
    $state=[ordered]@{Schema=1;Service=$Service;Sequence=0;Phase='Maintenance';Intent='InitialDeploymentRequiresExplicitStart';PreviousStartType=3;Generation=$null;UpdatedUtc=[DateTimeOffset]::UtcNow.ToString('o');Failure=$null}
    Write-ControlAtomic (Join-Path $Root 'state.json') $state
}
function Read-ControlState([string]$Root,[string]$Service){
    Assert-PrivateControlPath $Root;$path=Join-Path $Root 'state.json';Assert-PrivateControlPath $path
    $state=[IO.File]::ReadAllText($path)|ConvertFrom-Json
    $names=@($state.PSObject.Properties.Name|Sort-Object);$expected=@('Schema','Service','Sequence','Phase','Intent','PreviousStartType','Generation','UpdatedUtc','Failure')|Sort-Object
    Require (($names -join '|') -ceq ($expected -join '|') -and $state.Schema -eq 1 -and $state.Service -ceq $Service -and $state.Sequence -ge 0 -and $state.Phase -cin @('Maintenance','Starting','Stable') -and $state.PreviousStartType -eq 3) 'STATE_SCHEMA'
    [void][DateTimeOffset]::Parse($state.UpdatedUtc);return $state
}
function Write-ControlEvent($Context,[string]$Event,$Data){
    $row=[ordered]@{Utc=[DateTimeOffset]::UtcNow.ToString('o');Operation=$Context.Operation;Event=$Event;Data=$Data}
    $path=Join-Path $Context.Root 'journal.jsonl';$stream=[IO.FileStream]::new($path,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough)
    try{Set-NewControlOwner $path;$bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $row -Depth 10 -Compress)+"`r`n");$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
function Set-ControlState($Context,[string]$Phase,[string]$Intent,$Generation,$Failure=$null){
    $old=Read-ControlState $Context.Root $Context.Service
    $value=[ordered]@{Schema=1;Service=$Context.Service;Sequence=([long]$old.Sequence+1);Phase=$Phase;Intent=$Intent;PreviousStartType=3;Generation=$Generation;UpdatedUtc=[DateTimeOffset]::UtcNow.ToString('o');Failure=$Failure}
    Write-ControlAtomic (Join-Path $Context.Root 'state.json') $value
    Write-ControlEvent $Context 'STATE_DURABLE' $value
}
function Get-ControlSnapshot($Context){$value=& $Context.Driver.Read;Require ($value.Service -ceq $Context.Service) 'SERVICE_MISMATCH';if($value.Pid -gt 0){Require (![string]::IsNullOrWhiteSpace($value.Generation) -and ![string]::IsNullOrWhiteSpace($value.CreatedUtc)) 'GENERATION_REQUIRED'};return $value}
function Wait-ControlDown($Context,$Original){
    $timer=[Diagnostics.Stopwatch]::StartNew();$last=Get-ControlSnapshot $Context
    while($last.State -ne 1 -or $last.Pid -ne 0){
        Require ($timer.Elapsed.TotalSeconds -lt $Context.Timeout) 'STOP_TIMEOUT_BARRIER_RETAINED'
        if($last.Pid -gt 0 -and $null -ne $Original){Require ($last.Generation -ceq $Original) 'GENERATION_CHANGED_WHILE_STOPPING'}
        Start-Sleep -Milliseconds $Context.PollMs;$last=Get-ControlSnapshot $Context
    }
    Require ($null -ne $last.PSObject.Properties['ResultKnown'] -and $last.ResultKnown -is [bool] -and $last.ResultKnown) 'STOP_RESULT_UNKNOWN_DATABASE_RETAINED'
    Require ($last.Win32ExitCode -eq 0 -and $last.SpecificExitCode -eq 0) ('STOP_FAILED_DATABASE_RETAINED Win32='+$last.Win32ExitCode+' Specific='+$last.SpecificExitCode+' Action='+$Context.Action+' Generation='+$Original)
    Write-ControlEvent $Context 'WORLD_STOPPED_NO_PROCESS_RESULT_CONFIRMED' @{Snapshot=$last;StoppedGeneration=$Original;Action=$Context.Action}
    return $last
}
function Enter-ControlMaintenance($Context,[string]$Intent){
    $before=Get-ControlSnapshot $Context
    $expected=$Context.PSObject.Properties['ExpectedStopGeneration']
    if($null -ne $expected -and $null -ne $expected.Value){Require ($before.Generation -ceq $expected.Value) 'GENERATION_CHANGED_BEFORE_MAINTENANCE'}
    Set-ControlState $Context 'Maintenance' $Intent $before.Generation
    if($Context.Driver.ContainsKey('AuthorizeMaintenance')){[void](& $Context.Driver.AuthorizeMaintenance $Context $before (Read-ControlState $Context.Root $Context.Service))}
    & $Context.Driver.Disable
    $after=Get-ControlSnapshot $Context;Require ($after.StartType -eq 4) 'DISABLED_READBACK_FAILED'
    if($before.Pid -gt 0 -and $after.Pid -gt 0){Require ($after.Generation -ceq $before.Generation) 'GENERATION_CHANGED_BEFORE_STOP'}
    Write-ControlEvent $Context 'DISABLED_BARRIER' $after
    # SCM can be in STOP_PENDING or already stopped; never send duplicate STOP.
    if($after.State -eq 2){
        $timer=[Diagnostics.Stopwatch]::StartNew();do{Require ($timer.Elapsed.TotalSeconds -lt $Context.Timeout) 'START_PENDING_STOP_TIMEOUT';Start-Sleep -Milliseconds $Context.PollMs;$after=Get-ControlSnapshot $Context}while($after.State -eq 2)
    }
    if($after.State -eq 4){Require ($Context.StopRequests.Add($after.Generation)) 'STOP_ALREADY_REQUESTED_THIS_GENERATION';& $Context.Driver.Stop;Write-ControlEvent $Context 'STOP_REQUEST_ONCE' $after.Generation}
    elseif($after.State -notin @(1,3)){throw 'STOP_UNSUPPORTED_STATE'}
    if($Context.Driver.ContainsKey('DeferStopWait') -and (& $Context.Driver.DeferStopWait $Context)){
        # Request-only handoff. The bound outer coordinator owns native measurement,
        # own-handle release and terminal SCM/CIM validation. This is NOT a stop PASS.
        Write-ControlEvent $Context 'STOP_WAIT_DEFERRED_TO_BOUND_RETAINED_COORDINATOR' @{Generation=$after.Generation;Action=$Context.Action;Operation=$Context.Operation}
        return
    }
    Wait-ControlDown $Context $after.Generation
}
function Wait-ControlReady($Context,[DateTimeOffset]$NotBefore,[bool]$AllowExisting){
    $timer=[Diagnostics.Stopwatch]::StartNew();$generation=$null;$lastBeat=-30
    do{
        $snapshot=Get-ControlSnapshot $Context
        Require ($snapshot.State -ne 1) 'START_ENDED_WITHOUT_READY'
        if($snapshot.Pid -gt 0){
            if($null -eq $generation){$generation=$snapshot.Generation}else{Require ($generation -ceq $snapshot.Generation) 'GENERATION_CHANGED_DURING_START'}
            if(!$AllowExisting){Require ([DateTimeOffset]::Parse($snapshot.CreatedUtc) -ge $NotBefore.AddSeconds(-1)) 'STALE_PROCESS_GENERATION'}
            if($snapshot.State -eq 4 -and (& $Context.Driver.Ready $snapshot)){
                $again=Get-ControlSnapshot $Context;Require ($again.Generation -ceq $generation -and $again.State -eq 4) 'GENERATION_CHANGED_AT_READY'
                Set-ControlState $Context 'Stable' 'ExplicitStartConfirmedReady' $generation
                Write-ControlEvent $Context 'WORLD_READY' $again;return $again
            }
        }
        Require ($timer.Elapsed.TotalSeconds -lt $Context.Timeout) 'WORLD_INITIALIZED_TIMEOUT'
        if($timer.Elapsed.TotalSeconds-$lastBeat -ge 30){$lastBeat=[int]$timer.Elapsed.TotalSeconds;Write-ControlEvent $Context 'WAIT_WORLD_INITIALIZED' @{Seconds=$lastBeat;Snapshot=$snapshot}}
        Start-Sleep -Milliseconds $Context.PollMs
    }while($true)
}
function Start-ControlWorld($Context,[bool]$Explicit){
    $state=Read-ControlState $Context.Root $Context.Service
    if(!$Explicit -and $state.Phase -cne 'Stable'){
        [void](Enter-ControlMaintenance $Context 'BootRespectsPersistentMaintenance');Write-ControlEvent $Context 'BOOT_SKIPPED_MAINTENANCE' $null
        return [pscustomobject]@{Skipped=$true;Reason='Maintenance'}
    }
    $before=Get-ControlSnapshot $Context
    if($before.State -in @(2,4)){
        Require ($state.Phase -ceq 'Stable') 'MAINTENANCE_RUNNING_UNEXPECTED_USE_EXPLICIT_RESTART'
        Write-ControlEvent $Context 'ADOPT_EXISTING_GENERATION_NO_START' $before
        return Wait-ControlReady $Context ([DateTimeOffset]::MinValue) $true
    }
    Require ($before.State -eq 1 -and $before.Pid -eq 0) 'WORLD_NOT_FULLY_STOPPED'
    $epoch=[DateTimeOffset]::UtcNow
    Set-ControlState $Context 'Starting' $(if($Explicit){'ExplicitAdministratorStart'}else{'BootFromStable'}) $null
    if($Context.Driver.ContainsKey('AuthorizeStart')){[void](& $Context.Driver.AuthorizeStart $Context (Read-ControlState $Context.Root $Context.Service))}
    & $Context.Driver.Demand
    $current=Get-ControlSnapshot $Context
    if($current.State -eq 1 -and $current.Pid -eq 0){
        $code=& $Context.Driver.Start
        Write-ControlEvent $Context 'START_REQUEST_ONCE' @{Code=$code;SCMQueue='Unknown; not cancelled'}
        Require ($code -in @(0,1056)) ('START_ERROR_'+$code)
    }elseif($current.State -in @(2,4)){
        Write-ControlEvent $Context 'SCM_STARTED_BEFORE_REQUEST_ADOPT_GENERATION' $current
    }else{throw 'SCM_RACE_UNSUPPORTED_STATE'}
    return Wait-ControlReady $Context $epoch $false
}
function Assert-DependencyStopResult($Result,[string]$Name){
    Require ($null -ne $Result -and @($Result).Count -eq 1) ('DEPENDENCY_RESULT_MISSING '+$Name)
    foreach($field in @('Schema','Name','Service','Stopped','ProcessesGone','ResultKnown','Win32ExitCode','SpecificExitCode','Result','Observation','ExpectedProcesses','ProcessExits','PrimaryError','EvidenceErrors','CleanupErrors')){
        Require ($null -ne $Result.PSObject.Properties[$field]) ('DEPENDENCY_RESULT_FIELD '+$Name+' '+$field)
    }
    Require ($Result.Schema -eq 2 -and $Result.Name -ceq $Name -and $Result.Service -ceq $Name -and $Result.Result -ceq 'PASS' -and $null -eq $Result.PrimaryError -and @($Result.EvidenceErrors).Count -eq 0 -and @($Result.CleanupErrors).Count -eq 0) ('DEPENDENCY_RESULT_FAILED '+$Name)
    Require ($Result.Stopped -is [bool] -and $Result.Stopped -and $Result.ProcessesGone -is [bool] -and $Result.ProcessesGone -and $Result.ResultKnown -is [bool] -and $Result.ResultKnown) ('DEPENDENCY_RESULT_UNKNOWN '+$Name)
    $s=$Result.Observation
    Require ($null -ne $s -and $s.Name -ceq $Name -and $s.Terminal -is [bool] -and $s.Terminal -and $s.Pending -is [bool] -and !$s.Pending -and $s.State -ceq 'Stopped' -and $s.PID -eq 0 -and @($s.Processes).Count -eq 0 -and $null -eq $s.Reason) ('DEPENDENCY_TERMINAL_NOT_CONFIRMED '+$Name)
    foreach($v in @($Result.Win32ExitCode,$Result.SpecificExitCode,$s.PID,$s.Win32ExitCode,$s.SpecificExitCode)){
        Require ($null -ne $v -and ($v -is [int] -or $v -is [uint32] -or $v -is [long] -or $v -is [uint64]) -and $v -eq 0) ('DEPENDENCY_STOP_FAILED '+$Name)
    }
    $expected=@($Result.ExpectedProcesses);$exits=@($Result.ProcessExits)
    Require ($expected.Count -gt 0 -and $exits.Count -eq $expected.Count -and @($expected.PID|Sort-Object -Unique).Count -eq $expected.Count) ('DEPENDENCY_NATIVE_SET_UNKNOWN '+$Name)
    foreach($p in $expected){
        Require ($null -ne $p.PID -and ($p.PID -is [int] -or $p.PID -is [long] -or $p.PID -is [uint32] -or $p.PID -is [uint64]) -and $p.PID -gt 0 -and $p.PID -le [uint32]::MaxValue -and ![string]::IsNullOrWhiteSpace($p.Path) -and ![string]::IsNullOrWhiteSpace($p.CreatedUtc)) ('DEPENDENCY_GENERATION_UNKNOWN '+$Name)
        $rows=@($exits|Where-Object {$_.PID -eq $p.PID -and [string]::Equals($_.Path,$p.Path,[StringComparison]::OrdinalIgnoreCase) -and ([DateTimeOffset]::Parse($_.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks})
        Require ($rows.Count -eq 1 -and $rows[0].Measurement -ceq 'MEASURED' -and $null -ne $rows[0].NativeExit -and ($rows[0].NativeExit -is [long] -or $rows[0].NativeExit -is [int] -or $rows[0].NativeExit -is [uint32]) -and $rows[0].NativeExit -eq 0) ('DEPENDENCY_NATIVE_NOT_ZERO_OR_UNKNOWN '+$Name)
    }
}
function Invoke-ControlledStop($Context,$Dependencies){
    $world=Enter-ControlMaintenance $Context 'AdministratorStopAll'
    $realm=& $Dependencies.StopRealm;Assert-DependencyStopResult $realm 'realmd'
    $mysql=& $Dependencies.StopMySQL;Assert-DependencyStopResult $mysql 'VMANGOS-MySQL'
    Write-ControlEvent $Context 'STACK_STOPPED_CONFIRMED' @{World=$world;Realm=$realm;MySQL=$mysql}
    return [pscustomobject]@{Stopped=$true;Maintenance=$true;World=$world;Realm=$realm;MySQL=$mysql}
}
function Assert-PlannedBoot($Claim,$Evidence){
    Require ($Claim.Schema -eq 2 -and $Claim.Operation -cmatch '^[a-f0-9]{32}$') 'RESUME_CLAIM_SCHEMA'
    Require ($Claim.Phase -ceq 'REQUEST_ACCEPTED_BOOT_NOT_VERIFIED') 'RESUME_REQUEST_NOT_CONFIRMED'
    Require ($Claim.Resume.Desired -is [bool] -and $Claim.Resume.Desired) 'RESUME_NOT_REQUESTED'
    $source=[DateTimeOffset]::Parse($Claim.Resume.SourceBootUtc).ToUniversalTime()
    $current=[DateTimeOffset]::Parse($Evidence.CurrentBootUtc).ToUniversalTime()
    $requested=[DateTimeOffset]::Parse($Claim.RequestAtUtc).ToUniversalTime()
    Require ($current -gt $source -and $requested -ge $source -and $requested -lt $current) 'RESUME_NEW_BOOT_NOT_CONFIRMED'
    # A matching operation is necessary, but insufficient: require the first
    # subsequent boot and the latest OS restart request to refer to this claim.
    $boots=@($Evidence.Boots|Where-Object {([DateTimeOffset]::Parse($_.BootUtc)).ToUniversalTime() -gt $requested})
    Require ($boots.Count -eq 1 -and [Math]::Abs((([DateTimeOffset]::Parse($boots[0].BootUtc)).ToUniversalTime()-$current).TotalSeconds) -le 10) 'RESUME_NOT_FIRST_NEW_BOOT'
    $requests=@($Evidence.Requests|Where-Object {([DateTimeOffset]::Parse($_.AtUtc)).ToUniversalTime() -ge $requested -and ([DateTimeOffset]::Parse($_.AtUtc)).ToUniversalTime() -lt $current}|Sort-Object {[DateTimeOffset]::Parse($_.AtUtc)})
    Require ($requests.Count -gt 0) 'RESUME_OS_REQUEST_EVIDENCE_MISSING'
    $last=$requests[-1]
    Require ($last.Comment -ceq ('WOW-SRV controlled Operation='+$Claim.Operation) -and $last.Image -ieq 'C:\Windows\system32\shutdown.exe (WOW-SRV)' -and $last.Host -ieq 'WOW-SRV') 'RESUME_OS_OPERATION_MISMATCH'
}
function Resume-PlannedBoot($Context,$Dependencies,[scriptblock]$Finalize){
    $state=Read-ControlState $Context.Root $Context.Service
    $path=Join-Path $Context.Root 'planned-reboot-claim.json';Assert-PrivateControlPath $path
    $claim=[IO.File]::ReadAllText($path)|ConvertFrom-Json
    Require ($state.Phase -ceq 'Maintenance' -and $state.Intent -ceq ('PlannedReboot:'+ $claim.Operation+':AwaitingConfirmedBoot') -and $state.Sequence -eq $claim.Resume.ExpectedSequence) 'RESUME_STATE_CHANGED_MANUAL_DECISION_RETAINED'
    $evidence=& $Dependencies.BootEvidence $claim
    Assert-PlannedBoot $claim $evidence
    $cap=& $Dependencies.VerifyCapability
    Require ($cap.Approved -is [bool] -and $cap.Approved -and $cap.SHA256 -ceq $claim.Resume.CapabilitySHA256) 'RESUME_CAPABILITY_CHANGED'
    $claim.Phase='RESUME_CONSUMED_BEFORE_START';$claim|Add-Member NoteProperty ResumeBootUtc ([DateTimeOffset]::Parse($evidence.CurrentBootUtc).ToUniversalTime().ToString('o'))
    Write-ControlAtomic $path $claim
    Write-ControlEvent $Context 'PLANNED_RESUME_ONCE_VERIFIED_NEW_BOOT' $claim
    & $Dependencies.StartMySQL
    & $Dependencies.StartRealm
    $world=Start-ControlWorld $Context $true
    $result=Complete-ControlStart $Context $world $Finalize
    $claim.Phase='RESUMED_READY';Write-ControlAtomic $path $claim
    return $result
}
function Invoke-ControlStack {
    param([string]$Root,[string]$Service,[ValidateSet('Stop-All','Start-All','Restart-World','Status','Planned-Reboot')][string]$Action,[hashtable]$Driver,[hashtable]$Dependencies,[switch]$Boot,[int]$Timeout=900,[scriptblock]$Finalize)
    if($Action -cin @('Start-All','Restart-World')){Require ($null -ne $Finalize) 'FINAL_VALIDATOR_REQUIRED'}
    Assert-PrivateControlPath $Root;$lockPath=Join-Path $Root 'operation.lock'
    if(Test-Path -LiteralPath $lockPath){Assert-PrivateControlPath $lockPath}
    $lock=[IO.File]::Open($lockPath,'OpenOrCreate','ReadWrite','None');Set-NewControlOwner $lockPath
    $poll=2000;if($Driver.ContainsKey('PollMilliseconds')){$poll=[int]$Driver.PollMilliseconds};Require ($poll -ge 50 -and $poll -le 5000) 'POLL_RANGE'
    $context=[pscustomobject]@{Root=$Root;Service=$Service;Driver=$Driver;Action=$Action;Operation=[guid]::NewGuid().ToString('N');Timeout=$Timeout;PollMs=$poll;StopRequests=[Collections.Generic.HashSet[string]]::new()}
    $mutation=$false
    try{
        $state=Read-ControlState $Root $Service;Write-ControlEvent $context 'BEGIN' @{Action=$Action;Boot=[bool]$Boot;State=$state;Snapshot=(Get-ControlSnapshot $context)}
        if($Action -ceq 'Status'){return [pscustomobject]@{State=$state;World=(Get-ControlSnapshot $context)}}
        Require (!$Boot -or $Action -ceq 'Start-All') 'BOOT_ACTION_DENIED'
        $mutation=$true
        if($Boot -and $state.Phase -cne 'Stable'){
            if($state.Intent -cmatch '^PlannedReboot:[a-f0-9]{32}:AwaitingConfirmedBoot$'){return Resume-PlannedBoot $context $Dependencies $Finalize}
            return Start-ControlWorld $context $false
        }
        switch($Action){
            'Stop-All'{return Invoke-ControlledStop $context $Dependencies}
            'Planned-Reboot'{
                $capability=& $Dependencies.VerifyCapability
                Require ($null -ne $capability -and $capability.Approved -is [bool] -and $capability.Approved) 'REBOOT_CORE_OUTCOME_CAPABILITY_NOT_CONFIRMED'
                $claimPath=Join-Path $Root 'planned-reboot-claim.json'
                Require (!(Test-Path -LiteralPath $claimPath)) 'REBOOT_ALREADY_CLAIMED_NO_RETRY'
                Require ($state.Phase -cin @('Stable','Maintenance')) 'REBOOT_PREVIOUS_STATE_UNCONFIRMED'
                $sourceBoot=& $Dependencies.CurrentBoot
                [void][DateTimeOffset]::Parse($sourceBoot)
                $desired=$state.Phase -ceq 'Stable'
                if($desired){
                    $ready=& $Dependencies.ObserveReady
                    $before=Get-ControlSnapshot $context
                    # Stable is the approved persistent intent. Its historical
                    # PID may predate a legitimate core-only restart. Bind the
                    # operation to two current readiness/driver observations.
                    Require ($ready.Ready -is [bool] -and $ready.Ready -and $before.State -eq 4 -and $ready.Services.Mangosd.Generation -ceq $before.Generation) 'REBOOT_PREVIOUS_READY_GENERATION_NOT_CONFIRMED'
                }else{$before=Get-ControlSnapshot $context;Require ($before.State -eq 1 -and $before.Pid -eq 0) 'REBOOT_MANUAL_MAINTENANCE_RUNNING_UNEXPECTED'}
                Require ($capability.SHA256 -cmatch '^[A-F0-9]{64}$') 'REBOOT_CAPABILITY_HASH_REQUIRED'
                $claim=@{Schema=2;Operation=$context.Operation;Phase='CLAIMED_BEFORE_STOP';Session='01a19436-72e3-7970-b187-c1344eb2e6d9';At=[DateTimeOffset]::UtcNow.ToString('o');Resume=@{Desired=$desired;PreviousPhase=[string]$state.Phase;PreviousGeneration=$state.Generation;SourceBootUtc=([DateTimeOffset]::Parse($sourceBoot)).ToUniversalTime().ToString('o');SourceGeneration=$before.Generation;CapabilitySHA256=$capability.SHA256;ExpectedSequence=$null};RequestAtUtc=$null;Checkpoint=$null;Request=$null}
                Write-ControlAtomic $claimPath $claim
                $stopped=Invoke-ControlledStop $context $Dependencies
                $checkpoint=& $Dependencies.Checkpoint $context $stopped
                Require ($null -ne $checkpoint -and $checkpoint.Saved -is [bool] -and $checkpoint.Saved) 'REBOOT_CHECKPOINT_NOT_CONFIRMED'
                if($desired){Set-ControlState $context 'Maintenance' ('PlannedReboot:'+$context.Operation+':AwaitingConfirmedBoot') $null}
                $claim.Resume.ExpectedSequence=(Read-ControlState $Root $Service).Sequence
                $claim.Phase='REQUEST_ONCE_NO_RETRY';$claim.Checkpoint=$checkpoint;$claim.RequestAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
                Require (([DateTimeOffset]::Parse((& $Dependencies.CurrentBoot))).ToUniversalTime() -eq ([DateTimeOffset]::Parse($sourceBoot)).ToUniversalTime()) 'REBOOT_BOOT_CHANGED_DURING_STOP'
                Write-ControlAtomic $claimPath $claim
                $request=& $Dependencies.RequestReboot $context
                Require ($null -ne $request -and $request.ResultKnown -is [bool] -and $request.ResultKnown -and $request.ExitCode -is [long] -and $request.ExitCode -eq 0) 'REBOOT_REQUEST_FAILED_OR_UNKNOWN_NO_RETRY'
                $claim.Phase='REQUEST_ACCEPTED_BOOT_NOT_VERIFIED';$claim.Request=$request;Write-ControlAtomic $claimPath $claim
                return [pscustomobject]@{Ready=$false;Stopped=$true;Maintenance=$true;RebootRequested=$true;BootVerified=$false;Operation=$context.Operation;Checkpoint=$checkpoint}
            }
            'Restart-World'{& $Dependencies.RequireReady;[void](Enter-ControlMaintenance $context 'AdministratorRestartWorld');$world=Start-ControlWorld $context $true;return Complete-ControlStart $context $world $Finalize}
            'Start-All'{& $Dependencies.StartMySQL;& $Dependencies.StartRealm;$world=Start-ControlWorld $context (!$Boot);return Complete-ControlStart $context $world $Finalize}
        }
    }catch{
        $message=$_.Exception.Message
        if($mutation){
            try{
                Set-ControlState $context 'Maintenance' 'FailureRequiresAdministrator' $null $message;& $Driver.Disable
                $actual=Get-ControlSnapshot $context;Require ($actual.StartType -eq 4) 'FAIL_DISABLED_READBACK'
                if($Action -cnotin @('Stop-All','Planned-Reboot') -and $actual.State -eq 4 -and $context.StopRequests.Add($actual.Generation)){& $Driver.Stop;Write-ControlEvent $context 'FAIL_STOP_OWN_GENERATION_ONCE' $actual.Generation;Wait-ControlDown $context $actual.Generation}
                Write-ControlEvent $context 'FAIL_BARRIER_RETAINED' (Get-ControlSnapshot $context)
            }catch{Write-Warning ('FAIL_BARRIER_INCOMPLETE '+$_.Exception.Message)}
            # No repeated STOP of an already attempted generation; no start retry,
            # dependency rollback, force kill or assertion of quiescence on failure.
        }
        Write-ControlEvent $context 'FAIL' $message;throw
    }finally{$lock.Dispose()}
}
function Complete-ControlStart($Context,$World,[scriptblock]$Finalize){
    # Invoked before Invoke-ControlStack releases operation.lock; failure takes
    # the same maintenance/Disabled path as a start or initialization failure.
    Write-ControlEvent $Context 'FINAL_VALIDATION_BEGIN' $World.Generation
    $result=& $Finalize $World
    Require ($null -ne $result -and $result.Ready -is [bool] -and $result.Ready) 'FINAL_READINESS_FAILED'
    Require ($result.Services.Mangosd.Generation -ceq $World.Generation) 'FINAL_GENERATION_CHANGED'
    Write-ControlEvent $Context 'FINAL_VALIDATION_READY' $result
    return $result
}
Export-ModuleMember -Function New-ControlStore,Read-ControlState,Assert-PrivateControlPath,Invoke-ControlStack,Assert-DependencyStopResult

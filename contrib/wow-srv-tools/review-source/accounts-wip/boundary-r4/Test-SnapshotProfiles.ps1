. (Join-Path $PSScriptRoot 'Attempt.Journal.ps1')
$savedHost=(Get-Item Function:\Get-BoundaryHostSnapshot).ScriptBlock
$savedPool=(Get-Item Function:\Get-AppPoolProcessCandidates).ScriptBlock
$script:IisModel=Join-Path $script:HarnessRoot 'iis-config.synthetic.json'
[WowReleaseV1.Secure]::NewFile($script:IisModel,[Text.Encoding]::UTF8.GetBytes('{"windowsAuth":true,"idleTimeout":"00:20:00"}'),$false)
$script:GameGeneration='2026-10-27T10:00:00.0000000Z'
$script:CollectorGeneration='2026-10-27T10:00:00.0000000Z'
$script:PoolRows=@();$script:PoolFailure=$false
function Get-BoundaryHostSnapshot {
    [pscustomobject]@{Services=@([pscustomobject]@{Pid=44;CreatedUtc=$script:GameGeneration});Collector=[pscustomobject]@{Pid=55;CreatedUtc=$script:CollectorGeneration};ProtectedFiles=@(Get-ProtectedFilePin $script:IisModel)}
}
function Get-AppPoolProcessCandidates {if($script:PoolFailure){throw 'SYNTHETIC_OBSERVATION_FAILURE'};$script:PoolRows}
function PoolModel([int]$PoolPid=66,[string]$Created='2026-10-27T10:00:00.0000000Z'){
    return [pscustomobject]@{Pid=$PoolPid;Path='c:\windows\system32\inetsrv\w3wp.exe';CreatedUtc=$Created;UserSid='S-1-5-82-2192834305-681035450-1731772730-1791053079-2169464979'}
}
try{
    foreach($op in @('BootstrapUpdate','NativeVerify')){
        $script:PoolRows=@();$beforeMode=Snapshot -Operation $op -CollectorRoot $parent
        Case ($op+'_NO_W3WP_ACCEPTED') {Need ($beforeMode.Observations.AppPool.Workers.Count -eq 0 -and $null -eq $beforeMode.Invariant.RequiredAppPool) 'NO_POOL_MODEL';AssertSnapshotSame $beforeMode (Snapshot -Operation $op -CollectorRoot $parent)} $true
        $script:PoolRows=@(PoolModel)
        $withPool=Snapshot -Operation $op -CollectorRoot $parent
        Case ($op+'_W3WP_APPEARS_OBSERVATION_ONLY') {AssertSnapshotSame $beforeMode $withPool;Need ($withPool.Observations.AppPool.Workers.Count -eq 1) 'APPEARANCE_NOT_RECORDED'} $true
        $script:PoolRows=@()
        Case ($op+'_W3WP_EXITS_OBSERVATION_ONLY') {AssertSnapshotSame $withPool (Snapshot -Operation $op -CollectorRoot $parent)} $true
        $script:PoolRows=@(PoolModel 66 '2026-10-27T10:01:00.0000000Z')
        Case ($op+'_W3WP_REUSED_PID_IGNORED_ONLY_FOR_POOL') {AssertSnapshotSame $beforeMode (Snapshot -Operation $op -CollectorRoot $parent)} $true
        $script:PoolFailure=$true
        Case ($op+'_POOL_QUERY_ERROR_IS_RECORDED_NOT_REQUIRED') {$now=Snapshot -Operation $op -CollectorRoot $parent;Need (-not $now.Observations.AppPool.QuerySucceeded) 'MISSING_OBSERVATION_FAILURE';AssertSnapshotSame $beforeMode $now} $true
        $script:PoolFailure=$false
    }
    $script:PoolRows=@()
    Case 'FIXTURE_NO_W3WP_REFUSED' {Snapshot -Operation Fixture -CollectorRoot $parent} $false
    $wrong=PoolModel;$wrong.UserSid='S-1-5-18';$script:PoolRows=@($wrong)
    Case 'FIXTURE_WRONG_POOL_SID_REFUSED' {Snapshot -Operation Fixture -CollectorRoot $parent} $false
    $wrong=PoolModel;$wrong.Path='C:\synthetic-wrong.exe';$script:PoolRows=@($wrong)
    Case 'FIXTURE_WRONG_IMAGE_REFUSED' {Snapshot -Operation Fixture -CollectorRoot $parent} $false
    $script:PoolRows=@((PoolModel),(PoolModel 67))
    Case 'FIXTURE_AMBIGUOUS_PROPER_WORKER_REFUSED' {Snapshot -Operation Fixture -CollectorRoot $parent} $false
    $script:PoolRows=@(PoolModel);$fixtureBefore=Snapshot -Operation Fixture -CollectorRoot $parent
    Case 'FIXTURE_PROPER_WORKER_ACCEPTED' {AssertSnapshotSame $fixtureBefore (Snapshot -Operation Fixture -CollectorRoot $parent)} $true
    $script:PoolRows=@(PoolModel 66 '2026-10-27T10:02:00.0000000Z')
    Case 'FIXTURE_REUSED_PID_NEW_GENERATION_REFUSED' {AssertSnapshotSame $fixtureBefore (Snapshot -Operation Fixture -CollectorRoot $parent)} $false
    $script:PoolRows=@()
    Case 'FIXTURE_WORKER_EXIT_REFUSED' {Snapshot -Operation Fixture -CollectorRoot $parent} $false
    $other=PoolModel 99;$other.UserSid='S-1-5-18';$script:PoolRows=@((PoolModel),$other)
    Case 'FIXTURE_UNRELATED_POOL_APPEARANCE_ACCEPTED' {AssertSnapshotSame $fixtureBefore (Snapshot -Operation Fixture -CollectorRoot $parent)} $true
    $script:PoolRows=@(PoolModel)
    foreach($op in @('BootstrapUpdate','NativeVerify','Fixture')){
        $stable=Snapshot -Operation $op -CollectorRoot $parent
        $savedText=[IO.File]::ReadAllText($script:IisModel);$savedTime=(Get-Item $script:IisModel).LastWriteTimeUtc
        [WowReleaseV1.Secure]::Atomic($script:IisModel,'{"windowsAuth":false}',$false)
        Case ($op+'_PROTECTED_IIS_CONFIG_CHANGE_REFUSED') {AssertSnapshotSame $stable (Snapshot -Operation $op -CollectorRoot $parent)} $false
        [WowReleaseV1.Secure]::Atomic($script:IisModel,$savedText,$false);[IO.File]::SetLastWriteTimeUtc($script:IisModel,$savedTime)
        $oldAcl=Get-Acl $script:IisModel;$newAcl=Get-Acl $script:IisModel
        $newAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),[Security.AccessControl.FileSystemRights]::Read,'Allow'));Set-Acl -LiteralPath $script:IisModel -AclObject $newAcl
        Case ($op+'_PROTECTED_IIS_ACL_CHANGE_REFUSED') {AssertSnapshotSame $stable (Snapshot -Operation $op -CollectorRoot $parent)} $false
        Set-Acl -LiteralPath $script:IisModel -AclObject $oldAcl
        $script:GameGeneration='2026-10-27T10:03:00.0000000Z'
        Case ($op+'_GAME_REUSED_PID_GENERATION_REFUSED') {AssertSnapshotSame $stable (Snapshot -Operation $op -CollectorRoot $parent)} $false
        $script:GameGeneration='2026-10-27T10:00:00.0000000Z';$script:CollectorGeneration='2026-10-27T10:03:00.0000000Z'
        Case ($op+'_COLLECTOR_REUSED_PID_GENERATION_REFUSED') {AssertSnapshotSame $stable (Snapshot -Operation $op -CollectorRoot $parent)} $false
        $script:CollectorGeneration='2026-10-27T10:00:00.0000000Z'
    }
    foreach($op in @('BootstrapUpdate','NativeVerify','Fixture')){
        Case ($op+'_INITIAL_GUARD_FAILURE_HAS_DURABLE_CLAIM_AND_RESULT') {
            $root=Join-Path $script:HarnessRoot ('claim-'+$op)
            $journal=Begin-Attempt -Operation $op -Root $root -LogPath (Join-Path $script:HarnessRoot ($op+'.log')) -SourceScript $PSCommandPath
            $entered=$false;$failure=$null
            try{
                if($op -ceq 'Fixture'){$script:PoolRows=@();$null=Snapshot -Operation Fixture -CollectorRoot $parent}
                else{CheckPins @([pscustomobject]@{Path=$script:IisModel;Length=(Get-Item $script:IisModel).Length;SHA256=('0'*64)})}
                $entered=$true
            }catch{$failure=[pscustomobject]@{Stage='INITIAL_GUARDS';Message=$_.Exception.Message}}
            finally{Complete-Attempt $journal $false $failure @{OperationalBodyEntered=$entered}}
            $claim=JsonFile (Join-Path $root 'CLAIM.json');$r=JsonFile (Join-Path $root 'ATTEMPT-RESULT.json')
            Need (-not $entered -and -not $r.Ok -and $r.Failure.Stage -ceq 'INITIAL_GUARDS' -and $r.ClaimSHA256 -ceq (Hash (Join-Path $root 'CLAIM.json')) -and $r.AttemptId -ceq $claim.AttemptId -and $r.Operation -ceq $op) 'DURABLE_FAILURE_NOT_RECORDED'
            $claimHash=Hash (Join-Path $root 'CLAIM.json');$resultHash=Hash (Join-Path $root 'ATTEMPT-RESULT.json');$refused=$false
            try{$null=Begin-Attempt -Operation $op -Root $root -LogPath (Join-Path $script:HarnessRoot ($op+'-second.log')) -SourceScript $PSCommandPath}catch{$refused=$true}
            Need ($refused -and (Hash (Join-Path $root 'CLAIM.json')) -ceq $claimHash -and (Hash (Join-Path $root 'ATTEMPT-RESULT.json')) -ceq $resultHash -and -not (Test-Path (Join-Path $script:HarnessRoot ($op+'-second.log')))) 'SECOND_ATTEMPT_CHANGED_EVIDENCE'
        } $true
    }
    Case 'JOURNAL_SUCCESS_CAN_BE_INDEPENDENTLY_VERIFIED' {
        $root=Join-Path $script:HarnessRoot 'claim-success'
        $j=Begin-Attempt -Operation BootstrapUpdate -Root $root -LogPath (Join-Path $script:HarnessRoot 'success.log') -SourceScript $PSCommandPath
        Complete-Attempt $j $true $null @{SyntheticOnly=$true}
        $null=Assert-AttemptSuccess $root BootstrapUpdate
    } $true
    Case 'JOURNAL_LOG_INIT_REFUSAL_STILL_HAS_CLAIM_AND_RESULT' {
        $root=Join-Path $script:HarnessRoot 'claim-log-error';$failed=$false
        try{$null=Begin-Attempt -Operation BootstrapUpdate -Root $root -LogPath (Join-Path $script:HarnessRoot 'missing-parent\stage.log') -SourceScript $PSCommandPath}catch{$failed=$true}
        $r=JsonFile (Join-Path $root 'ATTEMPT-RESULT.json')
        Need ($failed -and -not $r.Ok -and $r.Failure.Stage -ceq 'JOURNAL_LOG_INIT' -and $r.ClaimSHA256 -ceq (Hash (Join-Path $root 'CLAIM.json'))) 'LOG_REFUSAL_LOST_EVIDENCE'
    } $true
    foreach($entry in @('Invoke-AccountsBoundary.ps1')){
        Case ('ENTRY_'+$entry+'_CLAIM_BEFORE_GUARDS_AND_COMPLETION_IN_FINALLY') {
            $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $entry),[ref]$tokens,[ref]$errors)
            $commands=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst]},$true))
            $begin=@($commands|Where-Object {$_.GetCommandName() -ceq 'Begin-Attempt'});$hostGuard=@($commands|Where-Object {$_.GetCommandName() -ceq 'CheckHost'})
            $pins=@($commands|Where-Object {$_.GetCommandName() -ceq 'CheckPayloadPins'})
            Need ($begin.Count -eq 1 -and $hostGuard.Count -eq 1 -and $begin[0].Extent.StartOffset -lt $hostGuard[0].Extent.StartOffset -and $begin[0].Extent.StartOffset -lt $pins[0].Extent.StartOffset) 'ENTRY_CLAIM_ORDER'
            $final=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.TryStatementAst] -and $null -ne $n.Finally -and $n.Finally.Extent.Text.Contains('Complete-Attempt')},$true))
            Need ($final.Count -eq 1) 'ENTRY_FINALIZATION_MISSING'
        } $true
    }
}finally{Set-Item Function:\Get-BoundaryHostSnapshot -Value $savedHost;Set-Item Function:\Get-AppPoolProcessCandidates -Value $savedPool}

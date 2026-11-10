Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Begin-Attempt {
    param([Parameter(Mandatory=$true)][ValidateSet('BootstrapUpdate','NativeVerify','Fixture')][string]$Operation,
        [Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$LogPath,[string]$SourceScript)
    Initialize-RegistrySecurity
    # Exclusive directory creation is the durable one-run reservation. An
    # existing attempt is never opened for write, repaired, deleted or resumed.
    [WowReleaseV1.Secure]::NewDirectory($Root,$false)
    $id=[Guid]::NewGuid().ToString('N')
    $claim=[pscustomobject]@{Schema='BOUNDARY-CLAIM-3';AttemptId=$id;Operation=$Operation;Root=$Root;SourceScript=$SourceScript;RequestedUtc=[DateTime]::UtcNow.ToString('o');Host=$env:COMPUTERNAME;ParentPid=$PID;ParentCreatedUtc=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToString('o')}
    [WowReleaseV1.Secure]::NewFile((Join-Path $Root 'CLAIM.json'),[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $claim -Depth 6)),$false)
    $attempt=[pscustomobject]@{Root=$Root;Id=$id;Operation=$Operation;LogPath=$LogPath;Writer=$null;ClaimSHA256=(Hash (Join-Path $Root 'CLAIM.json'));Completed=$false}
    try{
        [WowReleaseV1.Secure]::Canonical($LogPath)
        $security=[Security.AccessControl.FileSecurity]::new()
        $security.SetSecurityDescriptorSddlForm('D:P(A;;FA;;;SY)(A;;FA;;;BA)')
        $stream=[IO.FileStream]::new($LogPath,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough,$security)
        $attempt.Writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false));$attempt.Writer.AutoFlush=$true
        Write-AttemptLog $attempt ('CLAIMED=True OPERATION='+$Operation+' ATTEMPT='+$id+' ROOT='+$Root)
        return $attempt
    }catch{
        $errorInfo=[pscustomobject]@{Stage='JOURNAL_LOG_INIT';Message=$_.Exception.Message;Line=$_.InvocationInfo.ScriptLineNumber}
        Complete-Attempt $attempt $false $errorInfo @{OperationalBodyEntered=$false}
        throw
    }
}
function Write-AttemptLog($Attempt,[string]$Message){
    Need ($Message.Length -le 16384) 'AUDIT_FIELD_LIMIT'
    $line=[DateTimeOffset]::Now.ToString('o')+' '+$Message
    if($null -ne $Attempt.Writer){$Attempt.Writer.WriteLine($line);$Attempt.Writer.Flush()}
    Write-Host $line
}
function Complete-Attempt($Attempt,[bool]$Ok,$Failure,$Details){
    Need (-not $Attempt.Completed) 'ATTEMPT_ALREADY_FINALIZED'
    $logError=$null
    try{Write-AttemptLog $Attempt ('COMPLETED=True OK='+$Ok+' RETRY=False')}
    catch{$Ok=$false;$logError=$_.Exception.Message}
    finally{if($null -ne $Attempt.Writer){try{$Attempt.Writer.Dispose()}catch{$Ok=$false;$logError=$_.Exception.Message};$Attempt.Writer=$null}}
    $record=[pscustomobject]@{Schema='BOUNDARY-ATTEMPT-RESULT-3';AttemptId=$Attempt.Id;Operation=$Attempt.Operation;Root=$Attempt.Root;Ok=$Ok;Failure=$Failure;Details=$Details;ClaimSHA256=$Attempt.ClaimSHA256;LogPath=$Attempt.LogPath;LogSHA256=$(if(Test-Path -LiteralPath $Attempt.LogPath){Hash $Attempt.LogPath}else{$null});LogError=$logError;CompletedUtc=[DateTime]::UtcNow.ToString('o');Retry=$false}
    [WowReleaseV1.Secure]::NewFile((Join-Path $Attempt.Root 'ATTEMPT-RESULT.json'),[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $record -Depth 16)),$false)
    $Attempt.Completed=$true
    Need ($record.Ok -eq $Ok) 'ATTEMPT_RESULT_CONSISTENCY'
    if(-not $Ok -and $null -eq $Failure){throw 'FINALIZATION_FAILED_REVIEW_ATTEMPT_RESULT'}
}
function Assert-AttemptSuccess([string]$Root,[string]$Operation){
    Initialize-RegistrySecurity
    [WowReleaseV1.Secure]::Verify($Root,$true,$false)
    foreach($name in @('CLAIM.json','ATTEMPT-RESULT.json')){[WowReleaseV1.Secure]::Verify((Join-Path $Root $name),$false,$false)}
    $claim=JsonFile (Join-Path $Root 'CLAIM.json');$result=JsonFile (Join-Path $Root 'ATTEMPT-RESULT.json')
    Need ($claim.Schema -ceq 'BOUNDARY-CLAIM-3' -and $result.Schema -ceq 'BOUNDARY-ATTEMPT-RESULT-3' -and $result.Ok -and
        $claim.Operation -ceq $Operation -and $result.Operation -ceq $Operation -and $claim.Root -ceq $Root -and $result.Root -ceq $Root -and
        $claim.AttemptId -ceq $result.AttemptId -and $result.ClaimSHA256 -ceq (Hash (Join-Path $Root 'CLAIM.json')) -and
        $null -eq $result.Failure -and $null -eq $result.LogError -and $result.LogSHA256 -ceq (Hash $result.LogPath)) 'ATTEMPT_NOT_VERIFIED_SUCCESS'
    return $result
}

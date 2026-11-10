Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!('AfterBootRepairR2.Native' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'Repair.Native.cs')}
$script:CollectorReadTraceR2=$null
function Write-ReadTraceR2($Value){if($script:CollectorReadTraceR2){[IO.File]::AppendAllText($script:CollectorReadTraceR2,((ConvertTo-Json -InputObject $Value -Compress -Depth 8)+"`r`n"),[Text.UTF8Encoding]::new($false))}}
function Read-SecurePublicationR2([string]$Path,[bool]$Telemetry){
    [WowReleaseV1.Secure]::Verify($Path,$false,$Telemetry)
    $cap=131072;if($Telemetry){$cap=32768}
    $bytes=[AfterBootRepairR2.Native]::ReadPublication($Path,$cap)
    [WowReleaseV1.Secure]::Verify($Path,$false,$Telemetry)
    $json=[Text.UTF8Encoding]::new($false,$true).GetString($bytes).TrimStart([char]0xFEFF)
    [WowReleaseV1.JsonKeys]::Check($json)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','')}finally{$sha.Dispose()}
    [pscustomobject]@{Value=($json|ConvertFrom-Json);SHA256=$hash}
}
function Read-CollectorPairR2($Context,[ValidateRange(50,2000)][int]$TimeoutMilliseconds=2000){
    $timer=[Diagnostics.Stopwatch]::StartNew();$attempt=0;$lastCode=$null
    while($true){
        $attempt++;$transient=$false
        try{
            $state1=Read-SecurePublicationR2 (Join-Path $Context.Root 'state.json') $false
            $receipt1=Read-SecurePublicationR2 (Join-Path $Context.Root 'last-sample.json') $false
            $snapshot=Read-SecurePublicationR2 $Context.Snapshot $true
            $receipt2=Read-SecurePublicationR2 (Join-Path $Context.Root 'last-sample.json') $false
            $state2=Read-SecurePublicationR2 (Join-Path $Context.Root 'state.json') $false
            $sameState=(ConvertTo-Json -InputObject $state1.Value -Depth 15 -Compress) -ceq (ConvertTo-Json -InputObject $state2.Value -Depth 15 -Compress)
            $sameReceipt=(ConvertTo-Json -InputObject $receipt1.Value -Depth 15 -Compress) -ceq (ConvertTo-Json -InputObject $receipt2.Value -Depth 15 -Compress)
            if($sameState -and $sameReceipt -and $snapshot.SHA256 -ceq $receipt1.Value.snapshotSHA256){
                Write-ReadTraceR2 @{Event='COHERENT_READ';Attempts=$attempt;ElapsedMs=$timer.ElapsedMilliseconds;SnapshotSHA256=$snapshot.SHA256}
                return [pscustomobject]@{State=$state1.Value;Receipt=$receipt1.Value;Sample=$snapshot.Value;Consistent=$true}
            }
            $transient=$true;$lastCode='PUBLICATION_PAIR_CHANGED'
        }catch{
            $exception=$_.Exception;$collision=$false
            while($null -ne $exception){
                if($exception -is [IO.IOException] -and (($exception.HResult -band 0xffff) -in @(32,33))){$collision=$true;$lastCode='WIN32_'+($exception.HResult -band 0xffff);break}
                $exception=$exception.InnerException
            }
            if(!$collision){throw};$transient=$true
        }
        if($transient){
            Write-ReadTraceR2 @{Event='TRANSIENT_READ_COLLISION';Code=$lastCode;Attempt=$attempt;ElapsedMs=$timer.ElapsedMilliseconds;Snapshot=$Context.Snapshot}
            if($timer.ElapsedMilliseconds -ge $TimeoutMilliseconds){throw ('COLLECTOR_READ_TRANSIENT_TIMEOUT code='+$lastCode+' elapsedMs='+$timer.ElapsedMilliseconds)}
            Start-Sleep -Milliseconds ([int][Math]::Min(25,[Math]::Max(1,$TimeoutMilliseconds-$timer.ElapsedMilliseconds)))
        }
    }
}

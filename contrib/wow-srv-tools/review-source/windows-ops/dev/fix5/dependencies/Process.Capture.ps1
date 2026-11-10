Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if(!('AfterBootRepairR2.Native' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'Repair.Native.cs')}
function Invoke-CapturedProcessR2([string]$Executable,[string]$Arguments,[string]$EvidenceBase,[int]$TimeoutMilliseconds=1800000){
    $record=[ordered]@{State='LAUNCH_ERROR';Started=$false;ExitCode=$null;StreamsCaptured=$false;PID=$null;CreatedUtc=$null;Executable=$Executable;Arguments=$Arguments;At=[DateTimeOffset]::UtcNow.ToString('o');Error=$null;Stdout=$EvidenceBase+'.stdout.log';Stderr=$EvidenceBase+'.stderr.log'}
    $p=[Diagnostics.Process]::new();$started=$false;$stdoutTask=$null;$stderrTask=$null
    [IO.File]::WriteAllText($record.Stdout,'');[IO.File]::WriteAllText($record.Stderr,'')
    try{
        $p.StartInfo=[Diagnostics.ProcessStartInfo]::new();$p.StartInfo.FileName=$Executable;$p.StartInfo.Arguments=$Arguments;$p.StartInfo.WorkingDirectory='C:\GRY'
        $p.StartInfo.UseShellExecute=$false;$p.StartInfo.CreateNoWindow=$true;$p.StartInfo.RedirectStandardOutput=$true;$p.StartInfo.RedirectStandardError=$true
        if(!$p.Start()){throw 'Process.Start returned false'}
        $started=$true;$record.Started=$true;$record.State='EXIT_NOT_MEASURED';$record.PID=$p.Id
        $retainedHandle=$p.Handle
        $record.CreatedUtc=$p.StartTime.ToUniversalTime().ToString('o')
        $stdoutTask=$p.StandardOutput.ReadToEndAsync();$stderrTask=$p.StandardError.ReadToEndAsync()
        if(!$p.WaitForExit($TimeoutMilliseconds)){throw 'Process wait timeout; no kill and no automatic retry'}
        $p.WaitForExit()
        [uint32]$exit=0
        if(![AfterBootRepairR2.Native]::GetExitCodeProcess($retainedHandle,[ref]$exit)){throw ('GetExitCodeProcess error='+[Runtime.InteropServices.Marshal]::GetLastWin32Error())}
        $record.ExitCode=[long]$exit
        $record.State='EXECUTED_FAIL';if($exit -eq 0){$record.State='EXECUTED_PASS'}
        [IO.File]::WriteAllText($record.Stdout,$stdoutTask.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true))
        [IO.File]::WriteAllText($record.Stderr,$stderrTask.GetAwaiter().GetResult(),[Text.UTF8Encoding]::new($true))
        $record.StreamsCaptured=$true
    }catch{
        $record.Error=$_.Exception.ToString()
        if($started -and $null -eq $record.ExitCode){$record.State='EXIT_NOT_MEASURED'}
        if($null -ne $stdoutTask -and $stdoutTask.IsCompleted){[IO.File]::WriteAllText($record.Stdout,$stdoutTask.GetAwaiter().GetResult())}
        if($null -ne $stderrTask -and $stderrTask.IsCompleted){[IO.File]::WriteAllText($record.Stderr,$stderrTask.GetAwaiter().GetResult())}
    }finally{
        $record['CompletedUtc']=[DateTimeOffset]::UtcNow.ToString('o')
        try{[IO.File]::WriteAllText(($EvidenceBase+'.process.json'),(ConvertTo-Json -InputObject $record -Depth 10),[Text.UTF8Encoding]::new($true))}finally{$p.Dispose()}
    }
    [pscustomobject]$record
}

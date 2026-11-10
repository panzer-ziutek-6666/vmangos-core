Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Assert-WorldServiceCommand([string]$Command,[string]$RuntimeRoot='C:\GRY\wow\serwer-dev'){
    $exe=Join-Path $RuntimeRoot 'mangosd.exe';$conf=Join-Path $RuntimeRoot 'mangosd.conf'
    $allowed=@(($exe+' -s run -c '+$conf),('"'+$exe+'" -s run -c '+$conf),($exe+' -s run -c "'+$conf+'"'),('"'+$exe+'" -s run -c "'+$conf+'"'))
    if($Command -notin $allowed){throw 'WORLD_SERVICE_IMAGEPATH'}
}
function New-ProductionWorldDriver {
    param([string]$LogPath='C:\GRY\wow\serwer-dev\logs\Server.log',[hashtable]$ReadTransport,[string]$ObservationLog,[string]$RuntimeRoot='C:\GRY\wow\serwer-dev',[hashtable]$MaintenanceScope)
    $runtime=$RuntimeRoot;$expected=Join-Path $runtime 'mangosd.exe';$markerReader=${function:Get-WorldMarkers};$commandCheck={param($command)Assert-WorldServiceCommand $command $runtime}.GetNewClosure()
    if($null -eq $MaintenanceScope){$MaintenanceScope=@{Operation=$null;Action=$null;Root=$null;Permit=$null;StartAuthorized=$false}}
    if(!$MaintenanceScope.ContainsKey('OuterRetainedCoordinator')){$MaintenanceScope.OuterRetainedCoordinator=$false}
    $script:ProductionMaintenanceScopeFix4=$MaintenanceScope
    if([string]::IsNullOrWhiteSpace($ObservationLog)){$ObservationLog=Join-Path 'C:\GRY\wow\diagnostics' ('ADMIN-CONTROL-PRODUCTION-READ-'+[DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')+'-'+$PID+'-'+[guid]::NewGuid().ToString('N')+'.jsonl')}
    if($null -eq $ReadTransport){
        $readRaw={
            $first=Get-CimInstance Win32_Service -Filter "Name='mangosd'" -ErrorAction Stop
            $processes=@(Get-CimInstance Win32_Process -Filter "Name='mangosd.exe'" -ErrorAction Stop|ForEach-Object {[pscustomobject]@{ProcessId=$_.ProcessId;ExecutablePath=$_.ExecutablePath;CreationDate=$_.CreationDate}})
            $second=Get-CimInstance Win32_Service -Filter "Name='mangosd'" -ErrorAction Stop
            [pscustomobject]@{Before=$(if($null -ne $first){$first|Select-Object Name,State,ProcessId,PathName,StartMode,ExitCode,ServiceSpecificExitCode}else{$null});Processes=$processes;After=$(if($null -ne $second){$second|Select-Object Name,State,ProcessId,PathName,StartMode,ExitCode,ServiceSpecificExitCode}else{$null})}
        }
        $readPause={param($milliseconds)Start-Sleep -Milliseconds $milliseconds}
    }else{
        if(!$ReadTransport.ContainsKey('Snapshot') -or !$ReadTransport.ContainsKey('Pause')){throw 'READ_TRANSPORT_CONTRACT'}
        $readRaw=$ReadTransport.Snapshot;$readPause=$ReadTransport.Pause
    }
    $writeOperands={param($value)
        $bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $value -Depth 15 -Compress)+"`r`n")
        $stream=[IO.FileStream]::new($ObservationLog,[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough)
        try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    }.GetNewClosure()
    @{
        Read={
            $seenGeneration=$null
            for($attempt=1;$attempt -le 5;$attempt++){
                $raw=$null;$queryFailure=$null
                try{$raw=& $readRaw}catch{$queryFailure=$_.Exception.Message}
                # Persist every operand BEFORE classification, including null/error values.
                & $writeOperands @{Utc=[DateTimeOffset]::UtcNow.ToString('o');Event='RAW_BEFORE_CLASSIFICATION';Attempt=$attempt;ExpectedImage=$expected;Raw=$raw;QueryFailure=$queryFailure}
                $reason=$null;$number=0;$created=$null;$generation=$null
                if($null -ne $queryFailure -or $null -eq $raw){$reason='CIM_QUERY_INCOMPLETE'}
                else{
                    $rows=@($raw.Processes)
                    if($rows.Count -gt 1){throw 'MULTIPLE_WORLD_PROCESSES'}
                    foreach($process in $rows){if(![string]::IsNullOrWhiteSpace([string]$process.ExecutablePath) -and $process.ExecutablePath -ine $expected){throw 'WORLD_PROCESS_FOREIGN_IMAGE'}}
                    if($null -eq $raw.Before -or $null -eq $raw.After -or [string]::IsNullOrWhiteSpace($raw.Before.PathName) -or [string]::IsNullOrWhiteSpace($raw.After.PathName) -or $null -eq $raw.Before.ProcessId -or $null -eq $raw.After.ProcessId){$reason='SERVICE_METADATA_MISSING'}
                    else{
                        $svc=$raw.After;& $commandCheck $raw.Before.PathName;& $commandCheck $svc.PathName
                        if($raw.Before.Name -cne 'mangosd' -or $svc.Name -cne 'mangosd'){throw 'WORLD_SERVICE_NAME'}
                        $number=[int]$svc.ProcessId
                        if($rows.Count -eq 1){
                            $process=$rows[0]
                            if([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath) -or $null -eq $process.CreationDate -or $process.ProcessId -le 0){$reason='PROCESS_METADATA_MISSING'}
                            else{
                                try{$created=$process.CreationDate.ToUniversalTime().ToString('o')}catch{$reason='PROCESS_CREATION_METADATA_INVALID'}
                                if($null -eq $reason){
                                    $observed=[string]$process.ProcessId+'|'+$created
                                    if($null -ne $seenGeneration -and $seenGeneration -cne $observed){throw 'WORLD_GENERATION_CHANGED_DURING_OBSERVATION'}
                                    $seenGeneration=$observed
                                    if($number -le 0 -or $number -ne $process.ProcessId -or $svc.State -ceq 'Stopped'){$reason='SCM_PROCESS_PID_INCOHERENT'}else{$generation=$observed}
                                }
                            }
                        }elseif($number -ne 0 -or $svc.State -cne 'Stopped'){$reason='SCM_PROCESS_ABSENCE_NOT_CONFIRMED'}
                        if($raw.Before.ProcessId -ne $svc.ProcessId -or $raw.Before.State -cne $svc.State -or $raw.Before.StartMode -cne $svc.StartMode){$reason='SCM_CHANGED_DURING_CIM_OBSERVATION'}
                        $states=@{Stopped=1;StartPending=2;StopPending=3;'Start Pending'=2;'Stop Pending'=3;Running=4};$startTypes=@{Manual=3;Disabled=4}
                        if(!$states.ContainsKey([string]$svc.State)){throw 'WORLD_SERVICE_STATE'}
                        if(!$startTypes.ContainsKey([string]$svc.StartMode)){throw 'UNAPPROVED_WORLD_STARTTYPE'}
                        if($null -eq $reason){
                            $resultKnown=$true;$codes=@{}
                            foreach($field in @('ExitCode','ServiceSpecificExitCode')){
                                $property=$svc.PSObject.Properties[$field]
                                $v=$null;if($null -ne $property){$v=$property.Value}
                                if($null -eq $v -or ($v -isnot [int] -and $v -isnot [uint32] -and $v -isnot [long] -and $v -isnot [uint64]) -or $v -lt 0 -or $v -gt [uint32]::MaxValue){$resultKnown=$false;$codes[$field]=$null}else{$codes[$field]=[long]$v}
                            }
                            # Observation preserves history. Action/generation policy belongs to Maintenance.
                            $snapshot=[pscustomobject]@{ResultKnown=$resultKnown;Win32ExitCode=$codes.ExitCode;SpecificExitCode=$codes.ServiceSpecificExitCode;Service='mangosd';State=$states[[string]$svc.State];Pid=$number;CreatedUtc=$created;Generation=$generation;StartType=$startTypes[[string]$svc.StartMode]}
                            & $writeOperands @{Utc=[DateTimeOffset]::UtcNow.ToString('o');Event='CLASSIFIED_CONFIRMED';Attempt=$attempt;Snapshot=$snapshot}
                            return $snapshot
                        }
                    }
                }
                & $writeOperands @{Utc=[DateTimeOffset]::UtcNow.ToString('o');Event='AMBIGUOUS_REOBSERVE';Attempt=$attempt;Reason=$reason;NoStopOrReadyInferred=$true}
                if($attempt -lt 5){& $readPause 200}
            }
            throw 'WORLD_OBSERVATION_AMBIGUOUS_BUDGET_EXHAUSTED'
        }.GetNewClosure()
        AuthorizeMaintenance={param($ctx,$before,$state)Set-WorldMaintenancePermitFix4 $MaintenanceScope $ctx $before $state $runtime}.GetNewClosure()
        AuthorizeStart={param($ctx,$state)Set-WorldStartPermitFix4 $MaintenanceScope $ctx $state}.GetNewClosure()
        Disable={ $code=Invoke-WorldScmFix4 @('config','mangosd','start=','disabled');if($code -ne 0){throw ('SCM_DISABLE_ERROR '+$code)} }.GetNewClosure()
        Demand={ if(!$MaintenanceScope.StartAuthorized){throw 'WORLD_DEMAND_NOT_AUTHORIZED'};$code=Invoke-WorldScmFix4 @('config','mangosd','start=','demand');if($code -ne 0){throw ('SCM_DEMAND_ERROR '+$code)};$MaintenanceScope.Permit=$null;$MaintenanceScope.StartAuthorized=$false }.GetNewClosure()
        Start={ return [int](Invoke-WorldScmFix4 @('start','mangosd')) }.GetNewClosure()
        Stop={ Invoke-WorldStopFix4 $MaintenanceScope }.GetNewClosure()
        DeferStopWait={param($ctx)Assert-OuterStopCoordinatorFix5 $MaintenanceScope $ctx}.GetNewClosure()
        Ready={param($snapshot)
            $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -in @(8085,7878))
            foreach($port in @(8085,7878)){
                $rows=@($listeners|Where-Object LocalPort -eq $port);if($rows.Count -eq 0){return $false}
                if(@($rows|Where-Object OwningProcess -ne $snapshot.Pid).Count){throw 'WORLD_PORT_OWNER'}
                if($port -eq 7878 -and @($rows|Where-Object LocalAddress -NotIn @('127.0.0.1','::1')).Count){throw 'SOAP_NOT_LOOPBACK'}
            }
            $markers=& $markerReader $LogPath ([DateTime]::Parse($snapshot.CreatedUtc).ToUniversalTime())
            if($markers.Failure){throw 'WORLD_LOG_FAILURE'}
            return ($null -ne $markers.StartUtc -and $null -ne $markers.ReadyUtc -and $markers.ReadyLine -gt $markers.StartLine)
        }.GetNewClosure()
    }
}

# CIM uses whole microseconds. Normalize only CIM<->API identity; retain full API ticks.
function New-ProcessIdentityTransportFix2 {
 @{
  Open={param($Number)[Diagnostics.Process]::GetProcessById([int]$Number)}
  Read={param($Process)
   $handle=$Process.Handle;$exitedBefore=$Process.HasExited
   $id=$Process.Id;$path=$Process.MainModule.FileName;$created=$Process.StartTime.ToUniversalTime()
   [pscustomobject]@{Handle=$handle;PID=$id;Path=$path;StartUtc=$created;ExitedBefore=$exitedBefore;ExitedAfter=$Process.HasExited}
  }
  Dispose={param($Process)$Process.Dispose()}
 }
}
function Convert-CimProcessRowsFix2($Rows) {
 Need ($null -ne $Rows -and $Rows -is [array]) 'IDENTITY_CIM_ROWS_MISSING'
 $seen=[Collections.Generic.HashSet[int]]::new();$result=[Collections.Generic.List[object]]::new()
 foreach($row in $Rows){
  Need ($null -ne $row) 'IDENTITY_CIM_ROW_NULL'
  foreach($key in @('PID','Path','CreatedUtc')){Need ($null -ne $row.PSObject.Properties[$key] -and $null -ne $row.$key) ('IDENTITY_CIM_MISSING_'+$key)}
  $n=$row.PID
  Need (($n -is [int] -or $n -is [uint32] -or $n -is [long] -or $n -is [uint64]) -and $n -gt 0 -and $n -le [int]::MaxValue) 'IDENTITY_CIM_PID'
  Need ($seen.Add([int]$n)) 'IDENTITY_CIM_DUPLICATE_PID'
  Need ($row.Path -is [string] -and ![string]::IsNullOrWhiteSpace($row.Path) -and [IO.Path]::IsPathRooted($row.Path) -and !$row.Path.StartsWith('\\') -and [IO.Path]::GetFullPath($row.Path) -ieq $row.Path) 'IDENTITY_CIM_PATH'
  Need ($row.CreatedUtc -is [string] -and $row.CreatedUtc -cmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}(Z|\+00:00)$') 'IDENTITY_CIM_UTC_FORMAT'
  $created=[DateTimeOffset]::ParseExact($row.CreatedUtc,'o',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None).UtcDateTime
  $remainder=[long]0;[void][Math]::DivRem([long]$created.Ticks,[long]10,[ref]$remainder)
  Need ($remainder -eq 0) 'IDENTITY_CIM_NOT_WHOLE_MICROSECOND'
  $result.Add([pscustomobject]@{PID=[int]$n;Path=[string]$row.Path;CreatedUtc=$created.ToString('o');CimTicks=[long]$created.Ticks})
 }
 return ,$result.ToArray()
}
function Assert-CimProcessSetFix2($Expected,[scriptblock]$ReadCurrent) {
 $observations=@(& $ReadCurrent)
 Need ($observations.Count -eq 1 -and $null -ne $observations[0] -and $null -ne $observations[0].PSObject.Properties['Processes']) 'IDENTITY_REOBSERVATION_MISSING'
 $actual=Convert-CimProcessRowsFix2 $observations[0].Processes
 Need ($actual.Count -eq $Expected.Count) 'IDENTITY_CIM_SET_CHANGED'
 foreach($p in $Expected){
  $matching=@($actual|Where-Object {$_.PID -eq $p.PID})
  Need ($matching.Count -eq 1 -and [string]::Equals($matching[0].Path,$p.Path,[StringComparison]::OrdinalIgnoreCase) -and $matching[0].CimTicks -eq $p.CimTicks) 'IDENTITY_CIM_GENERATION_CHANGED'
 }
}
function Read-ProcessIdentityApiFix2($Process,$Transport) {
 $values=@(& $Transport.Read $Process)
 Need ($values.Count -eq 1 -and $null -ne $values[0]) 'IDENTITY_API_RESULT_MISSING'
 $a=$values[0]
 foreach($key in @('Handle','PID','Path','StartUtc','ExitedBefore','ExitedAfter')){Need ($null -ne $a.PSObject.Properties[$key] -and $null -ne $a.$key) ('IDENTITY_API_MISSING_'+$key)}
 Need ($a.Handle -is [IntPtr] -and $a.Handle -ne [IntPtr]::Zero -and $a.Handle -ne [IntPtr]::new(-1)) 'IDENTITY_API_HANDLE'
 Need (($a.PID -is [int] -or $a.PID -is [uint32] -or $a.PID -is [long] -or $a.PID -is [uint64]) -and $a.PID -gt 0 -and $a.PID -le [int]::MaxValue) 'IDENTITY_API_PID'
 Need ($a.Path -is [string] -and ![string]::IsNullOrWhiteSpace($a.Path)) 'IDENTITY_API_PATH'
 Need ($a.StartUtc -is [DateTime] -and $a.StartUtc.Kind -eq [DateTimeKind]::Utc) 'IDENTITY_API_UTC'
 Need ($a.ExitedBefore -is [bool] -and !$a.ExitedBefore -and $a.ExitedAfter -is [bool] -and !$a.ExitedAfter) 'IDENTITY_PROCESS_EXITED_DURING_CHECK'
 return $a
}
function Close-VerifiedProcessSetFix2($Lease) {
 if($null -eq $Lease -or $Lease.Closed){return}
 $Lease.Closed=$true;$errors=[Collections.Generic.List[string]]::new()
 foreach($item in $Lease.Records){try{[void](& $Lease.Transport.Dispose $item.Process)}catch{$errors.Add($_.Exception.Message)}}
 Need ($errors.Count -eq 0) ('IDENTITY_DISPOSE_FAILED '+($errors -join '|'))
}
function Assert-VerifiedProcessSetFix2($Lease,[scriptblock]$ReadCurrent) {
 Need ($null -ne $Lease -and !$Lease.Closed) 'IDENTITY_LEASE_CLOSED'
 Assert-CimProcessSetFix2 $Lease.Expected $ReadCurrent
 foreach($item in $Lease.Records){
  $a=Read-ProcessIdentityApiFix2 $item.Process $Lease.Transport
  # API<->API stays exact.
  Need ($a.PID -eq $item.PID -and [string]::Equals($a.Path,$item.Path,[StringComparison]::OrdinalIgnoreCase) -and $a.StartUtc.Ticks -eq $item.ApiCreatedTicks -and $a.Handle -eq $item.Handle) 'IDENTITY_API_GENERATION_CHANGED'
 }
 Assert-CimProcessSetFix2 $Lease.Expected $ReadCurrent
}
function Open-VerifiedProcessSetFix2($ExpectedRows,[scriptblock]$ReadCurrent) {
 $expected=Convert-CimProcessRowsFix2 $ExpectedRows
 $transport=New-ProcessIdentityTransportFix2
 foreach($key in @('Open','Read','Dispose')){Need ($transport.ContainsKey($key) -and $transport[$key] -is [scriptblock]) 'IDENTITY_TRANSPORT'}
 $records=[Collections.Generic.List[object]]::new();$success=$false
 $lease=[pscustomobject]@{Records=$records;Expected=$expected;Transport=$transport;Closed=$false}
 try{
  Assert-CimProcessSetFix2 $expected $ReadCurrent
  foreach($p in $expected){
   Assert-CimProcessSetFix2 $expected $ReadCurrent
   $native=$null;$added=$false
   try{
    $objects=@(& $transport.Open $p.PID);Need ($objects.Count -eq 1 -and $null -ne $objects[0]) 'IDENTITY_OPEN_RESULT'
    $native=$objects[0];$a=Read-ProcessIdentityApiFix2 $native $transport
    $remainder=[long]0;[void][Math]::DivRem([long]$a.StartUtc.Ticks,[long]10,[ref]$remainder)
    Need ($a.PID -eq $p.PID -and [string]::Equals($a.Path,$p.Path,[StringComparison]::OrdinalIgnoreCase) -and ([long]$a.StartUtc.Ticks-$remainder) -eq $p.CimTicks) 'IDENTITY_CIM_API_GENERATION_CHANGED'
    $records.Add([pscustomobject]@{Process=$native;Handle=$a.Handle;PID=$p.PID;Path=$p.Path;CreatedUtc=$p.CreatedUtc;CimCreatedUtc=$p.CreatedUtc;ApiCreatedUtc=$a.StartUtc.ToString('o');ApiCreatedTicks=[long]$a.StartUtc.Ticks})
    $added=$true
   }finally{if(!$added -and $null -ne $native){[void](& $transport.Dispose $native)}}
   Assert-CimProcessSetFix2 $expected $ReadCurrent
  }
  Assert-VerifiedProcessSetFix2 $lease $ReadCurrent
  $success=$true
  return $lease
 }finally{if(!$success){Close-VerifiedProcessSetFix2 $lease}}
}
# FIX3 shared observation/journal/retained-stop support. No top-level control.
function Invoke-WorldScmFix4([string[]]$Tokens){
 $text=@(& 'C:\Windows\System32\sc.exe' @Tokens 2>&1);return [int]$LASTEXITCODE
}
function Invoke-WorldStopFix4($Scope){
 $request={ $code=Invoke-WorldScmFix4 @('stop','mangosd');if($code -ne 0){throw ('SCM_STOP_ERROR '+$code)} }
 if($Scope.OuterRetainedCoordinator){[void](& $request);return}
 # Standalone Maintenance also retains the actual world handle; never infer it from SCM0.
 $definition=Get-BackendStopDefinitionFix3 'mangosd'
 Assert-StopFix3 (Test-WorldMaintenancePermitFix4 $definition) 'WORLD_STOP_MAINTENANCE_AUTHORIZATION_REQUIRED'
 $strict={param($j)Get-BackendStopObservation 'mangosd' -Journal $j}
 $transition={param($j,$expected)Get-BackendStopObservation 'mangosd' -Transition -Expected $expected -Journal $j}
 $timeout=180;if($Scope.ContainsKey('StopTimeoutSeconds')){$timeout=[int]$Scope.StopTimeoutSeconds}
 $result=Invoke-RetainedStopFix3 'mangosd' $strict $transition $request {} $definition.EvidenceBase (Join-Path $definition.EvidenceBase 'mangosd-DRIVER-STOP.json') $timeout
 $p=$Scope.Permit
 Assert-StopFix3 (@($result.ProcessExits).Count -eq 1 -and $result.ProcessExits[0].PID -eq $p.PID -and ([DateTimeOffset]::Parse($result.ProcessExits[0].CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks -and $result.ProcessExits[0].Measurement -ceq 'MEASURED' -and $null -ne $result.ProcessExits[0].NativeExit -and $result.ProcessExits[0].NativeExit -eq 0) 'WORLD_DRIVER_NATIVE_PROOF_REQUIRED'
 $p.Completion=[pscustomobject]@{Result='PASS';ProcessExits=$result.ProcessExits;AtUtc=$result.AtUtc;Outcome=$result}
}
function Set-WorldMaintenancePermitFix4($Scope,$Context,$Before,$State,[string]$Runtime){
 Assert-StopFix3 ($Context.Service -ceq 'mangosd' -and $Context.Operation -cmatch '^[a-fA-F0-9]{32}$' -and $Context.Action -cin @('Migrate','Lifecycle','Rollback','Stop-All','Restart-World','Planned-Reboot','Start-All')) 'MAINTENANCE_OPERATION_REQUIRED'
 if($null -ne $Scope.Operation){Assert-StopFix3 ($Scope.Operation -ceq $Context.Operation -and $Scope.Action -ceq $Context.Action -and $Scope.Root -ceq $Context.Root) 'MAINTENANCE_SCOPE_MISMATCH'}
 $Scope.Operation=$Context.Operation;$Scope.Action=$Context.Action;$Scope.Root=$Context.Root;$Scope.StartAuthorized=$false
 $Scope.StopTimeoutSeconds=[Math]::Min(180,[int]$Context.Timeout)
 $Scope.Permit=$null
 # No permit is minted for a pre-existing Disabled/unknown generation or a boot skip.
 if($Before.State -ne 4 -or $Before.StartType -ne 3 -or $Before.Pid -le 0 -or $Context.Action -ceq 'Start-All'){return}
 Assert-StopFix3 ($State.Phase -ceq 'Maintenance' -and $State.Service -ceq 'mangosd' -and $State.Generation -ceq $Before.Generation -and $State.Sequence -gt 0) 'MAINTENANCE_DURABLE_BINDING'
 $Scope.Permit=[pscustomobject]@{Operation=$Context.Operation;Action=$Context.Action;Root=$Context.Root;Name='mangosd';Exe=(Join-Path $Runtime 'mangosd.exe');Config=(Join-Path $Runtime 'mangosd.conf');Generation=$Before.Generation;PID=$Before.Pid;CreatedUtc=$Before.CreatedUtc;Sequence=[long]$State.Sequence;Intent=$State.Intent;Completion=$null;SourceOperation=$Context.Operation}
}
function Set-WorldStartPermitFix4($Scope,$Context,$State){
 Assert-StopFix3 ($Context.Service -ceq 'mangosd' -and $Context.Operation -cmatch '^[a-fA-F0-9]{32}$' -and $State.Phase -ceq 'Starting' -and $State.Service -ceq 'mangosd' -and $State.Intent -cin @('ExplicitAdministratorStart','BootFromStable')) 'WORLD_CONTROLLED_START_REQUIRED'
 if($null -ne $Scope.Operation){Assert-StopFix3 ($Scope.Operation -ceq $Context.Operation -and $Scope.Action -ceq $Context.Action -and $Scope.Root -ceq $Context.Root) 'WORLD_START_SCOPE_MISMATCH'}
 $Scope.Operation=$Context.Operation;$Scope.Action=$Context.Action;$Scope.Root=$Context.Root;$Scope.StartAuthorized=$true
}
function Test-WorldMaintenancePermitFix4($Definition){
 $scope=Get-StopFieldFix3 $Definition 'MaintenanceScope'
 if($null -eq $scope -or $null -eq $scope.Permit){return $false}
 $p=$scope.Permit
 if($Definition.Name -cne 'mangosd' -or $p.Name -cne 'mangosd' -or $p.Operation -cne $scope.Operation -or $p.Action -cne $scope.Action -or $p.Root -cne $scope.Root -or $p.Action -cnotin @('Migrate','Lifecycle','Rollback','Stop-All','Restart-World','Planned-Reboot') -or $p.Exe -ine $Definition.Exe -or $p.Config -ine $Definition.Config){return $false}
 $state=Read-ControlState $p.Root 'mangosd'
 if($null -ne $p.PSObject.Properties['FailureBarrierBinding'] -and $null -ne $p.FailureBarrierBinding){
  try{[void](Read-WorldFailureBarrierFix4R2 $p.FailureBarrierBinding $p);return $true}catch{return $false}
 }
 return ($state.Phase -ceq 'Maintenance' -and $state.Sequence -eq $p.Sequence -and $state.Intent -ceq $p.Intent -and $state.Generation -ceq $p.Generation -and $p.PID -gt 0 -and $p.Generation -ceq ([string]$p.PID+'|'+$p.CreatedUtc))
}
function Read-WorldFailureBarrierFix4R2($Reference,$Proof){
 Assert-StopFix3 ($Reference.Schema -eq 1 -and $Reference.SourceOperation -cmatch '^[a-f0-9]{32}$' -and $Reference.SourceOperation -ceq $Proof.SourceOperation -and $Reference.Path -ceq (Join-Path $Proof.Root ('failure-barrier-'+$Reference.SourceOperation+'.json')) -and $Reference.SHA256 -cmatch '^[A-F0-9]{64}$') 'FAILURE_BARRIER_REFERENCE'
 Assert-PrivateControlPath $Reference.Path
 Assert-StopFix3 ((Get-FileHash -LiteralPath $Reference.Path -Algorithm SHA256).Hash -ceq $Reference.SHA256) 'FAILURE_BARRIER_FILE_CHANGED'
 $data=[IO.File]::ReadAllText($Reference.Path)|ConvertFrom-Json
 Assert-StopFix3 ($data.Schema -eq 1 -and $data.Operation -ceq $Reference.SourceOperation -and $data.Root -ceq $Proof.Root -and $data.Service -ceq 'mangosd' -and $data.SourceProof.Operation -ceq $data.Operation -and $data.SourceProof.SourceOperation -ceq $data.Operation) 'FAILURE_BARRIER_SOURCE_OPERATION'
 foreach($name in @('Root','Name','Exe','Config','Generation','PID','CreatedUtc','Sequence','Intent','SourceOperation')){Assert-StopFix3 ($data.SourceProof.$name -ceq $Proof.$name) ('FAILURE_BARRIER_PROOF_FIELD '+$name)}
 Assert-DependencyStopResult $Proof.Completion.Outcome 'mangosd'
 Assert-DependencyStopResult $data.SourceProof.Completion.Outcome 'mangosd'
 foreach($source in @($Proof,$data.SourceProof)){
  Assert-StopFix3 ($source.Completion.Result -ceq 'PASS' -and @($source.Completion.ProcessExits).Count -eq 1 -and $source.Generation -ceq ([string]$source.PID+'|'+$source.CreatedUtc)) 'FAILURE_BARRIER_NATIVE_SET'
  $exit=$source.Completion.ProcessExits[0]
  Assert-StopFix3 ($exit.PID -eq $source.PID -and $exit.Path -ceq $source.Exe -and ([DateTimeOffset]::Parse($exit.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($source.CreatedUtc)).UtcTicks -and $exit.Measurement -ceq 'MEASURED' -and (Test-StopUIntFix3 $exit.NativeExit) -and $exit.NativeExit -eq 0) 'FAILURE_BARRIER_NATIVE_RESULT'
 }
 $before=$data.BeforeState;$after=$data.AfterState
 Assert-StopFix3 ($before.Service -ceq 'mangosd' -and $before.Phase -ceq 'Maintenance' -and $before.Sequence -eq $Proof.Sequence -and $before.Intent -ceq $Proof.Intent -and $before.Generation -ceq $Proof.Generation) 'FAILURE_BARRIER_BEFORE_STATE'
 Assert-StopFix3 ($after.Service -ceq 'mangosd' -and $after.Phase -ceq 'Maintenance' -and $after.Sequence -eq ([long]$before.Sequence+1) -and $after.Intent -ceq ('R3OperationFailureRequiresReview:'+$data.Operation) -and $null -eq $after.Generation -and $after.Failure -ceq 'FAIL_OR_UNKNOWN') 'FAILURE_BARRIER_TRANSITION'
 $current=Read-ControlState $Proof.Root 'mangosd'
 foreach($name in @('Schema','Service','Sequence','Phase','Intent','PreviousStartType','Generation','Failure')){Assert-StopFix3 ($current.$name -ceq $after.$name) ('FAILURE_BARRIER_CURRENT_STATE '+$name)}
 Assert-StopFix3 (([DateTimeOffset]::Parse($current.UpdatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($after.UpdatedUtc)).UtcTicks -and (Get-FileHash -LiteralPath (Join-Path $Proof.Root state.json) -Algorithm SHA256).Hash -ceq $data.AfterStateSHA256) 'FAILURE_BARRIER_CURRENT_BYTES'
 return $data
}
function Assert-StopFix3([bool]$Value,[string]$Reason){if(!$Value){throw $Reason}}
function New-StopJournalFix3([string]$Base,[string]$Name){
 Assert-StopFix3 ([IO.Path]::IsPathRooted($Base) -and (Test-Path -LiteralPath $Base -PathType Container) -and $Name -cmatch '^[A-Za-z0-9_-]+$') 'STOP_EVIDENCE_BASE'
 $parent=[IO.Path]::GetFullPath($Base);while($parent){if(Test-Path $parent){Assert-StopFix3 (!((Get-Item -LiteralPath $parent).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'STOP_EVIDENCE_REPARSE'};$parent=[IO.Path]::GetDirectoryName($parent.TrimEnd('\'))}
 $dir=Join-Path $Base ('stop-private-'+$Name+'-'+[guid]::NewGuid().ToString('N'))
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
 [void][IO.Directory]::CreateDirectory($dir,$acl)
 $stream=[IO.FileStream]::new((Join-Path $dir 'journal.jsonl'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough)
 [pscustomobject]@{Directory=$dir;Stream=$stream}
}
function Write-StopJournalFix3($Journal,$Value){
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 15 -Compress)+[Environment]::NewLine)
 $Journal.Stream.Write($bytes,0,$bytes.Length);$Journal.Stream.Flush($true)
}
function Write-StopStageFix3([string]$Path,$Value){[IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Value -Depth 18),[Text.UTF8Encoding]::new($true))}
function Get-StopFieldFix3($Object,[string]$Name){if($null -eq $Object){return $null};$p=$Object.PSObject.Properties[$Name];if($null -eq $p){return $null};return $p.Value}
function Test-StopUIntFix3($Value){return ($null -ne $Value -and ($Value -is [int] -or $Value -is [uint32] -or $Value -is [long] -or $Value -is [uint64]) -and $Value -ge 0 -and $Value -le [uint32]::MaxValue)}
function Convert-StopServiceFix3($Object){
 [pscustomobject]@{Name=(Get-StopFieldFix3 $Object 'Name');State=(Get-StopFieldFix3 $Object 'State');PID=(Get-StopFieldFix3 $Object 'ProcessId');ImagePath=(Get-StopFieldFix3 $Object 'PathName');Account=(Get-StopFieldFix3 $Object 'StartName');StartMode=(Get-StopFieldFix3 $Object 'StartMode');Win32=(Get-StopFieldFix3 $Object 'ExitCode');Specific=(Get-StopFieldFix3 $Object 'ServiceSpecificExitCode')}
}
function Read-StopObservationFix3($Definition,[bool]$Transition,$Expected,$Journal,[ValidateSet('Auto','BeforeStart','StartWait')][string]$ReadMode='Auto'){
 $starting=$ReadMode -cne 'Auto'
 Assert-StopFix3 (!$starting -or !$Transition) 'OBSERVATION_MODE_CONFLICT'
 $ownJournal=$false
 if($null -eq $Journal){$Journal=New-StopJournalFix3 $Definition.EvidenceBase $Definition.Name;$ownJournal=$true}
 $raw=[ordered]@{Event='SCM_CIM_READ';Name=$Definition.Name;Transition=$Transition;ReadMode=$ReadMode;StartedUtc=[DateTimeOffset]::UtcNow.ToString('o');ServiceBefore=$null;Processes=@();ServiceAfter=$null;ServiceReadUtc=$null;ProcessReadUtc=$null;ServiceAfterUtc=$null;ReadError=$null;Classification=$null;Reason=$null}
 $fatal=$null;$reason=$null;$rows=@();$unknown=0
 try{
  try{
   $raw.ServiceBefore=Convert-StopServiceFix3 (Get-CimInstance Win32_Service -Filter ("Name='"+$Definition.Name+"'") -ErrorAction Stop);$raw.ServiceReadUtc=[DateTimeOffset]::UtcNow.ToString('o')
   $source=@(Get-CimInstance Win32_Process -Filter ("Name='"+[IO.Path]::GetFileName($Definition.Exe)+"'") -ErrorAction Stop)
   $raw.Processes=@(foreach($p in $source){$created=Get-StopFieldFix3 $p 'CreationDate';[pscustomobject]@{PID=(Get-StopFieldFix3 $p 'ProcessId');ParentPID=(Get-StopFieldFix3 $p 'ParentProcessId');Path=(Get-StopFieldFix3 $p 'ExecutablePath');CreatedUtc=$(if($null -ne $created){try{$created.ToUniversalTime().ToString('o')}catch{$null}}else{$null});CommandLine=(Get-StopFieldFix3 $p 'CommandLine')}})
   $raw.ProcessReadUtc=[DateTimeOffset]::UtcNow.ToString('o')
   $raw.ServiceAfter=Convert-StopServiceFix3 (Get-CimInstance Win32_Service -Filter ("Name='"+$Definition.Name+"'") -ErrorAction Stop);$raw.ServiceAfterUtc=[DateTimeOffset]::UtcNow.ToString('o')
  }catch{$raw.ReadError=$_.Exception.Message;$reason='CIM_READ_INCOMPLETE'}
  foreach($s in @($raw.ServiceBefore,$raw.ServiceAfter)){
   if($null -eq $s -or $null -eq $s.Name -or $null -eq $s.State){$reason='SCM_METADATA_MISSING';continue}
   $disabledAllowed=(!$starting -and $s.StartMode -ceq 'Disabled' -and (Test-WorldMaintenancePermitFix4 $Definition))
   if(!$starting -and (Test-WorldMaintenancePermitFix4 $Definition) -and $s.StartMode -cne 'Disabled'){$fatal='MAINTENANCE_DISABLED_BARRIER_MISSING'}
   if($s.Name -cne $Definition.Name -or $s.ImagePath -isnot [string] -or !$s.ImagePath.Contains($Definition.Exe) -or !$s.ImagePath.Contains($Definition.Config) -or $s.Account -cne 'LocalSystem' -or ($s.StartMode -cne 'Manual' -and !$disabledAllowed)){$fatal='SCM_IDENTITY_OR_CONFIG_CHANGED'}
   if(!(Test-StopUIntFix3 $s.PID) -or !(Test-StopUIntFix3 $s.Win32) -or !(Test-StopUIntFix3 $s.Specific)){$reason='SCM_PID_OR_RESULT_UNCONFIRMED'}
  }
  foreach($p in $raw.Processes){
   if($p.Path -isnot [string] -or [string]::IsNullOrWhiteSpace($p.Path) -or $null -eq $p.CreatedUtc -or !(Test-StopUIntFix3 $p.PID) -or $p.PID -le 0){$unknown++;$reason='PROCESS_METADATA_UNCONFIRMED';continue}
   if($p.Path -ieq $Definition.Exe){
    if($p.CommandLine -isnot [string] -or [string]::IsNullOrWhiteSpace($p.CommandLine)){$unknown++;$reason='INSTANCE_COMMANDLINE_UNCONFIRMED';continue}
    if(!$p.CommandLine.Contains($Definition.Config)){
     if(@($Definition.OtherConfigs|Where-Object {$p.CommandLine.Contains($_)}).Count -gt 0){continue}
     $fatal='FOREIGN_INSTANCE_PROCESS';continue
    }
    $rows+=@([pscustomobject]@{PID=[long]$p.PID;ParentPID=$p.ParentPID;Path=$p.Path;CreatedUtc=$p.CreatedUtc})
   }elseif($p.Path -in $Definition.OtherImages){continue}else{$fatal='FOREIGN_IMAGE_PROCESS'}
  }
  try{$canonical=Convert-CimProcessRowsFix2 $rows}catch{$fatal='PROCESS_METADATA_INVALID'}
  $scope=Get-StopFieldFix3 $Definition 'MaintenanceScope'
  if($null -ne $scope -and $null -ne $scope.Permit -and (Test-WorldMaintenancePermitFix4 $Definition)){
   $permit=$scope.Permit
   $raw['MaintenanceAuthorization']=[pscustomobject]@{Operation=$permit.Operation;Action=$permit.Action;Sequence=$permit.Sequence;Generation=$permit.Generation;SourceOperation=$permit.SourceOperation}
   foreach($p in $rows){if($p.PID -ne $permit.PID -or $p.Path -ine $permit.Exe -or ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks -ne ([DateTimeOffset]::Parse($permit.CreatedUtc)).UtcTicks){$fatal='PROCESS_GENERATION_CHANGED'}}
  }
  if(($Transition -or $starting) -and $null -ne $Expected){
   foreach($p in $rows){$match=@($Expected|Where-Object {$_.PID -eq $p.PID -and [string]::Equals($_.Path,$p.Path,[StringComparison]::OrdinalIgnoreCase) -and ([DateTimeOffset]::Parse($_.CreatedUtc)).UtcDateTime -eq ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcDateTime});if($match.Count -ne 1){$fatal='PROCESS_GENERATION_CHANGED'}}
  }
  $s=$raw.ServiceAfter;$before=$raw.ServiceBefore;$terminal=$false;$ready=$false;$canStart=$false
  if($null -eq $fatal -and $null -eq $reason){
   $sameState=$before.State -ceq $s.State -and $before.PID -eq $s.PID
   $terminal=$sameState -and $s.State -ceq 'Stopped' -and $s.PID -eq 0 -and $rows.Count -eq 0 -and $unknown -eq 0
   if($starting){
    # 1077 is only a pre-first-START observation, never a successful STOP result.
    $initial1077=$ReadMode -ceq 'BeforeStart' -and $terminal -and $before.Win32 -eq 1077 -and $s.Win32 -eq 1077 -and $before.Specific -eq 0 -and $s.Specific -eq 0
    if(!$initial1077 -and ($before.Win32 -ne 0 -or $s.Win32 -ne 0 -or $before.Specific -ne 0 -or $s.Specific -ne 0)){$fatal='SCM_START_FAILURE'}
    if($before.State -cnotin @('Running','Stopped','Start Pending') -or $s.State -cnotin @('Running','Stopped','Start Pending')){$fatal='START_STATE_NOT_ALLOWED'}
    $canStart=$ReadMode -ceq 'BeforeStart' -and $terminal -and $null -eq $fatal
    $ready=$sameState -and $s.State -ceq 'Running' -and $s.PID -gt 0 -and @($rows|Where-Object PID -eq $s.PID).Count -eq 1 -and $null -eq $fatal
    if($null -ne $Expected -and $rows.Count -ne @($Expected).Count){$ready=$false}
    if(!$ready -and !$canStart){$reason='START_READINESS_UNCONFIRMED'}
    # Starting observations do not certify terminal success, including Stopped/1077.
    $terminal=$false
   }elseif($terminal -and ($s.Win32 -ne 0 -or $s.Specific -ne 0 -or $before.Win32 -ne 0 -or $before.Specific -ne 0)){$fatal='SCM_TERMINAL_FAILURE';$terminal=$false}
   if(!$starting -and !$Transition){
    if(!$sameState -or ($s.State -ceq 'Running' -and ($s.PID -le 0 -or @($rows|Where-Object PID -eq $s.PID).Count -ne 1)) -or ($s.State -ceq 'Stopped' -and !$terminal) -or $s.State -cnotin @('Running','Stopped')){$reason='STRICT_IDENTITY_UNCONFIRMED'}
   }elseif(!$starting -and !$terminal){$reason='STOP_TRANSITION_NOT_TERMINAL'}
  }
  $raw.Classification=if($null -ne $fatal){'REFUSED'}elseif($canStart){'BEFORE_START_STOPPED'}elseif($ready){'RUNNING_IDENTITY_CONFIRMED'}elseif($terminal){'TERMINAL'}elseif($Transition -or $starting){'PENDING'}elseif($null -eq $reason){'CONFIRMED'}else{'REFUSED'}
  $raw.Reason=if($null -ne $fatal){$fatal}else{$reason}
  # Persist raw operands and decision before any classification exception. This journal is BA/SYSTEM.
  Write-StopJournalFix3 $Journal $raw
  if($null -ne $fatal){throw ('STOP_OBSERVATION_REFUSED '+$fatal+' Evidence='+$Journal.Directory)}
  if(!$starting -and !$Transition -and $null -ne $reason){throw ('STOP_IDENTITY_UNCONFIRMED '+$reason+' Evidence='+$Journal.Directory)}
  [pscustomobject]@{Name=$Definition.Name;State=(Get-StopFieldFix3 $s 'State');PID=(Get-StopFieldFix3 $s 'PID');Win32=(Get-StopFieldFix3 $s 'Win32');Specific=(Get-StopFieldFix3 $s 'Specific');Win32ExitCode=(Get-StopFieldFix3 $s 'Win32');SpecificExitCode=(Get-StopFieldFix3 $s 'Specific');Processes=$rows;Terminal=$terminal;Pending=($Transition -and !$terminal) -or ($starting -and !$ready -and !$canStart);Ready=$ready;CanStart=$canStart;ReadMode=$ReadMode;Reason=$reason;EvidenceDirectory=$Journal.Directory}
 }finally{if($ownJournal){$Journal.Stream.Dispose()}}
}
function Get-RetainedExitRowsFix3($Lease){
 if($null -eq $Lease){return ,@()}
 $rows=@(foreach($p in $Lease.Records){
  $r=[ordered]@{PID=$p.PID;Path=$p.Path;CreatedUtc=$p.CreatedUtc;ApiCreatedUtc=$p.ApiCreatedUtc;ApiCreatedTicks=$p.ApiCreatedTicks;NativeExit=$null;Measurement='UNKNOWN';Reason=$null}
  try{
   if(!$p.Process.WaitForExit(0)){$r.Reason='PROCESS_STILL_RUNNING'}else{
    $code=[uint32]0
    if([AfterBootRepairR2.Native]::GetExitCodeProcess($p.Handle,[ref]$code)){$r.NativeExit=[long]$code;$r.Measurement='MEASURED'}else{$r.Reason='GET_EXIT_CODE_FAILED_'+[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
   }
  }catch{$r.Reason=$_.Exception.Message}
  [pscustomobject]$r
 })
 return ,$rows
}
function Ensure-StopNativeFix3 {
 if($null -eq ('AfterBootRepairR2.Native' -as [type])){
  $root='C:\Scripts\MANGOS-AFTERBOOT-VERIFY-R2-WOW-SRV-20261101-0110-PAYLOAD'
  Assert-StopFix3 ((Get-FileHash (Join-Path $root 'Process.Capture.ps1')).Hash -ceq '91D7A3E1CA6E0B430C338566A2B01C273AE41F8314160ECBDD649067409D1534') 'CAPTURE_PIN'
  Assert-StopFix3 ((Get-FileHash (Join-Path $root 'Repair.Native.cs')).Hash -ceq '322C5C51687A09A6766425CE017A152DD0EE28D0054EB464FB0866F22EBE7CA3') 'NATIVE_PIN'
  . (Join-Path $root 'Process.Capture.ps1')
 }
}
# Implementation source used to replace the same function in the shipped driver.
# No top-level calls. Final tests hash the shipped controller/Production.Driver.ps1.
function Invoke-RetainedStopFix3([string]$Name,[scriptblock]$ReadStrict,[scriptblock]$ReadTransition,[scriptblock]$Request,[scriptblock]$Dependencies,[string]$EvidenceBase,[string]$StageResultPath,[int]$TimeoutSeconds=180){
 Assert-StopFix3 ($TimeoutSeconds -ge 1 -and $TimeoutSeconds -le 900) 'STOP_TIMEOUT_RANGE'
 Ensure-StopNativeFix3
 $journal=New-StopJournalFix3 $EvidenceBase $Name
 $lease=$null;$primary=$null;$observation=$null;$rows=@();$requestConfirmed=$false
 $evidenceErrors=[Collections.Generic.List[string]]::new();$cleanupErrors=[Collections.Generic.List[string]]::new()
 $timer=[Diagnostics.Stopwatch]::StartNew();$releasedUtc=$null;$measuredUtc=$null;$postReadUtc=$null
 try{
  [void](& $Dependencies)
  $before=& $ReadStrict $journal
  $lease=Open-VerifiedProcessSetFix2 $before.Processes {& $ReadStrict $journal}.GetNewClosure()
  Assert-VerifiedProcessSetFix2 $lease {& $ReadStrict $journal}.GetNewClosure()
  if($before.State -ceq 'Running'){[void](& $Request);$requestConfirmed=$true}elseif($before.State -cne 'Stopped'){throw 'STOP_INITIAL_STATE'}
  $timer.Restart()
  # Native termination is independent of CIM object lifetime. In particular the
  # last CIM row may remain visible precisely because this lease is still open.
  while($true){
   $rows=Merge-RetainedExitRowsFix5 $rows (Get-RetainedExitRowsFix3 $lease)
   if(@($rows).Count -gt 0 -and @($rows|Where-Object Measurement -ne 'MEASURED').Count -eq 0){break}
   [void](& $Dependencies)
   $observation=& $ReadTransition $journal $lease.Expected
   if($timer.ElapsedMilliseconds -ge [long]$TimeoutSeconds*1000){throw 'STOP_TIMEOUT_OR_NATIVE_UNKNOWN'}
   Start-Sleep -Milliseconds 50
  }
 }catch{$primary=$_}
 # Always measure before ANY Dispose, also after polling/identity/request errors.
 # Once these values are copied, no later observation or cleanup can erase them.
 if($null -ne $lease -and !$lease.Closed){$rows=Merge-RetainedExitRowsFix5 $rows (Get-RetainedExitRowsFix3 $lease)}
 $measuredUtc=[DateTimeOffset]::UtcNow.ToString('o')
 foreach($row in $rows){
  try{Write-StopJournalFix3 $journal @{Event='PROCESS_EXIT_BEFORE_DISPOSE';AtUtc=$measuredUtc;Process=$row}}catch{$evidenceErrors.Add('JournalProcess: '+$_.Exception.Message)}
  try{Write-StopProcessExitFix5 (Join-Path $journal.Directory ('process-'+$row.PID+'.json')) $row}catch{$evidenceErrors.Add('ProcessFile: '+$_.Exception.Message)}
 }
 if($null -ne $lease){
  foreach($p in $lease.Records){try{[void](& $lease.Transport.Dispose $p.Process)}catch{$cleanupErrors.Add('PID='+$p.PID+' '+$_.Exception.Message)}}
  $lease.Closed=$true;$releasedUtc=[DateTimeOffset]::UtcNow.ToString('o')
 }
 # Only now ask SCM/CIM to certify no process. No ended/unknown CIM row is
 # silently discarded. A foreign process, new generation or missing metadata
 # still denies this operation; dependencies stay untouched.
 if($null -eq $primary){
  try{
   Assert-StopFix3 (@($rows).Count -gt 0 -and @($rows|Where-Object {$_.Measurement -ne 'MEASURED'}).Count -eq 0) 'STOP_NATIVE_RESULT_UNKNOWN'
   if(@($rows|Where-Object NativeExit -ne 0).Count){throw 'STOP_NATIVE_NONZERO'}
   Assert-StopFix3 ($cleanupErrors.Count -eq 0 -and $evidenceErrors.Count -eq 0) 'STOP_RELEASE_OR_MEASUREMENT_EVIDENCE_FAILED'
   while($true){
    [void](& $Dependencies)
    $observation=& $ReadTransition $journal $lease.Expected;$postReadUtc=[DateTimeOffset]::UtcNow.ToString('o')
    if($observation.Terminal){break}
    if($timer.ElapsedMilliseconds -ge [long]$TimeoutSeconds*1000){throw 'STOP_POST_RELEASE_CONFIRMATION_TIMEOUT'}
    Start-Sleep -Milliseconds 50
   }
  }catch{$primary=$_}
 }
 $outcome=[ordered]@{Schema=2;StopProtocol='MeasureReleaseConfirm-FIX5';Name=$Name;Result='FAIL';Service=$Name;Observation=$observation;ExpectedProcesses=$(if($null -ne $lease){@($lease.Expected)}else{@()});ProcessExits=$rows;MeasuredBeforeDisposeUtc=$measuredUtc;OwnHandlesReleasedUtc=$releasedUtc;PostReleaseObservationUtc=$postReadUtc;TerminalObservationAfterRelease=($null -ne $postReadUtc -and $null -ne $observation -and $observation.Terminal);PrimaryError=$(if($null -ne $primary){$primary.Exception.Message}else{$null});EvidenceErrors=$evidenceErrors.ToArray();CleanupErrors=$cleanupErrors.ToArray();RequestConfirmed=$requestConfirmed;EvidenceDirectory=$journal.Directory;AtUtc=[DateTimeOffset]::UtcNow.ToString('o')}
 if($null -eq $primary -and $evidenceErrors.Count -eq 0 -and $cleanupErrors.Count -eq 0){$outcome.Result='PASS'}
 Complete-StopContractFix4R2 $outcome
 try{Write-StopStageFix3 $StageResultPath $outcome}catch{if($null -eq $primary){$primary=$_;$outcome.PrimaryError=$_.Exception.Message}else{$evidenceErrors.Add('StageWrite: '+$_.Exception.Message)};$outcome.Result='FAIL'}
 $outcome.EvidenceErrors=$evidenceErrors.ToArray()
 try{Write-StopOutcomeFix5 (Join-Path $journal.Directory OUTCOME.json) $outcome}catch{$evidenceErrors.Add('OutcomeFile: '+$_.Exception.Message)}
 try{Write-StopJournalFix3 $journal @{Event='FINAL_OUTCOME';Outcome=$outcome}}catch{$evidenceErrors.Add('FinalJournal: '+$_.Exception.Message)}
 try{$journal.Stream.Dispose()}catch{$cleanupErrors.Add('JournalDispose: '+$_.Exception.Message)}
 $outcome.EvidenceErrors=$evidenceErrors.ToArray();$outcome.CleanupErrors=$cleanupErrors.ToArray()
 if($null -ne $primary -or $evidenceErrors.Count -or $cleanupErrors.Count){$outcome.Result='FAIL'}
 Complete-StopContractFix4R2 $outcome
 try{Write-StopOutcomeFix5 (Join-Path $journal.Directory OUTCOME.json) $outcome}catch{$evidenceErrors.Add('FinalOutcomeFile: '+$_.Exception.Message);$outcome.EvidenceErrors=$evidenceErrors.ToArray();$outcome.Result='FAIL';Complete-StopContractFix4R2 $outcome}
 # Final stage view includes all observation/evidence/cleanup results.
 try{Write-StopStageFix3 $StageResultPath $outcome}catch{
  if($null -eq $primary){$primary=$_;$outcome.PrimaryError=$_.Exception.Message}
  $evidenceErrors.Add('FinalStageWrite: '+$_.Exception.Message);$outcome.EvidenceErrors=$evidenceErrors.ToArray();$outcome.Result='FAIL';Complete-StopContractFix4R2 $outcome
  try{Write-StopOutcomeFix5 (Join-Path $journal.Directory OUTCOME.json) $outcome}catch{$evidenceErrors.Add('FinalFailureOutcome: '+$_.Exception.Message)}
 }
 if($null -ne $primary){$primary.Exception.Data['StopEvidenceDirectory']=$journal.Directory;$primary.Exception.Data['ProcessExits']=$rows;$primary.Exception.Data['EvidenceErrors']=$evidenceErrors.ToArray();$primary.Exception.Data['CleanupErrors']=$cleanupErrors.ToArray();throw $primary}
 if($evidenceErrors.Count -or $cleanupErrors.Count){$error=[Exception]::new('STOP_EVIDENCE_OR_CLEANUP_FAILURE Evidence='+$journal.Directory+' '+($evidenceErrors -join '|')+' '+($cleanupErrors -join '|'));$error.Data['ProcessExits']=$rows;throw $error}
 Assert-StopFix3 $outcome.ResultKnown ('STOP_TERMINAL_OR_NATIVE_RESULT_UNKNOWN '+$Name)
 [pscustomobject]$outcome
}
function Write-StopProcessExitFix5([string]$Path,$Row){[IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Row -Depth 8),[Text.UTF8Encoding]::new($true))}
function Write-StopOutcomeFix5([string]$Path,$Outcome){[IO.File]::WriteAllText($Path,(ConvertTo-Json -InputObject $Outcome -Depth 18),[Text.UTF8Encoding]::new($true))}
function Merge-RetainedExitRowsFix5($Before,$After){
 $merged=@(foreach($row in @($After)){
  $saved=@($Before|Where-Object {$_.PID -eq $row.PID -and $_.Path -ceq $row.Path -and $_.ApiCreatedTicks -eq $row.ApiCreatedTicks -and $_.Measurement -ceq 'MEASURED'})
  if($saved.Count -eq 1){$saved[0]}else{$row}
 })
 return ,$merged
}
function Assert-OuterStopCoordinatorFix5($Scope,$Context){
 if(!$Scope.OuterRetainedCoordinator){return $false}
 Assert-StopFix3 ($Context.Service -ceq 'mangosd' -and $Context.Operation -ceq $Scope.Operation -and $Context.Action -ceq $Scope.Action -and $Context.Root -ceq $Scope.Root -and $null -ne $Scope.Permit) 'OUTER_STOP_COORDINATOR_NOT_BOUND'
 return $true
}

function Complete-StopContractFix4R2($Outcome){
 $s=$Outcome.Observation
 $Outcome.Stopped=($null -ne $s -and $s.Terminal -is [bool] -and $s.Terminal -and $s.State -ceq 'Stopped' -and (Test-StopUIntFix3 $s.PID) -and $s.PID -eq 0 -and $null -eq $s.Reason)
 $Outcome.ProcessesGone=($Outcome.Stopped -and @($s.Processes).Count -eq 0)
 $Outcome.Win32ExitCode=$(if($null -ne $s){$s.Win32ExitCode}else{$null});$Outcome.SpecificExitCode=$(if($null -ne $s){$s.SpecificExitCode}else{$null})
 $expected=@($Outcome.ExpectedProcesses);$rows=@($Outcome.ProcessExits)
 $known=$expected.Count -gt 0 -and $expected.Count -eq $rows.Count -and @($expected.PID|Sort-Object -Unique).Count -eq $expected.Count
 foreach($p in $expected){
  $matches=@($rows|Where-Object {$_.PID -eq $p.PID -and [string]::Equals($_.Path,$p.Path,[StringComparison]::OrdinalIgnoreCase) -and ([DateTimeOffset]::Parse($_.CreatedUtc)).UtcTicks -eq ([DateTimeOffset]::Parse($p.CreatedUtc)).UtcTicks})
  if($matches.Count -ne 1 -or $matches[0].Measurement -cne 'MEASURED' -or !(Test-StopUIntFix3 $matches[0].NativeExit) -or $matches[0].NativeExit -ne 0){$known=$false}
 }
 $Outcome.ResultKnown=($known -and $Outcome.ProcessesGone -and (Test-StopUIntFix3 $Outcome.Win32ExitCode) -and $Outcome.Win32ExitCode -eq 0 -and (Test-StopUIntFix3 $Outcome.SpecificExitCode) -and $Outcome.SpecificExitCode -eq 0 -and $Outcome.Result -ceq 'PASS' -and $null -eq $Outcome.PrimaryError -and @($Outcome.EvidenceErrors).Count -eq 0 -and @($Outcome.CleanupErrors).Count -eq 0)
 if($Outcome.Contains('StopProtocol')){
  $ordered=$false
  try{$ordered=$Outcome.TerminalObservationAfterRelease -is [bool] -and $Outcome.TerminalObservationAfterRelease -and $null -ne $Outcome.MeasuredBeforeDisposeUtc -and $null -ne $Outcome.OwnHandlesReleasedUtc -and $null -ne $Outcome.PostReleaseObservationUtc -and ([DateTimeOffset]::Parse($Outcome.MeasuredBeforeDisposeUtc)).UtcTicks -le ([DateTimeOffset]::Parse($Outcome.OwnHandlesReleasedUtc)).UtcTicks -and ([DateTimeOffset]::Parse($Outcome.OwnHandlesReleasedUtc)).UtcTicks -le ([DateTimeOffset]::Parse($Outcome.PostReleaseObservationUtc)).UtcTicks}catch{$ordered=$false}
  $Outcome.ResultKnown=$Outcome.ResultKnown -and $Outcome.StopProtocol -ceq 'MeasureReleaseConfirm-FIX5' -and $ordered
 }
 if(!$Outcome.ResultKnown){$Outcome.Result='FAIL'}
}

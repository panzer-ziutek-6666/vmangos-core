. (Join-Path $PSScriptRoot 'FullProduction.ps1')
$r=NewKitRun 'GuardFixtures' 'Plan';$script:Scenario='Good';$script:ReadCount=0;$results=@()
function Get-BackendStopObservation([string]$Name){
 $script:ReadCount++;$p=@([pscustomobject]@{PID=900001;CreatedUtc='2026-11-09T12:00:00Z';Path='C:\fixture\mysqld.exe'},[pscustomobject]@{PID=900002;CreatedUtc='2026-11-09T12:00:01Z';Path='C:\fixture\mysqld.exe'})
 if($script:Scenario -ceq 'NewGeneration' -and $script:ReadCount -gt 1){$p[1].CreatedUtc='2026-11-09T12:00:02Z'}
 if($script:Scenario -ceq 'MissingProcess'){$p=@($p[0])}
 [pscustomobject]@{State='Running';Processes=$p}
}
function Get-NetTCPConnection {param($State,$LocalPort,$ErrorAction)[pscustomobject]@{OwningProcess=$(if($script:Scenario -ceq 'ForeignListener'){900003}else{900002})}}
function Invoke-FullSQLRaw($Run,[string]$SQL,[string]$Tag,[string]$File){
 if($script:Scenario -ceq 'ReadError'){throw 'FIXTURE_SQL_READ_ERROR'}
 $port=if($script:Scenario -ceq 'OldDEV'){13306}elseif($script:Scenario -ceq 'NewDEV'){23306}else{3306}
 $uuid=if($script:Scenario -ceq 'WrongUUID'){'650601ed-dc07-11f1-b12b-b0227ad7e1e2'}else{$Run.Plan.FullCandidate.SourceUUID}
 $data=if($script:Scenario -ceq 'WrongDatadir'){'C:\fixture\other-data'}else{$Run.Plan.FullCandidate.SourceDatadir}
 return "WOW-SRV`t$port`t$data`t$uuid"
}
foreach($name in @('Good','OldDEV','NewDEV','WrongUUID','WrongDatadir','ForeignListener','NewGeneration','MissingProcess','ReadError')){
 $script:Scenario=$name;$script:ReadCount=0;$err=$null
 try{Assert-FullEndpoint $r}catch{$err=$_.Exception.Message}
 Need ($(if($name -ceq 'Good'){$null -eq $err}else{$null -ne $err})) ('ENDPOINT_FIXTURE '+$name)
 $results+=@(@{Name=$name;Result='PASS';Refusal=$err})
}
PutJson (Join-Path $Out 'ENDPOINT-TESTS.json') @{Result='PASS';Tests=$results;Count=$results.Count;InstrumentedBoundaries=@('single Get-BackendStopObservation records','single Get-NetTCPConnection result','raw MySQL client result only');ActualFunction='Assert-FullEndpoint';NoLiveSQLOrControls=$true;CodeSHA256=(Hash (Join-Path $PSScriptRoot 'FullProduction.ps1'));TestSHA256=(Hash $PSCommandPath)}
Write-Host ('ENDPOINT_TESTS_PASS='+$results.Count)

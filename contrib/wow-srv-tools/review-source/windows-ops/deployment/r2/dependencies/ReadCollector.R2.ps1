# Derived from pinned Install.Common.ps1/ReadCollector. Only coherent read acquisition replaced.
function ReadCollector {
    $base='C:\ProgramData\VMANGOS\AdminPanelCollector';$pointer=GetJson (Join-Path $base 'collector-current.json')
    Need ($pointer.collectorVersion -cmatch '^[A-Za-z0-9_.-]+$') 'Collector version path'
    $version=Join-Path $base ('versions\'+$pointer.collectorVersion);$code=Join-Path $version 'collector-code.json';Need ((Hash $code) -ceq $pointer.codeManifestSHA256) 'Collector code manifest'
    $definition=GetJson $code;foreach($pin in $definition.files){$path=Join-Path $version $pin.name;Need ((Get-Item $path).Length -eq $pin.bytes -and (Hash $path) -ceq $pin.sha256) 'Collector installed code changed'}
    Import-Module (Join-Path $version 'Release.Contract.psm1') -Force -DisableNameChecking
    $modules=@(Get-Module -All Release.Contract|Where-Object Path -ceq (Join-Path $version 'Release.Contract.psm1'));Need ($modules.Count -eq 1) 'Exact installed release module instance required';$module=$modules[0];$context=New-ReleaseContext (Join-Path $base 'release-registry') 'C:\GRY\wow\serwer-dev' 'C:\ProgramData\VMANGOS\AdminPanelTelemetry\snapshot.json'
    $read=Read-CollectorPairR2 $context
    $state=$read.State;$receipt=$read.Receipt;$sample=$read.Sample
    Need ($state.phase -ceq 'stable' -and $receipt.sequence -eq $state.sequence -and $receipt.release.id -ceq $state.active.id -and $receipt.release.sha256 -ceq $state.active.sha256) 'Collector stable receipt binding'
    $manifest=Get-RegisteredRelease $context $state.active;$processes=Get-CoreProcessPair
    & $module {param($ctx,$m,$s,$p)ValidateSample $ctx $m $s @($p)} $context $manifest $sample $processes
    Need ($sample.server.status -ceq 'ok' -and $sample.legacyBots.status -ceq 'ok' -and $sample.aiBots.status -ceq 'ok') 'Collector section error is not healthy'
    Need ((ConvertTo-Json -InputObject @($receipt.processes) -Compress) -ceq (ConvertTo-Json -InputObject @($processes) -Compress)) 'Collector receipt process generation stale'
    [pscustomobject]@{Pointer=$pointer;ReleaseState=$state;Receipt=$receipt;Sample=$sample;Processes=@($processes);CodeRoot=$version;ContractSHA256=(Hash (Join-Path $version 'Release.Contract.psm1'));ObservedUtc=[DateTimeOffset]::UtcNow.ToString('o');Mode='Read only; no registry lock/write, no collector transport invoked'}
}
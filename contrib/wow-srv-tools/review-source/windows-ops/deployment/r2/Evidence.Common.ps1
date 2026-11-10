Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:Stage='CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225'
$script:Root='C:\Scripts\CORE-FULL-PRODUCTION-PREP-R2-WOW-SRV-20261109-2225-PAYLOAD'
$script:Out=Join-Path 'C:\GRY\wow\diagnostics' $script:Stage
$script:R2='C:\Scripts\SHUTDOWN1053-ISOLATED-PREP-R2-WOW-SRV-20261101-1355-PAYLOAD'
function Need([bool]$Value,[string]$Message){if(!$Value){throw $Message}}
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
function SaveJson([string]$Name,$Value){[IO.File]::WriteAllText((Join-Path $script:Out $Name),(ConvertTo-Json -InputObject $Value -Depth 20),[Text.UTF8Encoding]::new($true))}
function ReadJson([string]$Path){[IO.File]::ReadAllText($Path)|ConvertFrom-Json}
function Guard {
    $id=[Security.Principal.WindowsIdentity]::GetCurrent()
    Need ($env:COMPUTERNAME -ceq 'WOW-SRV' -and $id.Name -ceq 'WOW-SRV\Administrator' -and ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and $PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.ToString() -like '5.1.*' -and [Environment]::Is64BitProcess -and (Get-Location).Path -ceq 'C:\GRY') 'HOST_TOKEN_PS51_CWD'
}
Guard
$capture='C:\Scripts\MANGOS-AFTERBOOT-VERIFY-R2-WOW-SRV-20261101-0110-PAYLOAD'
Need ((Hash (Join-Path $capture 'Process.Capture.ps1')) -ceq '91D7A3E1CA6E0B430C338566A2B01C273AE41F8314160ECBDD649067409D1534') 'CAPTURE_PIN'
Need ((Hash (Join-Path $capture 'Repair.Native.cs')) -ceq '322C5C51687A09A6766425CE017A152DD0EE28D0054EB464FB0866F22EBE7CA3') 'CAPTURE_NATIVE_PIN'
. (Join-Path $capture 'Process.Capture.ps1')
function Capture([string]$Exe,[string[]]$Tokens,[string]$Tag,[int]$Timeout=120000){
    foreach($t in $Tokens){Need (!$t.Contains('"') -and !$t.Contains("`n") -and !$t.EndsWith('\')) 'NATIVE_QUOTING'}
    $path=Join-Path $script:Out $Tag;Need (!(Test-Path ($path+'.process.json'))) ('NO_AUTOMATIC_REPEAT '+$Tag)
    $arguments=($Tokens|ForEach-Object {'"'+$_+'"'}) -join ' '
    Invoke-CapturedProcessR2 $Exe $arguments $path -TimeoutMilliseconds $Timeout
}
function Snapshot {
    $services=@(foreach($name in @('mangosd','realmd','VMANGOS-MySQL')){
        $s=Get-CimInstance Win32_Service -Filter ("Name='"+$name+"'") -ErrorAction Stop
        Need ($null -ne $s) ('SERVICE_MISSING '+$name)
        $p=$null;if($s.ProcessId -gt 0){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$s.ProcessId) -ErrorAction Stop;Need ($null -ne $p) 'PROCESS_MISSING'}
        [pscustomobject]@{Name=$name;State=[string]$s.State;PID=[long]$s.ProcessId;CreatedUtc=$(if($p){$p.CreationDate.ToUniversalTime().ToString('o')}else{$null});Path=$(if($p){[string]$p.ExecutablePath}else{$null});StartMode=[string]$s.StartMode;Win32ExitCode=[long]$s.ExitCode;SpecificExitCode=[long]$s.ServiceSpecificExitCode}
    })
    [pscustomobject]@{AtUtc=[DateTimeOffset]::UtcNow.ToString('o');BootUtc=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o');Services=$services;Listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object LocalPort -in @(3306,3724,8085,7878)|ForEach-Object {[pscustomobject]@{Address=[string]$_.LocalAddress;Port=[int]$_.LocalPort;PID=[long]$_.OwningProcess}})}
}

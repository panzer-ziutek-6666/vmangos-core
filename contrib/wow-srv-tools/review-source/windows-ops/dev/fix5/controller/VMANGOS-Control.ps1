[CmdletBinding()]
param(
    [ValidateSet('Status','Start-All','Stop-All','Restart-World','Planned-Reboot')]
    [string]$Action = 'Status',

    [switch]$Json,
    [switch]$Boot,
    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if(!$Execute){throw 'PREPARED_CANDIDATE_ONLY_EXECUTE_REQUIRES_SEPARATE_DEPLOYMENT'}
if($env:COMPUTERNAME -cne 'WOW-SRV' -or $PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.ToString() -notlike '5.1.*' -or ![Environment]::Is64BitProcess){throw 'HOST_PS51_X64'}
if($PSScriptRoot -ine 'C:\ProgramData\VMANGOS\AdminPanelBridge\shutdown1053-r3-v2-fix5'){throw 'NOT_INSTALLED_APPROVED_LOCATION'}
if(![Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'SYSTEM_OR_ELEVATED_ADMIN_REQUIRED'}
function Assert-BootstrapPrivate([string]$Path){
    $full=[IO.Path]::GetFullPath($Path);$parent=$full
    while($parent){if(Test-Path -LiteralPath $parent){if((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'BOOTSTRAP_REPARSE'}};$parent=[IO.Path]::GetDirectoryName($parent.TrimEnd('\'))}
    $acl=Get-Acl -LiteralPath $full
    if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'BOOTSTRAP_OWNER'}
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -or $rule.AccessControlType -ne 'Allow'){throw 'BOOTSTRAP_DACL'}}
}
function Assert-ControllerActivation([string]$Root){
    Assert-BootstrapPrivate $Root
    $receiptPath=Join-Path $Root 'ACTIVATION-RECEIPT.json';Assert-BootstrapPrivate $receiptPath
    $receipt=[IO.File]::ReadAllText($receiptPath)|ConvertFrom-Json
    if($receipt.Scope -cne 'ADMIN_CONTROL_ONLY' -or $receipt.Approved -isnot [bool] -or !$receipt.Approved){throw 'ACTIVATION_NOT_APPROVED'}
    $required=@('VMANGOS-Control.ps1','Maintenance.psm1','Production.Driver.ps1','World.Markers.ps1')|Sort-Object
    if((@($receipt.CodePins.Name|Sort-Object) -join '|') -cne ($required -join '|')){throw 'ACTIVATION_PIN_SET'}
    foreach($pin in @($receipt.CodePins)){
        if($pin.Name -notmatch '^[A-Za-z0-9_.-]+$' -or $pin.SHA256 -cnotmatch '^[0-9A-F]{64}$'){throw 'ACTIVATION_PIN_FORMAT'}
        $path=Join-Path $Root $pin.Name;Assert-BootstrapPrivate $path
        if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $pin.SHA256){throw 'ACTIVATION_CODE_PIN'}
    }
    return $receipt
}
$receipt=Assert-ControllerActivation $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'Maintenance.psm1') -Force
. (Join-Path $PSScriptRoot 'World.Markers.ps1')
. (Join-Path $PSScriptRoot 'Production.Driver.ps1')
$MaintenanceRoot='C:\ProgramData\VMANGOS\AdminControlMaintenance\v1'
$WorldDriver=New-ProductionWorldDriver
$ExpectedHost = 'WOW-SRV'

$Runtime     = 'C:\GRY\wow\serwer-dev'
$MySqlRoot   = 'C:\GRY\wow\serwer\mysql-26.7.0-winx64'
$Diagnostics = 'C:\GRY\wow\diagnostics'

$MySqlExe    = Join-Path $MySqlRoot 'bin\mysqld.exe'
$MySqlClient = Join-Path $MySqlRoot 'bin\mysql.exe'
$RealmdExe   = Join-Path $Runtime 'realmd.exe'
$MangosdExe  = Join-Path $Runtime 'mangosd.exe'
$MangosdConf = Join-Path $Runtime 'mangosd.conf'

$MySqlService  = 'VMANGOS-MySQL'
$RealmdService = 'realmd'
$MangosdService = 'mangosd'

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss-ffffff'
$Log = Join-Path $Diagnostics "VMANGOS-CONTROL-$Action-$Stamp.log"

$StartedThisRun = New-Object System.Collections.Generic.List[string]

function Write-RunLog {
    param(
        [ValidateSet('INFO','DATA','OK','WARN','ERROR')][string]$Level='INFO',
        [AllowEmptyString()][string]$Message=''
    )

    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Level, $Message
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8

    if (-not $Json) {
        Write-Host $line
    }
}

function Get-ServiceCim {
    param([Parameter(Mandatory=$true)][string]$Name)

    Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $Name.Replace("'","''")) -ErrorAction SilentlyContinue
}

function Get-PortListeners {
    param([Parameter(Mandatory=$true)][int]$Port)

    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Get-ProcessPathById {
    param([Parameter(Mandatory=$true)][int]$ProcessId)

    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($p) { return [string]$p.ExecutablePath }
    return $null
}

function Get-DbInfo {
    $line = Get-Content -LiteralPath $MangosdConf |
        Where-Object { $_ -match '^\s*LoginDatabase\.Info\s*=' } |
        Select-Object -First 1

    if (-not $line) {
        $line = Get-Content -LiteralPath $MangosdConf |
            Where-Object { $_ -match '^\s*LoginDatabaseInfo\s*=' } |
            Select-Object -First 1
    }

    if (-not $line) {
        throw 'Cannot find LoginDatabase.Info/LoginDatabaseInfo in mangosd.conf.'
    }

    $value = ($line -replace '^\s*[^=]+=\s*','').Trim().Trim('"').Trim("'")
    $parts = $value.Split(';')

    if ($parts.Count -lt 5) {
        throw 'Unexpected LoginDatabase connection format.'
    }

    [pscustomobject]@{
        Host = $parts[0]
        Port = [int]$parts[1]
        User = $parts[2]
        Password = $parts[3]
        Database = $parts[4]
    }
}

function Invoke-ReadinessSqlNativeFix4([string]$Exe,[string[]]$Tokens){
    $output=@(& $Exe @Tokens 2>&1);$code=$LASTEXITCODE
    [pscustomobject]@{Output=$output;ExitCode=$code}
}
function Test-MySqlQuery {
    $db = Get-DbInfo

    if ($db.Host -notin @('127.0.0.1','localhost','::1')) {
        throw "Refusing readiness SQL against non-local DB host: $($db.Host)"
    }

    $previous = [Environment]::GetEnvironmentVariable('MYSQL_PWD','Process')
    try {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD',$db.Password,'Process')

        $args = @(
            '--no-defaults',
            '--no-login-paths',
            '--protocol=TCP',
            "--host=$($db.Host)",
            "--port=$($db.Port)",
            '--connect-timeout=5',
            '--batch',
            '--skip-column-names',
            '--raw',
            "--user=$($db.User)",
            "--database=$($db.Database)",
            '--execute=SELECT 1;'
        )

        $old = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $native = Invoke-ReadinessSqlNativeFix4 $MySqlClient $args
            $out = @($native.Output)
            $code = $native.ExitCode
        }
        finally {
            $ErrorActionPreference = $old
        }

        if ($code -ne 0) {
            return $false
        }

        $lines = @($out | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
        return ($lines.Count -ge 1 -and $lines[-1] -eq '1')
    }
    finally {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD',$previous,'Process')
    }
}

function Test-PortOwnerPath {
    param(
        [Parameter(Mandatory=$true)][int]$Port,
        [Parameter(Mandatory=$true)][string]$ExpectedPath,
        [int]$ExpectedPid = 0,
        [switch]$LocalhostOnly
    )

    $listeners = @(Get-PortListeners -Port $Port)
    if ($listeners.Count -eq 0) {
        return $false
    }

    if ($LocalhostOnly) {
        $bad = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') })
        if ($bad.Count -gt 0) {
            return $false
        }
    }

    foreach ($listener in $listeners) {
        if ($ExpectedPid -gt 0 -and [int]$listener.OwningProcess -ne $ExpectedPid) {
            return $false
        }

        $path = Get-ProcessPathById -ProcessId ([int]$listener.OwningProcess)
        if ($path -ne $ExpectedPath) {
            return $false
        }
    }

    return $true
}

function Get-ServiceIdentity {
    param($Service,[string]$ExpectedPath)
    if($null -eq $Service -or [int]$Service.ProcessId -le 0){return $null}
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$Service.ProcessId) -ErrorAction Stop
    if($null -eq $process -or $process.ExecutablePath -ine $ExpectedPath){return $null}
    $created=$process.CreationDate.ToUniversalTime().ToString('o')
    [pscustomobject]@{PID=[int]$process.ProcessId;CreatedUtc=$created;Path=$process.ExecutablePath;Generation=([string]$process.ProcessId+'|'+$created)}
}

function Get-ControlStatusObservation {
    $mysqlSvc=Get-ServiceCim $MySqlService;$realmSvc=Get-ServiceCim $RealmdService;$worldSvc=Get-ServiceCim $MangosdService
    if($null -eq $mysqlSvc -or $null -eq $realmSvc -or $null -eq $worldSvc){throw 'STATUS_REQUIRED_SERVICE_MISSING'}
    $mysqlIdentity=Get-ServiceIdentity $mysqlSvc $MySqlExe;$realmIdentity=Get-ServiceIdentity $realmSvc $RealmdExe;$worldIdentity=Get-ServiceIdentity $worldSvc $MangosdExe
    $mysqlPort=@(Get-PortListeners 3306).Count -gt 0;$realmPort=@(Get-PortListeners 3724).Count -gt 0
    $worldPort=@(Get-PortListeners 8085).Count -gt 0;$soapPort=@(Get-PortListeners 7878).Count -gt 0
    $mysqlOwner=$false;$realmOwner=$false;$worldOwner=$false;$soapOwner=$false
    if($mysqlPort){$mysqlOwner=Test-PortOwnerPath 3306 $MySqlExe}
    if($realmPort -and $null -ne $realmIdentity){$realmOwner=Test-PortOwnerPath 3724 $RealmdExe $realmIdentity.PID}
    if($worldPort -and $null -ne $worldIdentity){$worldOwner=Test-PortOwnerPath 8085 $MangosdExe $worldIdentity.PID}
    if($soapPort -and $null -ne $worldIdentity){$soapOwner=Test-PortOwnerPath 7878 $MangosdExe $worldIdentity.PID -LocalhostOnly}
    $state=Read-ControlState $MaintenanceRoot 'mangosd'
    $worldSnapshot=$null;$initialized=$false
    if($worldSvc.State -ceq 'Running' -and $null -ne $worldIdentity){
        $worldSnapshot=& $WorldDriver.Read
        if($worldSnapshot.State -eq 4 -and $worldSnapshot.Pid -eq $worldIdentity.PID -and $worldSnapshot.Generation -ceq $worldIdentity.Generation){$initialized=[bool](& $WorldDriver.Ready $worldSnapshot)}
    }
    $sql=$false
    if($mysqlSvc.State -ceq 'Running' -and $null -ne $mysqlIdentity -and $mysqlPort -and $mysqlOwner){try{$sql=[bool](Test-MySqlQuery)}catch{$sql=$false}}
    $mysqlReady=($mysqlSvc.State -ceq 'Running' -and $null -ne $mysqlIdentity -and $mysqlPort -and $mysqlOwner -and $sql)
    $realmReady=($realmSvc.State -ceq 'Running' -and $null -ne $realmIdentity -and $realmPort -and $realmOwner)
    # Stable is durable permission, not a pin to the last administrative process.
    # state.Generation stays historical; operation-scoped ExpectedWorldGeneration remains strict.
    $maintenanceMatches=($state.Phase -ceq 'Stable' -and $null -ne $worldIdentity)
    $worldReady=($worldSvc.State -ceq 'Running' -and $null -ne $worldSnapshot -and $worldSnapshot.State -eq 4 -and $worldSnapshot.StartType -eq 3 -and $maintenanceMatches -and $initialized -and $worldPort -and $worldOwner -and $soapPort -and $soapOwner)
    $fingerprint=ConvertTo-Json -Depth 8 -Compress -InputObject ([ordered]@{MySQL=$mysqlIdentity;MySQLState=$mysqlSvc.State;Realm=$realmIdentity;RealmState=$realmSvc.State;World=$worldIdentity;WorldState=$worldSvc.State;Phase=$state.Phase;Sequence=$state.Sequence;MaintenanceGeneration=$state.Generation})
    [pscustomobject]@{
        Host=$env:COMPUTERNAME;Timestamp=[DateTimeOffset]::Now.ToString('o')
        Services=[pscustomobject]@{
            MySql=[pscustomobject]@{Name=$MySqlService;State=[string]$mysqlSvc.State;StartMode=[string]$mysqlSvc.StartMode;ProcessId=[int]$mysqlSvc.ProcessId;CreatedUtc=$(if($mysqlIdentity){$mysqlIdentity.CreatedUtc}else{$null});Generation=$(if($mysqlIdentity){$mysqlIdentity.Generation}else{$null});Port3306=$mysqlPort;PortOwnerValid=$mysqlOwner;SqlSelect1=$sql;Ready=$mysqlReady}
            Realmd=[pscustomobject]@{Name=$RealmdService;State=[string]$realmSvc.State;StartMode=[string]$realmSvc.StartMode;ProcessId=[int]$realmSvc.ProcessId;CreatedUtc=$(if($realmIdentity){$realmIdentity.CreatedUtc}else{$null});Generation=$(if($realmIdentity){$realmIdentity.Generation}else{$null});Port3724=$realmPort;PortOwnerValid=$realmOwner;Ready=$realmReady}
            Mangosd=[pscustomobject]@{Name=$MangosdService;State=[string]$worldSvc.State;StartMode=[string]$worldSvc.StartMode;ProcessId=[int]$worldSvc.ProcessId;CreatedUtc=$(if($worldIdentity){$worldIdentity.CreatedUtc}else{$null});Generation=$(if($worldIdentity){$worldIdentity.Generation}else{$null});Port8085=$worldPort;Port8085OwnerValid=$worldOwner;Soap7878=$soapPort;SoapLocalhostOwnerValid=$soapOwner;WorldInitialized=$initialized;MaintenanceMatches=$maintenanceMatches;Ready=$worldReady}
        }
        Maintenance=[pscustomobject]@{Phase=$state.Phase;Sequence=$state.Sequence;Generation=$state.Generation}
        Ready=($mysqlReady -and $realmReady -and $worldReady);Fingerprint=$fingerprint
    }
}

function Get-CurrentStatus {
    param([AllowNull()][string]$ExpectedWorldGeneration=$null)
    # Two complete observations, including real readiness predicates, bracket slow SQL/log IO.
    $first=Get-ControlStatusObservation;$last=Get-ControlStatusObservation
    $consistent=($first.Fingerprint -ceq $last.Fingerprint)
    $expectedMatches=([string]::IsNullOrEmpty($ExpectedWorldGeneration) -or $last.Services.Mangosd.Generation -ceq $ExpectedWorldGeneration)
    $last.Services.MySql.Ready=[bool]($first.Services.MySql.Ready -and $last.Services.MySql.Ready -and $consistent)
    $last.Services.Realmd.Ready=[bool]($first.Services.Realmd.Ready -and $last.Services.Realmd.Ready -and $consistent)
    $last.Services.Mangosd.Ready=[bool]($first.Services.Mangosd.Ready -and $last.Services.Mangosd.Ready -and $consistent -and $expectedMatches)
    $last.Ready=[bool]($last.Services.MySql.Ready -and $last.Services.Realmd.Ready -and $last.Services.Mangosd.Ready)
    $last|Add-Member -MemberType NoteProperty -Name ObservationConsistent -Value $consistent
    $last.PSObject.Properties.Remove('Fingerprint')
    return $last
}

function Wait-ServiceState {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [Parameter(Mandatory=$true)][ValidateSet('Running','Stopped')][string]$State,
        [Parameter(Mandatory=$true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    do {
        $svc = Get-ServiceCim -Name $Name
        if ($svc -and $svc.State -eq $State) {
            return $true
        }

        Start-Sleep -Seconds 1
    }
    while ((Get-Date) -lt $deadline)

    return $false
}

function Wait-MySqlReady {
    param([int]$TimeoutSeconds = 180)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    do {
        $svc = Get-ServiceCim -Name $MySqlService
        if (
            $svc -and
            $svc.State -eq 'Running' -and
            (Test-PortOwnerPath -Port 3306 -ExpectedPath $MySqlExe)
        ) {
            try {
                if (Test-MySqlQuery) {
                    return $true
                }
            }
            catch {}
        }

        Start-Sleep -Seconds 2
    }
    while ((Get-Date) -lt $deadline)

    return $false
}

function Wait-RealmdReady {
    param([int]$TimeoutSeconds = 120)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    do {
        $svc = Get-ServiceCim -Name $RealmdService
        if (
            $svc -and
            $svc.State -eq 'Running' -and
            [int]$svc.ProcessId -gt 0 -and
            (Test-PortOwnerPath -Port 3724 -ExpectedPath $RealmdExe -ExpectedPid ([int]$svc.ProcessId))
        ) {
            return $true
        }

        Start-Sleep -Seconds 1
    }
    while ((Get-Date) -lt $deadline)

    return $false
}

function Wait-MangosdReady {
    param([int]$TimeoutSeconds = 1800)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    do {
        $svc = Get-ServiceCim -Name $MangosdService
        if (
            $svc -and
            $svc.State -eq 'Running' -and
            [int]$svc.ProcessId -gt 0 -and
            (Test-PortOwnerPath -Port 8085 -ExpectedPath $MangosdExe -ExpectedPid ([int]$svc.ProcessId)) -and
            (Test-PortOwnerPath -Port 7878 -ExpectedPath $MangosdExe -ExpectedPid ([int]$svc.ProcessId) -LocalhostOnly)
        ) {
            return $true
        }

        Start-Sleep -Seconds 5
    }
    while ((Get-Date) -lt $deadline)

    return $false
}

function Assert-NoUnmanagedConflicts {
    $mysqlSvc = Get-ServiceCim -Name $MySqlService
    $realmdSvc = Get-ServiceCim -Name $RealmdService
    $mangosSvc = Get-ServiceCim -Name $MangosdService

    foreach ($port in @(3306,3724,8085,7878)) {
        $listeners = @(Get-PortListeners $port)
        foreach ($listener in $listeners) {
            $ownerPid = [int]$listener.OwningProcess

            $allowed = $false

            if ($port -eq 3306 -and $mysqlSvc.State -eq 'Running') {
                $ownerPath = Get-ProcessPathById -ProcessId $ownerPid
                if ($ownerPath -eq $MySqlExe) { $allowed = $true }
            }

            if ($port -eq 3724 -and $realmdSvc.State -eq 'Running' -and $ownerPid -eq [int]$realmdSvc.ProcessId) {
                $allowed = $true
            }

            if ($port -in @(8085,7878) -and $mangosSvc.State -in @('Running','Start Pending','Stop Pending','StartPending','StopPending') -and $ownerPid -eq [int]$mangosSvc.ProcessId) {
                $allowed = $true
            }

            if (-not $allowed) {
                $ownerPath = Get-ProcessPathById -ProcessId $ownerPid
                throw "Unmanaged/conflicting listener detected: port=$port pid=$ownerPid path=$ownerPath"
            }
        }
    }

    $realmdProcesses = @(Get-CimInstance Win32_Process -Filter "Name='realmd.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $realmdProcesses) {
        if ($realmdSvc.State -ne 'Running' -or [int]$proc.ProcessId -ne [int]$realmdSvc.ProcessId) {
            throw "Unmanaged realmd.exe detected: PID=$($proc.ProcessId)"
        }
    }

    $mangosProcesses = @(Get-CimInstance Win32_Process -Filter "Name='mangosd.exe'" -ErrorAction SilentlyContinue)
    foreach ($proc in $mangosProcesses) {
        if ($mangosSvc.State -notin @('Running','Start Pending','Stop Pending','StartPending','StopPending') -or [int]$proc.ProcessId -ne [int]$mangosSvc.ProcessId) {
            throw "Unmanaged mangosd.exe detected: PID=$($proc.ProcessId)"
        }
    }
}

function Start-BackendService {
    param([Parameter(Mandatory=$true)][string]$Name)

    $svc = Get-ServiceCim -Name $Name
    if (-not $svc) {
        throw "Required service missing: $Name"
    }

    if ($svc.State -eq 'Running') {
        Write-RunLog DATA "SERVICE_ALREADY_RUNNING=$Name"
        return
    }

    if ($svc.State -ne 'Stopped') {
        throw "Service $Name is in unsupported state $($svc.State)"
    }

    Write-RunLog INFO "START_SERVICE=$Name"
    Start-Service -Name $Name -ErrorAction Stop
    $StartedThisRun.Add($Name)
}

# Isolated candidate: no top-level operation. These functions replace the old backend stop helper.
function Need([bool]$Value,[string]$Message){if(!$Value){throw $Message}}
function Get-RequiredUInt32($Object,[string]$Property){
    if($null -eq $Object){throw ('STOP_METADATA_NULL_OBJECT '+$Property)}
    $p=$Object.PSObject.Properties[$Property]
    if($null -eq $p -or $null -eq $p.Value){throw ('STOP_METADATA_MISSING_OR_NULL '+$Property)}
    $v=$p.Value
    if(($v -isnot [int] -and $v -isnot [uint32] -and $v -isnot [long] -and $v -isnot [uint64]) -or $v -lt 0 -or $v -gt [uint32]::MaxValue){throw ('STOP_METADATA_INVALID '+$Property)}
    return [long]$v
}
function Get-BackendStopDefinitionFix3([string]$Name){
 $paths=@{mangosd=$script:MangosdExe;realmd=$script:RealmdExe;'VMANGOS-MySQL'=$script:MySqlExe}
 if(!$paths.ContainsKey($Name)){throw 'STOP_SERVICE_ALLOWLIST'}
 $config=Join-Path $script:Runtime ($Name+'.conf');$others=@()
 if($Name -ceq 'mangosd'){$others=@('C:\Scripts\WOW-R3-DEV-R1\runtime\mangosd.exe')}
 if($Name -ceq 'realmd'){$others=@('C:\Scripts\WOW-R3-DEV-R1\runtime\realmd.exe')}
 if($Name -ceq 'VMANGOS-MySQL'){$config=Join-Path $script:MySqlRoot 'my-vmangos-service.ini'}
 $scope=$null;$variable=Get-Variable -Name ProductionMaintenanceScopeFix4 -Scope Script -ErrorAction SilentlyContinue;if($null -ne $variable){$scope=$variable.Value}
 [pscustomobject]@{Name=$Name;Exe=$paths[$Name];Config=$config;OtherImages=$others;OtherConfigs=@('C:\Scripts\WOW-R3-DEV-R1\my.ini');EvidenceBase=$script:Diagnostics;MaintenanceScope=$scope}
}
function Get-BackendStopObservation([string]$Name,[switch]$Transition,$Expected,$Journal){
 Read-StopObservationFix3 (Get-BackendStopDefinitionFix3 $Name) ([bool]$Transition) $Expected $Journal
}
function Assert-BackendQuiescent([string]$Name){
    $s=Get-BackendStopObservation $Name
    if($Name -ceq 'mangosd' -and (Test-WorldMaintenancePermitFix4 (Get-BackendStopDefinitionFix3 $Name))){
        $proof=$script:ProductionMaintenanceScopeFix4.Permit.Completion
        $permit=$script:ProductionMaintenanceScopeFix4.Permit
        if($null -eq $proof -or $proof.Result -cne 'PASS' -or @($proof.ProcessExits).Count -ne 1 -or $proof.ProcessExits[0].PID -ne $permit.PID -or $proof.ProcessExits[0].Path -cne $permit.Exe -or ([DateTimeOffset]::Parse($proof.ProcessExits[0].CreatedUtc)).UtcTicks -ne ([DateTimeOffset]::Parse($permit.CreatedUtc)).UtcTicks -or $proof.ProcessExits[0].Measurement -cne 'MEASURED' -or $null -eq $proof.ProcessExits[0].NativeExit -or $proof.ProcessExits[0].NativeExit -ne 0){throw 'WORLD_PREDECESSOR_NATIVE_RESULT_UNKNOWN'}
    }
    if($s.State -cne 'Stopped' -or $s.PID -ne 0 -or @($s.Processes).Count -ne 0 -or $s.Win32ExitCode -ne 0 -or $s.SpecificExitCode -ne 0){
        throw ('DEPENDENCY_NOT_CONFIRMED_DOWN '+$Name+' State='+$s.State+' ServicePID='+$s.PID+' ProcessCount='+@($s.Processes).Count+' Win32Exit='+$s.Win32ExitCode+' SpecificExit='+$s.SpecificExitCode)
    }
}
function Request-BackendStop([string]$Name,[int]$RemainingMilliseconds){
    # Existing approved capture; no native exit inference, no force stop or retry.
    $captureRoot='C:\Scripts\MANGOS-AFTERBOOT-VERIFY-R2-WOW-SRV-20261101-0110-PAYLOAD'
    foreach($pin in @(@{Name='Process.Capture.ps1';SHA256='91D7A3E1CA6E0B430C338566A2B01C273AE41F8314160ECBDD649067409D1534'},@{Name='Repair.Native.cs';SHA256='322C5C51687A09A6766425CE017A152DD0EE28D0054EB464FB0866F22EBE7CA3'})){
        if((Get-FileHash -LiteralPath (Join-Path $captureRoot $pin.Name) -Algorithm SHA256).Hash -cne $pin.SHA256){throw ('CAPTURE_DEPENDENCY_PIN '+$pin.Name)}
    }
    . (Join-Path $captureRoot 'Process.Capture.ps1')
    $evidence=Join-Path 'C:\GRY\wow\diagnostics' ('BACKEND-STOP-'+$Name+'-'+[guid]::NewGuid().ToString('N'))
    $r=Invoke-CapturedProcessR2 'C:\Windows\System32\sc.exe' ('stop '+$Name) $evidence -TimeoutMilliseconds $RemainingMilliseconds
    if($r.State -cne 'EXECUTED_PASS' -or $r.ExitCode -ne 0 -or !$r.StreamsCaptured){throw ('BACKEND_STOP_REQUEST_UNCONFIRMED '+$Name+' Evidence='+$evidence+' State='+$r.State+' Exit='+$r.ExitCode)}
}
function Stop-BackendService {
 param([Parameter(Mandatory=$true)][string]$Name,[Parameter(Mandatory=$true)][ValidateRange(1,900)][int]$TimeoutSeconds,[string]$EvidenceBase)
 if($Name -cnotin @('realmd','VMANGOS-MySQL')){throw 'BACKEND_STOP_ALLOWLIST'}
 if([string]::IsNullOrWhiteSpace($EvidenceBase)){$EvidenceBase=$script:Diagnostics}
 $required=@('mangosd');if($Name -ceq 'VMANGOS-MySQL'){$required+=@('realmd')}
 $dependencies={foreach($dependency in $required){Assert-BackendQuiescent $dependency}}.GetNewClosure()
 $strict={param($j)Get-BackendStopObservation $Name -Journal $j}.GetNewClosure()
 $transition={param($j,$expected)Get-BackendStopObservation $Name -Transition -Expected $expected -Journal $j}.GetNewClosure()
 $request={Request-BackendStop $Name ([int]([long]$TimeoutSeconds*1000))}.GetNewClosure()
 Invoke-RetainedStopFix3 $Name $strict $transition $request $dependencies $EvidenceBase (Join-Path $EvidenceBase ($Name+'-ACTUAL-STOP.json')) $TimeoutSeconds
}
function Invoke-StartAll {
    $dependencies=@{
        StartMySQL={Assert-NoUnmanagedConflicts;Start-BackendService $MySqlService;if(!(Wait-MySqlReady 180)){throw 'MySQL readiness timeout'}}
        StartRealm={Start-BackendService $RealmdService;if(!(Wait-RealmdReady 120)){throw 'Realm readiness timeout'}}
        VerifyCapability={Assert-RebootCoreCapability}
        BootEvidence={param($claim) Get-ControlBootEvidence $claim}
    }
    $finalize={param($world) Get-CurrentStatus -ExpectedWorldGeneration $world.Generation}
    $result=Invoke-ControlStack -Root $MaintenanceRoot -Service 'mangosd' -Action Start-All -Driver $WorldDriver -Dependencies $dependencies -Boot:$Boot -Timeout 900 -Finalize $finalize
    if($null -ne $result.PSObject.Properties['Skipped'] -and $result.Skipped){Write-RunLog DATA 'BOOT_SKIPPED_MAINTENANCE=True';return [pscustomobject]@{Ready=$false;Maintenance=$true}}
    return $result
}

function Invoke-StopAll {
    param([ValidateRange(1,900)][int]$TimeoutSeconds=900)
    $dependencies=@{
        StopRealm={Assert-NoUnmanagedConflicts;if(@(Get-PortListeners 8085).Count -or @(Get-PortListeners 7878).Count){throw 'World port remains'};Stop-BackendService $RealmdService ([Math]::Min(180,$TimeoutSeconds));if(@(Get-PortListeners 3724).Count){throw 'Realm port remains'}}
        StopMySQL={Stop-BackendService $MySqlService ([Math]::Min(180,$TimeoutSeconds));if(@(Get-PortListeners 3306).Count){throw 'MySQL port remains'}}
    }
    [void](Invoke-ControlStack -Root $MaintenanceRoot -Service 'mangosd' -Action Stop-All -Driver $WorldDriver -Dependencies $dependencies -Timeout $TimeoutSeconds)
    return Get-CurrentStatus
}

function Get-ControlBootUtc {
    (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')
}
function Get-ControlBootEvidence($Claim){
    $since=([DateTimeOffset]::Parse($Claim.RequestAtUtc)).UtcDateTime
    $requests=@();$boots=@()
    foreach($spec in @(@{Id=1074;ProviderName='User32';Role='Request'},@{Id=12;ProviderName='Microsoft-Windows-Kernel-General';Role='Boot'})){
        $events=@()
        try{$events=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName=$spec.ProviderName;Id=$spec.Id;StartTime=$since} -MaxEvents 64 -ErrorAction Stop)}catch{if($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*'){throw}}
        if($events.Count -ge 64){throw 'REBOOT_EVENT_WINDOW_AMBIGUOUS'}
        foreach($event in $events){
            $xml=[xml]$event.ToXml();$data=@{};foreach($item in $xml.Event.EventData.Data){$data[[string]$item.Name]=[string]$item.'#text'}
            if($spec.Role -ceq 'Boot'){
                if(!$data.ContainsKey('StartTime')){throw 'REBOOT_BOOT_EVENT_STARTTIME_MISSING'}
                $boots+=[pscustomobject]@{BootUtc=([DateTimeOffset]::Parse($data.StartTime)).ToUniversalTime().ToString('o');RecordId=[long]$event.RecordId}
            }else{
                if(!$data.ContainsKey('param1') -or !$data.ContainsKey('param7')){throw 'REBOOT_REQUEST_EVENT_FIELDS_MISSING'}
                $requests+=[pscustomobject]@{AtUtc=$event.TimeCreated.ToUniversalTime().ToString('o');Host=[string]$event.MachineName;Image=$data.param1;Comment=$data.param7;RecordId=[long]$event.RecordId}
            }
        }
    }
    [pscustomobject]@{CurrentBootUtc=(Get-ControlBootUtc);Requests=$requests;Boots=$boots}
}
function Assert-RebootCoreCapability {
    $path=Join-Path $PSScriptRoot 'REBOOT-CAPABILITY.json'
    Assert-BootstrapPrivate $path
    $value=[IO.File]::ReadAllText($path)|ConvertFrom-Json
    if($value.Schema -ne 1 -or $value.Approved -isnot [bool] -or !$value.Approved -or $value.SqlOutcomeVersion -ne 2){throw 'REBOOT_CAPABILITY_SCHEMA_OR_APPROVAL'}
    foreach($role in @('mangosd','realmd')){
        $entry=$value.$role;$expected=Join-Path 'C:\GRY\wow\serwer-dev' ($role+'.exe')
        if($entry.Path -cne $expected -or $entry.SHA256 -cnotmatch '^[A-F0-9]{64}$' -or (Get-FileHash -LiteralPath $entry.Path).Hash -cne $entry.SHA256){throw ('REBOOT_CORE_CAPABILITY_IMAGE '+$role)}
    }
    [pscustomobject]@{Approved=$true;Path=$path;SHA256=(Get-FileHash $path).Hash;SqlOutcomeVersion=2}
}
function Invoke-ControlRebootNativeFix4R2($context){
            $captureRoot='C:\Scripts\MANGOS-AFTERBOOT-VERIFY-R2-WOW-SRV-20261101-0110-PAYLOAD'
            foreach($pin in @(@{Name='Process.Capture.ps1';SHA256='91D7A3E1CA6E0B430C338566A2B01C273AE41F8314160ECBDD649067409D1534'},@{Name='Repair.Native.cs';SHA256='322C5C51687A09A6766425CE017A152DD0EE28D0054EB464FB0866F22EBE7CA3'})){
                if((Get-FileHash (Join-Path $captureRoot $pin.Name)).Hash -cne $pin.SHA256){throw 'REBOOT_CAPTURE_DEPENDENCY_PIN'}
            }
            if((Get-AuthenticodeSignature 'C:\Windows\System32\shutdown.exe').Status -ne 'Valid'){throw 'REBOOT_UTILITY_SIGNATURE'}
            . (Join-Path $captureRoot 'Process.Capture.ps1')
            $evidence=Join-Path 'C:\GRY\wow\diagnostics' ('PLANNED-REBOOT-REQUEST-'+$context.Operation)
            $r=Invoke-CapturedProcessR2 'C:\Windows\System32\shutdown.exe' ('/r /t 0 /d p:4:1 /c "WOW-SRV controlled Operation='+$context.Operation+'"') $evidence -TimeoutMilliseconds 10000
            [pscustomobject]@{ResultKnown=($null -ne $r.ExitCode -and $r.StreamsCaptured);ExitCode=$r.ExitCode;Evidence=$evidence;NoRetry=$true}
}
function Invoke-PlannedAdministrativeReboot {
    param([ValidateRange(1,900)][int]$TimeoutSeconds=900)
    $dependencies=@{
        VerifyCapability={Assert-RebootCoreCapability}
        CurrentBoot={Get-ControlBootUtc}
        ObserveReady={Get-CurrentStatus}
        StopRealm={Assert-NoUnmanagedConflicts;Stop-BackendService $RealmdService ([Math]::Min(180,$TimeoutSeconds))}
        StopMySQL={Stop-BackendService $MySqlService ([Math]::Min(180,$TimeoutSeconds))}
        Checkpoint={param($context,$stopped)
            $path=Join-Path $script:Diagnostics ('PLANNED-REBOOT-CHECKPOINT-'+$context.Operation+'.json')
            $value=@{Session='01a19436-72e3-7970-b187-c1344eb2e6d9';Shortcut='WOW-SRV - WZNOW CODEX R2 - ADMIN.lnk';Model='gpt-6.1-sol';Reasoning='high';CLI='--cd C:\GRY --sandbox danger-full-access --ask-for-approval never';Maintenance=$true;Stopped=$stopped;CodexAfterRealReboot='PENDING_REAL_REBOOT';Next='After login resume the same session; verify actual account/token/cwd/CLI/read-write before any explicit Start-All';At=[DateTimeOffset]::UtcNow.ToString('o')}
            [IO.File]::WriteAllText($path,(ConvertTo-Json -InputObject $value -Depth 15),[Text.UTF8Encoding]::new($true))
            [pscustomobject]@{Saved=$true;Path=$path;SHA256=(Get-FileHash $path).Hash}
        }
        RequestReboot={param($context)Invoke-ControlRebootNativeFix4R2 $context}
    }
    Invoke-ControlStack -Root $MaintenanceRoot -Service 'mangosd' -Action Planned-Reboot -Driver $WorldDriver -Dependencies $dependencies -Timeout $TimeoutSeconds
}
function Invoke-RestartWorld {
    Assert-NoUnmanagedConflicts
    $dependencies=@{RequireReady={if(!(Wait-MySqlReady 5) -or !(Wait-RealmdReady 5)){throw 'Restart requires existing ready dependencies'}}}
    $finalize={param($world) Get-CurrentStatus -ExpectedWorldGeneration $world.Generation}
    return Invoke-ControlStack -Root $MaintenanceRoot -Service 'mangosd' -Action Restart-World -Driver $WorldDriver -Dependencies $dependencies -Timeout 900 -Finalize $finalize
}

function Invoke-StartupRollback { Write-RunLog WARN 'AUTOMATIC_DEPENDENCY_ROLLBACK_DISABLED_REVIEW_MAINTENANCE_JOURNAL' }

try {
    if ($env:COMPUTERNAME -ne $ExpectedHost) {
        throw "HOST GUARD FAILED: expected=$ExpectedHost actual=$env:COMPUTERNAME"
    }

    foreach ($file in @($MySqlExe,$MySqlClient,$RealmdExe,$MangosdExe,$MangosdConf)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Required file missing: $file"
        }
    }

    foreach ($name in @($MySqlService,$RealmdService,$MangosdService)) {
        if (-not (Get-ServiceCim -Name $name)) {
            throw "Required service missing: $name"
        }
    }

    Write-RunLog INFO '============================================================'
    Write-RunLog INFO "VMANGOS CONTROL - $Action"
    Write-RunLog INFO '============================================================'
    Write-RunLog DATA "HOST=$env:COMPUTERNAME"
    Write-RunLog DATA "ACTION=$Action"
    Write-RunLog DATA "LOG=$Log"

    $result = switch ($Action) {
        'Status'        { Get-CurrentStatus }
        'Start-All'     { Invoke-StartAll }
        'Stop-All'      { Invoke-StopAll }
        'Planned-Reboot'{ Invoke-PlannedAdministrativeReboot }
        'Restart-World' { Invoke-RestartWorld }
    }

    Write-RunLog OK 'OK=True'
    Write-RunLog DATA "READY=$($result.Ready)"
    Write-RunLog DATA 'DATABASE_CHANGED=False'
    Write-RunLog DATA 'CONFIG_CHANGED=False'
    Write-RunLog DATA 'FORCE_KILL_USED=False'
    Write-RunLog DATA "LOG=$Log"

    if ($Json) {
        [pscustomobject]@{
            Ok = $true
            Action = $Action
            Log = $Log
            Status = $result
        } | ConvertTo-Json -Depth 8 -Compress
    }
}
catch {
    $message = $_.Exception.Message

    if ($Action -eq 'Start-All') {
        Invoke-StartupRollback
    }

    try {
        Write-RunLog ERROR "ERROR=$message"
        Write-RunLog ERROR 'OK=False'
        Write-RunLog DATA 'DATABASE_CHANGED=False'
        Write-RunLog DATA 'CONFIG_CHANGED=False'
        Write-RunLog DATA 'FORCE_KILL_USED=False'
        Write-RunLog DATA "LOG=$Log"
    }
    catch {}

    if ($Json) {
        [pscustomobject]@{
            Ok = $false
            Action = $Action
            Error = $message
            Log = $Log
        } | ConvertTo-Json -Depth 5 -Compress
    }

    exit 1
}

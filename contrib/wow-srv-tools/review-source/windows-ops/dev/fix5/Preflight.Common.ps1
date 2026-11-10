. (Join-Path $PSScriptRoot Kit.Common.ps1)
AssertKitPins
$script:Kit=$Root;$script:Plan=ReadJson (Join-Path $Root KIT-PLAN.json)
$script:Accepted=$Plan.AcceptedDevAcceptance.Receipt
$script:Options='C:\ProgramData\VMANGOS\R3Approvals\source-backup-candidate.ini'
. (Join-Path $Root Native.Driver.ps1)
Add-Type -Path (Join-Path $Root dependencies\Release.Native.cs)
$helper='C:\Scripts\DEV-INPUTS-PREP-R1-WOW-SRV-20261105-0206-PAYLOAD\Inputs.Common.ps1'
Need ((Hash $helper) -ceq '8F8A42CEEA8FEF0AEE251ABC79BDEC2C91CA944CCAD7358EF78A0F02569DB41A') 'READ_HELPER_PIN'
$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($helper,[ref]$t,[ref]$e)
foreach($name in @('InvokeReadQuery','AssertSourceInstance','SecureNewJson')){
 $n=@($a.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -ceq $name},$false))
 Need ($n.Count -eq 1) 'HELPER_FUNCTION';. ([scriptblock]::Create($n[0].Extent.Text))
}
$script:QueryCount=0
function NewRaw {$p=Join-Path $Out ('private-raw-'+[guid]::NewGuid().ToString('N'));[WowReleaseV1.Secure]::NewDirectory($p,$false);return $p}
function ReadProtected([string]$Path){[WowReleaseV1.Secure]::Verify($Path,$false,$false);return ([WowReleaseV1.Secure]::Read($Path,$false)|ConvertFrom-Json)}
function ServiceMetadata([string]$Name){
 $s=Get-CimInstance Win32_Service -Filter ("Name='"+$Name+"'") -ErrorAction Stop;Need ($null -ne $s) ('SERVICE_MISSING '+$Name)
 $reg=Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\'+$Name)
 [pscustomobject]@{Name=$Name;State=[string]$s.State;PID=[long]$s.ProcessId;ImagePath=[string]$s.PathName;Account=[string]$s.StartName;StartMode=[string]$s.StartMode;Win32=[long]$s.ExitCode;Specific=[long]$s.ServiceSpecificExitCode;Dependencies=@($(if($reg.PSObject.Properties['DependOnService']){$reg.DependOnService})|Where-Object {$null -ne $_}|Sort-Object)}
}

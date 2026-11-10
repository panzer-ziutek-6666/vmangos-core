param([switch]$Before,[string]$RunTag='TASK-BASELINE-FINAL')
Set-StrictMode -Version Latest;$ErrorActionPreference='Stop'
$target=$(if($Before){'C:\Scripts\SHUTDOWN1053-DEV-MIGRATION-PREP-R2-FIX4-R2-WOW-SRV-20261107-1454-PAYLOAD'}else{$PSScriptRoot})
. (Join-Path $target Kit.Common.ps1)
. (Join-Path $target Native.Driver.ps1)
$script:Out='C:\GRY\wow\diagnostics\SHUTDOWN1053-DEV-MIGRATION-PREP-R2-FIX5-WOW-SRV-20261108-1818'
$script:Plan=ReadJson (Join-Path $target KIT-PLAN.json)
$script:ActualNewObject=Get-Command New-Object -CommandType Cmdlet
function New-Object {
 param([string]$TypeName,[string]$ComObject)
 if($ComObject -ceq 'Schedule.Service'){return $script:Scheduler}
 if($ComObject){throw 'UNAPPROVED_COM_BOUNDARY'}
 & $script:ActualNewObject $TypeName
}
function Get-ScheduledTask([string]$TaskName,[string]$TaskPath){
 Need ($TaskPath -ceq '\' -and $script:TaskModels.ContainsKey($TaskName)) 'TASK_FIXTURE_ONLY'
 $m=$script:TaskModels[$TaskName]
 [pscustomobject]@{State=$m.State;Settings=[pscustomobject]@{Enabled=$m.Enabled}}
}
function Export-ScheduledTask([string]$TaskName,[string]$TaskPath){Need ($script:TaskModels.ContainsKey($TaskName)) 'EXPORT_FIXTURE_ONLY';return $script:TaskModels[$TaskName].XML}
$results=[Collections.Generic.List[object]]::new()
$scenarios=$(if($Before){@('ExplicitEnabled')}else{@('ExplicitEnabled','OmittedEnabledTrue','OtherSettingDrift','ActionDrift','SDDLDrift','EnabledDrift','TaskRunning','DuplicateEnabled')})
foreach($scenario in $scenarios){
 $script:TaskModels=@{}
 foreach($t in $Plan.Tasks){
  $doc=[xml][IO.File]::ReadAllText((Join-Path $target ('tasks\baseline\'+$t.Name+'.xml')))
  $ns=[Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $node=$doc.SelectSingleNode('/t:Task/t:Settings/t:Enabled',$ns)
  if($null -eq $node){$node=$doc.CreateElement('Enabled',$doc.DocumentElement.NamespaceURI);[void]$doc.Task.Settings.AppendChild($node)}
  $node.InnerText=$t.Enabled.ToString().ToLowerInvariant()
  if($scenario -ceq 'OmittedEnabledTrue' -and $t.Enabled){[void]$node.ParentNode.RemoveChild($node)}
  if($t.Name -ceq 'VMANGOS-ADMIN-PANEL-START-ALL'){
   if($scenario -ceq 'OtherSettingDrift'){$doc.Task.Settings.ExecutionTimeLimit='PT11M'}
   if($scenario -ceq 'ActionDrift'){$doc.Task.Actions.Exec.Command='C:\not-approved.exe'}
   if($scenario -ceq 'DuplicateEnabled'){[void]$node.ParentNode.AppendChild($node.Clone())}
  }
  $script:TaskModels[$t.Name]=[pscustomobject]@{Enabled=$(if($scenario -ceq 'EnabledDrift' -and $t.Enabled){$false}else{[bool]$t.Enabled});State=$(if($scenario -ceq 'TaskRunning'){'Running'}else{'Ready'});XML=$doc.OuterXml;SDDL=$(if($scenario -ceq 'SDDLDrift'){'O:SYG:SYD:P(A;;FA;;;SY)'}else{$Plan.TaskSDDL.($t.Name)})}
 }
 $script:Folder=[pscustomobject]@{};$script:Folder|Add-Member ScriptMethod GetTask {param($n)$task=[pscustomobject]@{Name=$n};$task|Add-Member ScriptMethod GetSecurityDescriptor {param($flags)return $script:TaskModels[$this.Name].SDDL};return $task}
 $script:Scheduler=[pscustomobject]@{};$script:Scheduler|Add-Member ScriptMethod Connect {}; $script:Scheduler|Add-Member ScriptMethod GetFolder {param($p)if($p -cne '\'){throw 'FOLDER_FIXTURE_ONLY'};return $script:Folder}
 $errorText=$null;try{AssertTaskBaseline ([pscustomobject]@{Plan=$Plan})}catch{$errorText=$_.Exception.Message}
 $expectedFailure=$Before -or $scenario -cnotin @('ExplicitEnabled','OmittedEnabledTrue')
 Need ($expectedFailure -eq ($null -ne $errorText)) ('TASK_CASE_RESULT '+$scenario+' '+$errorText)
 $results.Add([pscustomobject]@{Name=$scenario;Result='PASS';ActualBaselineResult=$(if($errorText){'REFUSED'}else{'ACCEPTED'});Error=$errorText;RealTaskChanges=0})
 $scenario+'=PASS'
}
SaveJson ($RunTag+'.json') @{Result='PASS';Total=$results.Count;Passed=$results.Count;Tests=$results.ToArray();TestedFiles=@([pscustomobject]@{Path='Production.ps1';SHA256=(Hash (Join-Path $target Production.ps1))},[pscustomobject]@{Path='Test-TaskBaseline-Fix5.ps1';SHA256=(Hash $PSCommandPath)});Boundary='Actual AssertTaskBaseline, individual COM/ScheduledTask read boundaries use fixtures. Only Enabled is removed from XML; actual Enabled and SDDL are separate exact checks. No scheduler mutation.';PS=$PSVersionTable.PSVersion.ToString()}
'OK=True';'CHANGE_SCOPE=TASK_BASELINE_XML_REPRESENTATION_ISOLATED';'LOG='+$Out;'NEXT_STEP=Finalize pins then read-only preflight'

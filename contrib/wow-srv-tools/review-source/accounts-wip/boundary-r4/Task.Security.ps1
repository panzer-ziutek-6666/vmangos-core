# Shared by operational parent, independent verifier and disabled-only API QA.
Set-StrictMode -Version Latest
function Get-BoundaryTaskPolicy {
    [pscustomobject][ordered]@{Schema='BOUNDARY-TASK-SECURITY-4';OwnerSid='S-1-5-32-544';GroupSid='S-1-5-32-544';SDDL='O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)';PrincipalSid='S-1-5-18';LogonType=5;CreateFlags=58;LockFlags=60}
}
function Get-BoundaryTaskToken {
    if(-not ('BoundaryR4.QueryToken' -as [type])){Add-Type -Path (Join-Path $PSScriptRoot 'Task.Token.cs')}
    return [BoundaryR4.QueryToken]::Read()
}
function Assert-BoundaryTaskOwnerLegal($Token) {
    $ba=@($Token.Groups|Where-Object Sid -CEQ 'S-1-5-32-544')
    Need ($Token.TokenType -eq 1 -and $Token.Elevated -eq 1 -and $ba.Count -eq 1 -and ($ba[0].Attributes -band 8) -eq 8 -and ($ba[0].Attributes -band 4) -eq 4 -and ($ba[0].Attributes -band 16) -eq 0) 'TASK_OWNER_BA_NOT_LEGAL_IN_CURRENT_TOKEN'
}
function Assert-BoundaryTaskDescriptor([string]$Sddl) {
    $sd=[Security.AccessControl.RawSecurityDescriptor]::new($Sddl)
    Need ($sd.Owner.Value -ceq 'S-1-5-32-544' -and $sd.Group.Value -ceq 'S-1-5-32-544' -and ($sd.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0 -and $null -ne $sd.DiscretionaryAcl -and $sd.DiscretionaryAcl.Count -eq 2) 'TASK_OWNER_GROUP_PROTECTED_DACL'
    $seen=@{}
    foreach($ace in $sd.DiscretionaryAcl){
        Need ($ace -is [Security.AccessControl.CommonAce] -and $ace.AceType -eq [Security.AccessControl.AceType]::AccessAllowed -and $ace.AceFlags -eq [Security.AccessControl.AceFlags]::None -and $ace.AccessMask -eq 2032127 -and $ace.SecurityIdentifier.Value -cin @('S-1-5-18','S-1-5-32-544') -and -not $seen.ContainsKey($ace.SecurityIdentifier.Value)) 'TASK_EXACT_SY_BA_FULL_CONTROL'
        $seen[$ace.SecurityIdentifier.Value]=$true
    }
}
function Resolve-BoundaryTaskSid([string]$Name){
    if($Name -match '^S-'){return ([Security.Principal.SecurityIdentifier]::new($Name)).Value}
    return ([Security.Principal.NTAccount]::new($Name)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Assert-BoundaryTaskDefinition($Definition,[string]$RunId,[bool]$AllowDemand) {
    Need ($RunId -cmatch '\A[0-9a-f]{32}\z' -and $Definition.RegistrationInfo.Description -ceq $RunId -and -not $Definition.Settings.Enabled -and [bool]$Definition.Settings.AllowDemandStart -eq $AllowDemand -and $Definition.Triggers.Count -eq 0 -and $Definition.Settings.RestartCount -eq 0 -and $Definition.Settings.MultipleInstances -eq 2 -and $Definition.Principal.LogonType -eq 5 -and $Definition.Principal.RunLevel -eq 1 -and (Resolve-BoundaryTaskSid $Definition.Principal.UserId) -ceq 'S-1-5-18' -and $Definition.Actions.Count -eq 1) 'TASK_DISABLED_SYSTEM_DEFINITION'
}
function Get-BoundaryTaskSecurityEvidence($Task,[string]$Name,[string]$RunId,[bool]$AllowDemand) {
    Need ($Task.Name -ceq $Name -and -not $Task.Enabled -and $Task.GetInstances(0).Count -eq 0) 'TASK_NAME_DISABLED_NO_INSTANCE'
    Assert-BoundaryTaskDefinition $Task.Definition $RunId $AllowDemand
    $comSddl=$Task.GetSecurityDescriptor(7)
    Assert-BoundaryTaskDescriptor $comSddl
    $file=Join-Path 'C:\Windows\System32\Tasks' $Name
    $item=Get-Item -LiteralPath $file -Force
    Need (-not $item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'TASK_FILE_KIND'
    $fileSddl=(Get-Acl -LiteralPath $file).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]14)
    Assert-BoundaryTaskDescriptor $fileSddl
    return [pscustomobject]@{Name=$Name;RunId=$RunId;Xml=[string]$Task.Xml;ComSDDL=$comSddl;FileSDDL=$fileSddl;FileSHA256=(Hash $file);Enabled=[bool]$Task.Enabled;AllowDemandStart=[bool]$Task.Definition.Settings.AllowDemandStart;Instances=$Task.GetInstances(0).Count;LastTaskResult=$Task.LastTaskResult;LastRunTime=([datetime]$Task.LastRunTime).ToString('o');State=[int]$Task.State;ObservedUtc=[DateTime]::UtcNow.ToString('o')}
}
function Register-BoundaryTask {
    param($Folder,[string]$Name,$Definition,[string]$RunId,[ValidateSet('Create','Lock')][string]$Mode,[string]$EvidenceRoot)
    Need ($Name -cmatch '\AVMANGOS-BOUNDARY-R4-20261027-2355-(Verify|Fixture|SECURITY-QA)\z') 'R4_TASK_NAME_SCOPE'
    $token=Get-BoundaryTaskToken;Assert-BoundaryTaskOwnerLegal $token
    $policy=Get-BoundaryTaskPolicy
    $existing=@($Folder.GetTasks(1)|Where-Object {$_.Name -ceq $Name})
    if($Mode -ceq 'Create'){Need ($existing.Count -eq 0) 'TASK_ALREADY_EXISTS_NO_RETRY';$flags=$policy.CreateFlags;$demand=$true}
    else{
        Need ($existing.Count -eq 1 -and $existing[0].Definition.RegistrationInfo.Description -ceq $RunId -and -not $existing[0].Enabled -and $existing[0].GetInstances(0).Count -eq 0) 'TASK_LOCK_IDENTITY'
        $beforeDemand=[bool]$existing[0].Definition.Settings.AllowDemandStart
        $null=Get-BoundaryTaskSecurityEvidence $existing[0] $Name $RunId $beforeDemand
        $flags=$policy.LockFlags;$demand=$false
    }
    Assert-BoundaryTaskDefinition $Definition $RunId $demand
    $record=[ordered]@{Mode=$Mode;Name=$Name;RunId=$RunId;Flags=$flags;RequestedSDDL=$policy.SDDL;Token=$token;HRESULT=$null;Accepted=$false;Error=$null;Security=$null}
    try{
        $registered=$Folder.RegisterTaskDefinition($Name,$Definition,$flags,'S-1-5-18',$null,5,$policy.SDDL)
        $record.HRESULT='0x00000000'
        $record.Security=Get-BoundaryTaskSecurityEvidence $registered $Name $RunId $demand
        $record.Accepted=$true
        return $registered
    }catch{
        $leaf=$_.Exception;while($null -ne $leaf.InnerException){$leaf=$leaf.InnerException}
        $record.HRESULT=('0x'+([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$leaf.HResult),0)).ToString('X8'))
        $record.Error=$_.Exception.Message
        throw
    }finally{
        PutJson (Join-Path $EvidenceRoot ('TASK-REGISTER-'+$Mode+'.json')) ([pscustomobject]$record)
    }
}

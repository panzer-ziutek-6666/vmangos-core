. (Join-Path $PSScriptRoot Kit.Common.ps1)
. (Join-Path $PSScriptRoot Native.Driver.ps1)
$plan=ReadJson (Join-Path $Root KIT-PLAN.json)
Need ($plan.VersionRoot -ceq 'C:\ProgramData\VMANGOS\AdminPanelBridge\shutdown1053-r3-v2-fix5' -and !(Test-Path $plan.VersionRoot)) 'FRESH_VERSION_LOCATION_REQUIRED'
$controller=[IO.File]::ReadAllText((Join-Path $Root controller\VMANGOS-Control.ps1));$dispatcher=[IO.File]::ReadAllText((Join-Path $Root Dispatcher.ps1))
Need ($controller.Contains($plan.VersionRoot) -and $dispatcher.Contains($plan.VersionRoot) -and !$controller.Contains('shutdown1053-r3-v1') -and !$dispatcher.Contains('shutdown1053-r3-v1')) 'GUARD_ROUTING_VERSION_MISMATCH'
foreach($p in $plan.VersionPins){Need ($p.Target -ceq (Join-Path $plan.VersionRoot $p.Name) -and (Hash $p.Source) -ceq $p.SHA256) 'VERSION_PIN_TARGET_MISMATCH'}
foreach($p in $plan.Files|Where-Object Group -cin @('Version','GeneratedApproval')){Need ($p.Target.StartsWith($plan.VersionRoot+'\',[StringComparison]::OrdinalIgnoreCase)) 'VERSION_FILE_TARGET_MISMATCH'}
$oldRoot='C:\ProgramData\VMANGOS\AdminPanelBridge\shutdown1053-r3-v1'
$old=@(foreach($f in Get-ChildItem $oldRoot -File -Recurse){[pscustomobject]@{Path=$f.FullName;SHA256=(Hash $f.FullName);SDDL=(Get-Acl $f.FullName).Sddl}})
$fixture=Join-Path $Out ('version-fixture-'+[guid]::NewGuid().ToString('N'));NewPrivate $fixture
$plan.VersionRoot=Join-Path $fixture version
foreach($p in $plan.VersionPins){$p.Target=Join-Path $plan.VersionRoot $p.Name}
$run=[pscustomobject]@{Plan=$plan}
CopyStageController $run
foreach($p in $plan.VersionPins){Need ((Hash $p.Target) -ceq $p.SHA256) 'ACTUAL_STAGE_COPY_HASH'}
# Conflicting bytes in the explicit fixture must be refused, never overwritten.
$first=$plan.VersionPins[0];[IO.File]::WriteAllText($first.Target,'INTENTIONAL_FIXTURE_CONFLICT')
$denial=$null;try{CopyStageController $run}catch{$denial=$_.Exception.Message}
Need ($denial -ceq 'VERSIONED_CODE_ALREADY_DIFFERENT' -and [IO.File]::ReadAllText($first.Target) -ceq 'INTENTIONAL_FIXTURE_CONFLICT') 'CONFLICT_NOT_REFUSED'
foreach($p in $old){Need ((Hash $p.Path) -ceq $p.SHA256 -and (Get-Acl $p.Path).Sddl -ceq $p.SDDL) 'HISTORICAL_STAGING_CHANGED'}
SaveJson VERSION-BINDING-TESTS.json @{Result='PASS';Total=3;Passed=3;Tests=@('GuardRoutingAndTargetsMatch','RealCopyStageControllerToPrivateFixture','ExistingConflictingVersionRefused');OldStaging=$old;NewProductionLocationCreated=$false;ActualActivation='NOT_RUN';Fixture=$fixture;TestedFiles=@(foreach($n in @('Native.Driver.ps1','controller\VMANGOS-Control.ps1','Dispatcher.ps1','Test-VersionBinding-Fix5.ps1')){[pscustomobject]@{Path=$n;SHA256=(Hash (Join-Path $Root $n))}});Boundary='Real stage-copy code uses explicit private fixture VersionRoot/targets; active and historical staging files only hashed/read. No controller entry or approval writes.';PS=$PSVersionTable.PSVersion.ToString()}
'OK=True';'CHANGE_SCOPE=VERSION_BINDING_AND_COPY_CONFLICT_ISOLATED';'LOG='+$Out;'NEXT_STEP=Read-only migration preflight and Mode Plan'

function Get-AcceptedDevAcceptanceFix4($Run,[string]$Path){
 $b=$Run.Plan.AcceptedDevAcceptance
 Need ($Path -ceq $b.Receipt -and (Hash $Path) -ceq $b.ReceiptSHA256) 'DEV_ACCEPT_EXACT_RECEIPT_REQUIRED'
 AssertPrivate $Path;$r=ReadJson $Path
 Need ($r.Kind -ceq 'DevAccept' -and $r.Mode -ceq 'Execute' -and $r.Result -ceq 'PASS' -and $r.Phase -ceq 'Complete' -and $r.Operation -ceq $b.Operation -and $r.PlanSHA256 -ceq $b.OriginPlanSHA256 -and $r.ActualOwnServices -is [bool] -and $r.ActualOwnServices -and $null -eq $r.Error -and $null -eq $r.BarrierError -and $null -eq $r.ObservationError) 'DEV_ACCEPT_EXACT_ORIGIN_REQUIRED'
 Need ($Run.Plan.CandidateReference.id -ceq $b.CandidateReference.id -and $Run.Plan.CandidateReference.sha256 -ceq $b.CandidateReference.sha256 -and $Run.Plan.R3SHA256 -ceq $b.R3SHA256 -and @($Run.Plan.Artifacts).Count -eq @($b.Artifacts).Count) 'DEV_ACCEPT_CANDIDATE_RELEASE_BINDING'
 foreach($f in $b.Artifacts){$matches=@($Run.Plan.Artifacts|Where-Object {$_.Role -ceq $f.Role -and $_.Path -ceq $f.Path -and $_.SHA256 -ceq $f.SHA256});Need ($matches.Count -eq 1 -and (Hash $f.Path) -ceq $f.SHA256) 'DEV_ACCEPT_ARTIFACT_BINDING'}
 foreach($role in @('mangosd','realmd')){$f=@($Run.Plan.Artifacts|Where-Object Role -ceq ($role+'.exe'))[0];$property=if($role -ceq 'mangosd'){'CandidateMangosdSHA256'}else{'CandidateRealmdSHA256'};Need ($r.$property -ceq $f.SHA256) 'DEV_ACCEPT_EXE_BINDING'}
 return $r
}

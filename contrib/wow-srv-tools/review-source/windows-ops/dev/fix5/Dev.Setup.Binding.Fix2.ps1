function Get-BoundDevSetupFix2($Run,[string]$Path) {
 $binding=$Run.Plan.AcceptedDevSetup
 Need ($Path -ceq $binding.Receipt -and (Hash $Path) -ceq $binding.ReceiptSHA256) 'DEV_SETUP_EXACT_RECEIPT_REQUIRED'
 AssertPrivate $Path;$receipt=GetJson $Path
 Need ($receipt.Kind -ceq 'DevSetup' -and $receipt.Mode -ceq 'Execute' -and $receipt.Result -ceq 'PASS' -and $receipt.Phase -ceq 'Complete' -and $receipt.ActualEnvironmentProvisioned -is [bool] -and $receipt.ActualEnvironmentProvisioned -and $receipt.Operation -ceq $binding.Operation -and $receipt.PlanSHA256 -ceq $binding.OriginPlanSHA256) 'DEV_SETUP_EXACT_ORIGIN_REQUIRED'
 Need ($Run.Plan.Dev.Root -ceq $binding.DevRoot -and $Run.Plan.Dev.Data -ceq $binding.DevData -and $Run.Plan.Dev.Logs -ceq $binding.DevLogs -and $receipt.DevData -ceq $binding.DevData) 'DEV_SETUP_LAYOUT_BINDING'
 $m=@($Run.Plan.Artifacts|Where-Object Role -ceq 'mangosd.exe')
 Need ($m.Count -eq 1 -and $receipt.CandidateMangosdSHA256 -ceq $m[0].SHA256) 'DEV_SETUP_CANDIDATE_BINDING'
 return $receipt
}
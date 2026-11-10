function Get-RegistryPins([string]$root){
    $paths=@((Join-Path $root 'state.json'))
    foreach($d in @('manifests','proofs','approvals')){$paths+=@(Get-ChildItem -LiteralPath (Join-Path $root $d) -File|ForEach-Object FullName)}
    return ,@(foreach($p in @($paths|Sort-Object)){[WowReleaseV1.Secure]::Verify($p,$false,$false);$f=Get-Item -LiteralPath $p;[pscustomobject]@{Path=$p;Bytes=$f.Length;SHA256=Hash $p;SDDL=(Get-Acl -LiteralPath $p).Sddl}})
}
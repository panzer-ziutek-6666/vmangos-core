function New-RowSetComparisonSQL([string]$Actual,[string]$Expected,[string[]]$Columns,[string[]]$Keys){
 foreach($table in @($Actual,$Expected)){Need ($table -cmatch '^[a-z0-9_]+\.[a-z0-9_]+$') 'COMPARISON_TABLE_IDENTIFIER'}
 Need ($Keys.Count -gt 0 -and $Columns.Count -ge $Keys.Count) 'COMPARISON_KEYS_COLUMNS'
 foreach($column in $Columns+$Keys){Need ($column -cmatch '^[A-Za-z0-9_]+$') 'COMPARISON_COLUMN_IDENTIFIER'}
 foreach($key in $Keys){Need ($key -cin $Columns) 'KEY_NOT_IN_COLUMNS'}
 $using='USING('+($Keys -join ',')+')';$equal=(@($Columns|ForEach-Object {'a.`'+$_+'` <=> b.`'+$_+'`'}) -join ' AND ');$first=$Keys[0]
 return 'SELECT (SELECT COUNT(*) FROM '+$Expected+' b LEFT JOIN '+$Actual+' a '+$using+' WHERE a.`'+$first+'` IS NULL),(SELECT COUNT(*) FROM '+$Actual+' a LEFT JOIN '+$Expected+' b '+$using+' WHERE b.`'+$first+'` IS NULL),(SELECT COUNT(*) FROM '+$Actual+' a JOIN '+$Expected+' b '+$using+' WHERE NOT ('+$equal+'));'
}
function New-MaskCountSQL([string]$Actual,[string]$Before){
 foreach($table in @($Actual,$Before)){Need ($table -cmatch '^[a-z0-9_]+\.[a-z0-9_]+$') 'MASK_COUNT_TABLE'}
 return 'SELECT COUNT(*) FROM '+$Actual+' a JOIN '+$Before+' b USING(entry,patch) WHERE NOT(a.RequiredRaces <=> b.RequiredRaces);'
}
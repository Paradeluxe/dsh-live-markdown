param([string]$Path)
# Read comments out of a docx with Word COM (read-only, never saves).
# Output lines:
#   name=<file> compatMode=<n> count=<n>
#   #<i> author=<a> done=<True|False> ancestor=<index|none> start=<n> end=<n> len=<n> text=[<anchored text>]
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Path, $false, $true, $false)
  Write-Output ('name=' + $doc.Name + ' compatMode=' + $doc.CompatibilityMode + ' count=' + $doc.Comments.Count)
  for ($i = 1; $i -le $doc.Comments.Count; $i += 1) {
    $c = $doc.Comments.Item($i)
    $scope = $c.Scope
    $text = ($scope.Text -replace "`r", ' ' -replace "`a", '').Trim()
    if ($text.Length -gt 50) { $text = $text.Substring(0, 50) }
    $ancestor = 'none'
    try { if ($c.Ancestor -ne $null) { $ancestor = [string]$c.Ancestor.Index } } catch { $ancestor = 'err' }
    Write-Output ('  #' + $i + ' author=' + $c.Author + ' done=' + $c.Done + ' ancestor=' + $ancestor + ' start=' + $scope.Start + ' end=' + $scope.End + ' len=' + ($scope.End - $scope.Start) + ' text=[' + $text + ']')
  }
  $doc.Close(0)
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}

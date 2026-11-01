param(
  [Parameter(Mandatory=$true)][string]$BackupPath,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$PgRestorePath
)
$ErrorActionPreference='Stop'
try {
  $backupItem=Get-Item -LiteralPath $BackupPath -ErrorAction Stop
  if ($backupItem.PSIsContainer -or $backupItem.Length -le 0) { throw 'A nonempty exported archive file is required' }
  $archivePath=$backupItem.FullName
  $outputPath=[System.IO.Path]::GetFullPath($OutputDirectory)
  $workspacePath=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  if ($outputPath.StartsWith($workspacePath,[System.StringComparison]::OrdinalIgnoreCase) -or $outputPath -match '(?i)(^|[\\/])OneDrive([\\/]|$)') { throw 'Sensitive backup evidence must be stored outside this repository and OneDrive' }
  if ($PgRestorePath) {
    $restoreItem=Get-Item -LiteralPath $PgRestorePath -ErrorAction Stop
    if ($restoreItem.PSIsContainer -or $restoreItem.Extension -ne '.exe') { throw 'An operator-approved pg_restore executable is required' }
    $restoreExecutable=$restoreItem.FullName
  } else {
    $restoreExecutable=(Get-Command pg_restore -CommandType Application -ErrorAction Stop).Source
  }
  if (-not (Test-Path -LiteralPath $outputPath)) { New-Item -ItemType Directory -Path $outputPath -ErrorAction Stop | Out-Null }
  $tocPath=Join-Path $outputPath 'archive-toc.txt'
  $stderrPath=Join-Path $outputPath 'archive-list-diagnostics.txt'
  & $restoreExecutable --list --file $tocPath $archivePath 2> $stderrPath
  if ($LASTEXITCODE -ne 0) { throw "pg_restore archive listing failed with exit code $LASTEXITCODE; diagnostics were preserved privately" }
  $digest=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{sha256=$digest;bytes=$backupItem.Length;archive_listing_succeeded=$true;compression_restore_tested=$false;database_actions=0} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'archive-verification.json') -Encoding utf8
  Write-Output 'Archive hash and object listing were saved privately. No database restore was attempted; successful --list does not prove zstd decompression support.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}

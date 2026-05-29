# scripts/backup.ps1 — Windows equivalent of backup.sh
# Usage: .\scripts\backup.ps1
# Task Scheduler: daily at 02:00

param(
  [string]$DbSource = "data\db\listings.db",
  [string]$BackupRoot = "backups"
)

$Today = Get-Date -Format "yyyyMMdd"
$BackupDir = Join-Path $BackupRoot $Today
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$ts] Starting backup..."

# 1. Raw copy
Copy-Item $DbSource "$BackupDir\listings.db" -Force

# 2. Compressed copy (requires .NET GZipStream)
$srcBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $DbSource))
$gzPath   = "$BackupDir\listings.db.gz"
$gzStream = [System.IO.File]::Create($gzPath)
$gz = New-Object System.IO.Compression.GZipStream($gzStream, [System.IO.Compression.CompressionMode]::Compress)
$gz.Write($srcBytes, 0, $srcBytes.Length)
$gz.Close(); $gzStream.Close()

# 3. Verify (sqlite3.exe must be on PATH, or skip this step)
if (Get-Command sqlite3 -ErrorAction SilentlyContinue) {
  $count = sqlite3 "$BackupDir\listings.db" "SELECT COUNT(*) FROM listings;" 2>$null
  if ($count -match '^\d+$') {
    Write-Host "[$ts] Backup verified: $count listings in $BackupDir"
  } else {
    Write-Error "[$ts] Backup verification FAILED"
    exit 1
  }
} else {
  Write-Host "[$ts] sqlite3 not on PATH — skipping row-count verification"
}

# 4. Remove backups older than 30 days
$cutoff = (Get-Date).AddDays(-30)
Get-ChildItem $BackupRoot -Recurse -File | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$ts] Done. Backup saved to $BackupDir"

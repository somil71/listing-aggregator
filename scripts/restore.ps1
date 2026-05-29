# scripts/restore.ps1 — Windows equivalent of restore.sh
# Usage:
#   .\scripts\restore.ps1                          # restore latest backup
#   .\scripts\restore.ps1 -Date 20260523           # restore specific date
#   .\scripts\restore.ps1 -VerifyOnly              # verify backup without restoring

param(
  [string]$Date        = "",
  [string]$DbDest      = "data\db\listings.db",
  [string]$BackupRoot  = "backups",
  [switch]$VerifyOnly
)

function Log { param($Msg); Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] $Msg" }

# ── Find backup ──────────────────────────────────────────────────────────────
if ($Date -ne "") {
  $BackupDir = Join-Path $BackupRoot $Date
} else {
  $BackupDir = Get-ChildItem $BackupRoot -Directory |
               Where-Object { $_.Name -match '^\d{8}$' } |
               Sort-Object Name | Select-Object -Last 1 -ExpandProperty FullName
}

if (-not $BackupDir -or -not (Test-Path $BackupDir)) {
  Log "❌ No backup found in $BackupRoot"; exit 1
}

$BackupFile = Join-Path $BackupDir "listings.db"
$BackupGz   = Join-Path $BackupDir "listings.db.gz"

# Prefer plain copy; decompress gz if needed
if (Test-Path $BackupFile) {
  $Source = $BackupFile
} elseif (Test-Path $BackupGz) {
  Log "Decompressing $BackupGz..."
  $TmpFile = [System.IO.Path]::GetTempFileName()
  $gzStream = [System.IO.File]::OpenRead($BackupGz)
  $gz = New-Object System.IO.Compression.GZipStream($gzStream, [System.IO.Compression.CompressionMode]::Decompress)
  $outStream = [System.IO.File]::Create($TmpFile)
  $gz.CopyTo($outStream)
  $outStream.Close(); $gz.Close(); $gzStream.Close()
  $Source = $TmpFile
} else {
  Log "❌ No backup file found in $BackupDir"; exit 1
}

Log "Backup source : $Source"
Log "Restore target: $DbDest"

# ── Verify integrity ─────────────────────────────────────────────────────────
if (Get-Command sqlite3 -ErrorAction SilentlyContinue) {
  $integrity = sqlite3 $Source "PRAGMA integrity_check;" 2>$null
  if ($integrity -ne "ok") {
    Log "❌ Integrity check FAILED: $integrity"; exit 1
  }
  $count = sqlite3 $Source "SELECT COUNT(*) FROM listings;" 2>$null
  if ($count -match '^\d+$') {
    Log "✅ Source verified: $count listings, integrity ok"
  } else {
    Log "❌ Could not count listings"; exit 1
  }
} else {
  Log "⚠️  sqlite3 not on PATH — skipping integrity check"
}

if ($VerifyOnly) {
  Log "✅ Verify-only mode — no restore performed"; exit 0
}

# ── Stop PM2 if running ───────────────────────────────────────────────────────
$RestartPm2 = $false
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  $pm2List = pm2 list 2>$null
  if ($pm2List -match 'property-digest') {
    pm2 stop property-digest 2>$null
    $RestartPm2 = $true
    Log "Stopped PM2 process"
  }
}

# ── Backup current DB before overwriting ────────────────────────────────────
if (Test-Path $DbDest) {
  $ts = (Get-Date).ToString("yyyyMMddHHmmss")
  $PreRestore = "$DbDest.pre-restore.$ts"
  Copy-Item $DbDest $PreRestore
  Log "Current DB backed up to $PreRestore"
}

# ── Restore ──────────────────────────────────────────────────────────────────
$DestDir = Split-Path $DbDest
if (-not (Test-Path $DestDir)) { New-Item -ItemType Directory -Force $DestDir | Out-Null }
Copy-Item $Source $DbDest -Force
Log "✅ Restored to $DbDest"

# ── Post-restore check ────────────────────────────────────────────────────────
if (Get-Command sqlite3 -ErrorAction SilentlyContinue) {
  $postCount = sqlite3 $DbDest "SELECT COUNT(*) FROM listings;" 2>$null
  Log "Post-restore row count: $postCount"
}

# ── Restart PM2 if stopped ───────────────────────────────────────────────────
if ($RestartPm2) {
  pm2 start property-digest 2>$null
  Log "PM2 process restarted"
}

Log "✅ Restore complete from $BackupDir"

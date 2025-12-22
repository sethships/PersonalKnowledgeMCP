<#
.SYNOPSIS
    ChromaDB Volume Backup Script for Windows PowerShell

.DESCRIPTION
    Creates timestamped compressed backups of ChromaDB data volume with retention policy.
    Native PowerShell implementation for Windows environments.

.PARAMETER BackupDir
    Directory to store backups. Default: ./backups or BACKUP_DIR environment variable.

.PARAMETER RetentionDays
    Number of days to retain backups. Set to 0 to disable. Default: 30 or RETENTION_DAYS environment variable.

.PARAMETER VolumeName
    Override automatic volume detection. Default: auto-detect chromadb volume.

.PARAMETER Quiet
    Suppress informational output, only show errors and the backup path.

.EXAMPLE
    .\backup-chromadb.ps1
    Creates backup with default settings.

.EXAMPLE
    .\backup-chromadb.ps1 -BackupDir "D:\Backups" -RetentionDays 7
    Creates backup in D:\Backups, keeping only last 7 days of backups.

.EXAMPLE
    .\backup-chromadb.ps1 -Quiet
    Creates backup with minimal output.

.NOTES
    Exit Codes:
        0 - Success
        1 - General error
        2 - Docker not available
        3 - Volume not found
        4 - Backup failed
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BackupDir = $null,

    [Parameter(Mandatory = $false)]
    [int]$RetentionDays = -1,

    [Parameter(Mandatory = $false)]
    [string]$VolumeName = $null,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$Quiet
)

# =============================================================================
# Configuration
# =============================================================================

$ErrorActionPreference = "Stop"

$DEFAULT_BACKUP_DIR = "./backups"
$DEFAULT_RETENTION_DAYS = 30
$VOLUME_PATTERN = "chromadb.*data$"

# Apply defaults from environment or script defaults
if ([string]::IsNullOrEmpty($BackupDir)) {
    $BackupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { $DEFAULT_BACKUP_DIR }
}

if ($RetentionDays -eq -1) {
    $RetentionDays = if ($env:RETENTION_DAYS) { [int]$env:RETENTION_DAYS } else { $DEFAULT_RETENTION_DAYS }
}

if ([string]::IsNullOrEmpty($VolumeName)) {
    $VolumeName = $env:VOLUME_NAME
}

# =============================================================================
# Logging Functions
# =============================================================================

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    if ($Quiet -and $Level -eq "INFO") {
        return
    }

    $color = switch ($Level) {
        "INFO"    { "Cyan" }
        "SUCCESS" { "Green" }
        "WARN"    { "Yellow" }
        "ERROR"   { "Red" }
        default   { "White" }
    }

    $prefix = "[$Level]"
    Write-Host $prefix -ForegroundColor $color -NoNewline
    Write-Host " $Message"
}

function Write-Info    { param([string]$Message) Write-Log -Message $Message -Level "INFO" }
function Write-Success { param([string]$Message) Write-Log -Message $Message -Level "SUCCESS" }
function Write-Warn    { param([string]$Message) Write-Log -Message $Message -Level "WARN" }
function Write-Err     { param([string]$Message) Write-Log -Message $Message -Level "ERROR" }

# =============================================================================
# Helper Functions
# =============================================================================

function Test-DockerAvailable {
    try {
        $null = docker --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker command failed"
        }

        $null = docker info 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker daemon not running"
        }

        return $true
    }
    catch {
        return $false
    }
}

function Get-ChromaDBVolume {
    param([string]$Pattern)

    $volumes = docker volume ls --format '{{.Name}}' 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to list Docker volumes"
        exit 2
    }

    $matchingVolume = $volumes | Where-Object { $_ -match $Pattern } | Select-Object -First 1

    return $matchingVolume
}

function Test-VolumeExists {
    param([string]$Volume)

    $null = docker volume inspect $Volume 2>$null
    return $LASTEXITCODE -eq 0
}

function New-BackupDirectory {
    param([string]$Path)

    if (-not (Test-Path -Path $Path)) {
        Write-Info "Creating backup directory: $Path"
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }

    # Return absolute path
    return (Resolve-Path -Path $Path).Path
}

function New-BackupChecksum {
    param([string]$BackupPath)

    $checksumPath = "$BackupPath.sha256"
    Write-Info "Generating SHA256 checksum..."

    try {
        $hash = Get-FileHash -Path $BackupPath -Algorithm SHA256
        $hash.Hash.ToLower() | Out-File -FilePath $checksumPath -NoNewline -Encoding ASCII

        if (Test-Path -Path $checksumPath) {
            $checksum = Get-Content -Path $checksumPath
            Write-Info "Checksum: $($checksum.Substring(0, 16))... (saved to $(Split-Path -Path $checksumPath -Leaf))"
            return $true
        }
    }
    catch {
        Write-Warn "Failed to create checksum: $_"
    }

    return $false
}

function New-BackupMetadata {
    param(
        [string]$BackupPath,
        [string]$Volume,
        [int]$Retention
    )

    $metadataPath = $BackupPath -replace '\.tar\.gz$', '.metadata.json'
    Write-Info "Generating backup metadata..."

    try {
        $fileInfo = Get-Item -Path $BackupPath
        $checksum = ""
        $checksumPath = "$BackupPath.sha256"
        if (Test-Path -Path $checksumPath) {
            $checksum = Get-Content -Path $checksumPath
        }

        $metadata = @{
            backup_file    = $fileInfo.Name
            created_at     = (Get-Date -Format "o")
            volume_name    = $Volume
            size_bytes     = $fileInfo.Length
            size_human     = "{0:N2} MB" -f ($fileInfo.Length / 1MB)
            sha256         = $checksum
            hostname       = $env:COMPUTERNAME
            backup_dir     = Split-Path -Path $BackupPath -Parent
            retention_days = $Retention
            script_version = "1.1.0"
        }

        $metadata | ConvertTo-Json -Depth 2 | Out-File -FilePath $metadataPath -Encoding UTF8

        if (Test-Path -Path $metadataPath) {
            Write-Info "Metadata saved to $(Split-Path -Path $metadataPath -Leaf)"
            return $true
        }
    }
    catch {
        Write-Warn "Failed to create metadata: $_"
    }

    return $false
}

function New-Backup {
    param(
        [string]$Volume,
        [string]$BackupPath
    )

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = "chromadb-backup-$timestamp.tar.gz"
    $fullBackupPath = Join-Path -Path $BackupPath -ChildPath $backupFile

    Write-Info "Creating backup: $backupFile"
    Write-Info "Volume: $Volume"
    Write-Info "Destination: $BackupPath"

    # Dry-run mode - show what would happen
    if ($DryRun) {
        Write-Info "[DRY-RUN] Would create backup: $fullBackupPath"
        Write-Info "[DRY-RUN] Would generate checksum: $fullBackupPath.sha256"
        Write-Info "[DRY-RUN] Would generate metadata: $($fullBackupPath -replace '\.tar\.gz$', '.metadata.json')"
        return $fullBackupPath
    }

    # Convert Windows path to Docker-compatible path
    $dockerBackupPath = $BackupPath -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'

    # Run backup using Alpine container
    $output = docker run --rm `
        -v "${Volume}:/data:ro" `
        -v "${dockerBackupPath}:/backup" `
        alpine `
        tar czf "/backup/$backupFile" -C /data . 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Backup command failed: $output"
        exit 4
    }

    # Verify backup was created
    if (-not (Test-Path -Path $fullBackupPath)) {
        Write-Err "Backup file was not created"
        exit 4
    }

    $fileInfo = Get-Item -Path $fullBackupPath
    $sizeFormatted = "{0:N2} MB" -f ($fileInfo.Length / 1MB)

    Write-Success "Backup created: $fullBackupPath ($sizeFormatted)"

    # Generate checksum and metadata
    $null = New-BackupChecksum -BackupPath $fullBackupPath
    $null = New-BackupMetadata -BackupPath $fullBackupPath -Volume $Volume -Retention $RetentionDays

    return $fullBackupPath
}

function Remove-OldBackups {
    param(
        [string]$BackupPath,
        [int]$Days
    )

    if ($Days -le 0) {
        Write-Info "Retention policy disabled (RetentionDays=$Days)"
        return
    }

    Write-Info "Applying retention policy: keeping backups from last $Days days"

    $cutoffDate = (Get-Date).AddDays(-$Days)
    $oldBackups = Get-ChildItem -Path $BackupPath -Filter "chromadb-backup-*.tar.gz" -File |
        Where-Object { $_.LastWriteTime -lt $cutoffDate }

    $deletedCount = 0
    $totalFreed = 0

    foreach ($backup in $oldBackups) {
        $ageDays = [math]::Floor(((Get-Date) - $backup.LastWriteTime).TotalDays)
        $sizeFormatted = "{0:N2} MB" -f ($backup.Length / 1MB)

        if ($DryRun) {
            Write-Info "[DRY-RUN] Would remove: $($backup.Name) ($ageDays days old, $sizeFormatted)"
        }
        else {
            Write-Info "Removing: $($backup.Name) ($ageDays days old, $sizeFormatted)"
            Remove-Item -Path $backup.FullName -Force

            # Also remove associated checksum and metadata files
            $checksumPath = "$($backup.FullName).sha256"
            $metadataPath = $backup.FullName -replace '\.tar\.gz$', '.metadata.json'
            if (Test-Path -Path $checksumPath) { Remove-Item -Path $checksumPath -Force }
            if (Test-Path -Path $metadataPath) { Remove-Item -Path $metadataPath -Force }
        }

        $deletedCount++
        $totalFreed += $backup.Length
    }

    if ($deletedCount -gt 0) {
        $freedFormatted = if ($totalFreed -gt 1GB) {
            "{0:N2} GB" -f ($totalFreed / 1GB)
        }
        elseif ($totalFreed -gt 1MB) {
            "{0:N2} MB" -f ($totalFreed / 1MB)
        }
        else {
            "{0:N0} bytes" -f $totalFreed
        }

        if ($DryRun) {
            Write-Info "[DRY-RUN] Would remove $deletedCount old backup(s), freeing ~$freedFormatted"
        }
        else {
            Write-Info "Removed $deletedCount old backup(s), freed ~$freedFormatted"
        }
    }
    else {
        Write-Info "No old backups to remove"
    }
}

function Show-ExistingBackups {
    param([string]$BackupPath)

    $backups = Get-ChildItem -Path $BackupPath -Filter "chromadb-backup-*.tar.gz" -File -ErrorAction SilentlyContinue |
        Sort-Object -Property LastWriteTime -Descending |
        Select-Object -First 10

    if ($backups.Count -gt 0) {
        Write-Info "Existing backups in $BackupPath`:"
        foreach ($backup in $backups) {
            $sizeFormatted = "{0:N2} MB" -f ($backup.Length / 1MB)
            Write-Host "  $($backup.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))  $sizeFormatted  $($backup.Name)"
        }
    }
}

# =============================================================================
# Main Execution
# =============================================================================

function Main {
    Write-Info "ChromaDB Backup Script (PowerShell)"
    Write-Info "===================================="

    if ($DryRun) {
        Write-Info "[DRY-RUN MODE] No changes will be made"
    }

    # Pre-flight checks
    if (-not (Test-DockerAvailable)) {
        Write-Err "Docker is not installed, not in PATH, or daemon is not running"
        exit 2
    }

    # Detect or validate volume
    if ([string]::IsNullOrEmpty($VolumeName)) {
        $VolumeName = Get-ChromaDBVolume -Pattern $VOLUME_PATTERN

        if ([string]::IsNullOrEmpty($VolumeName)) {
            Write-Err "Could not find ChromaDB volume matching pattern: $VOLUME_PATTERN"
            Write-Err "Available volumes:"
            docker volume ls --format '  {{.Name}}'
            exit 3
        }

        Write-Info "Detected volume: $VolumeName"
    }
    else {
        Write-Info "Using specified volume: $VolumeName"
    }

    if (-not (Test-VolumeExists -Volume $VolumeName)) {
        Write-Err "Volume '$VolumeName' does not exist"
        exit 3
    }

    # Ensure backup directory exists
    $BackupDir = New-BackupDirectory -Path $BackupDir

    # Create backup
    $backupPath = New-Backup -Volume $VolumeName -BackupPath $BackupDir

    # Apply retention policy
    Remove-OldBackups -BackupPath $BackupDir -Days $RetentionDays

    # Show summary
    Show-ExistingBackups -BackupPath $BackupDir

    if ($DryRun) {
        Write-Success "Dry-run completed - no changes were made"
    }
    else {
        Write-Success "Backup completed successfully"
    }

    # Return the backup path for scripting
    return $backupPath
}

# Run main function
try {
    $result = Main
    exit 0
}
catch {
    Write-Err "Unexpected error: $_"
    exit 1
}

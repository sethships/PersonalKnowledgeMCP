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
    foreach ($backup in $oldBackups) {
        Write-Info "Removing old backup: $($backup.Name)"
        Remove-Item -Path $backup.FullName -Force
        $deletedCount++
    }

    if ($deletedCount -gt 0) {
        Write-Info "Removed $deletedCount old backup(s)"
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

    Write-Success "Backup completed successfully"

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

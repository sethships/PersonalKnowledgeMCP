<#
.SYNOPSIS
    ChromaDB Volume Restore Script for Windows PowerShell

.DESCRIPTION
    Restores ChromaDB data from a backup archive.
    Native PowerShell implementation for Windows environments.

.PARAMETER BackupFile
    Path to the backup archive (chromadb-backup-*.tar.gz). Required.

.PARAMETER VolumeName
    Override automatic volume detection. Default: auto-detect chromadb volume.

.PARAMETER Force
    Skip confirmation prompt.

.PARAMETER Quiet
    Suppress informational output, only show errors.

.EXAMPLE
    .\restore-chromadb.ps1 -BackupFile ".\backups\chromadb-backup-20241210-183000.tar.gz"
    Restores from the specified backup file with confirmation.

.EXAMPLE
    .\restore-chromadb.ps1 -BackupFile "backup.tar.gz" -Force
    Restores from backup without confirmation prompt.

.EXAMPLE
    .\restore-chromadb.ps1 -BackupFile "backup.tar.gz" -VolumeName "myproject_chromadb-data"
    Restores to a specific volume.

.NOTES
    Exit Codes:
        0 - Success
        1 - General error
        2 - Docker not available
        3 - Volume not found
        4 - Backup file not found or invalid
        5 - Restore failed
        6 - User cancelled
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BackupFile,

    [Parameter(Mandatory = $false)]
    [string]$VolumeName = $null,

    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [switch]$Quiet
)

# =============================================================================
# Configuration
# =============================================================================

$ErrorActionPreference = "Stop"

$VOLUME_PATTERN = "chromadb.*data$"
$CONTAINER_PATTERN = "chromadb"

# Apply environment variable if volume not specified
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

function Test-BackupFile {
    param([string]$Path)

    if (-not (Test-Path -Path $Path -PathType Leaf)) {
        Write-Err "Backup file not found: $Path"
        exit 4
    }

    # Return absolute path
    return (Resolve-Path -Path $Path).Path
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

function Get-ChromaDBContainers {
    $containers = docker ps --format '{{.Names}}' 2>$null
    return $containers | Where-Object { $_ -match $CONTAINER_PATTERN }
}

function Stop-ChromaDBContainer {
    $containers = Get-ChromaDBContainers

    if (-not $containers) {
        Write-Info "No running ChromaDB container found"
        return
    }

    Write-Info "Stopping ChromaDB container(s): $($containers -join ', ')"

    # Try docker compose first
    $composeResult = docker compose stop chromadb 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Container stopped via docker compose"
        return
    }

    # Fall back to docker stop
    foreach ($container in $containers) {
        Write-Info "Stopping container: $container"
        docker stop $container 2>$null | Out-Null
    }
}

function Start-ChromaDBContainer {
    Write-Info "Starting ChromaDB container..."

    $result = docker compose up -d chromadb 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Container started via docker compose"
        return $true
    }

    Write-Warn "Could not start container automatically"
    Write-Warn "Please start the container manually: docker compose up -d chromadb"
    return $false
}

function Wait-ForHealthy {
    param([int]$MaxAttempts = 30)

    Write-Info "Waiting for ChromaDB to be healthy..."

    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/api/v2/heartbeat" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Success "ChromaDB is healthy"
                return $true
            }
        }
        catch {
            # Ignore errors, keep trying
        }
        Start-Sleep -Seconds 2
    }

    Write-Warn "ChromaDB health check timed out after $($MaxAttempts * 2) seconds"
    Write-Warn "The container may still be starting up"
    return $false
}

function Confirm-Restore {
    param(
        [string]$BackupPath,
        [string]$Volume
    )

    if ($Force) {
        return $true
    }

    $fileInfo = Get-Item -Path $BackupPath
    $sizeFormatted = "{0:N2} MB" -f ($fileInfo.Length / 1MB)

    Write-Host ""
    Write-Host "WARNING: This operation will REPLACE all existing ChromaDB data." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Backup file:   $($fileInfo.Name)"
    Write-Host "  File size:     $sizeFormatted"
    Write-Host "  Target volume: $Volume"
    Write-Host ""
    Write-Host "This action is DESTRUCTIVE and cannot be undone." -ForegroundColor Red
    Write-Host ""

    $confirm = Read-Host "Are you sure you want to proceed? (y/N)"
    if ($confirm -match "^[Yy]") {
        return $true
    }

    Write-Info "Restore cancelled by user"
    exit 6
}

function Clear-VolumeData {
    param([string]$Volume)

    Write-Info "Clearing existing data in volume..."

    docker run --rm `
        -v "${Volume}:/data" `
        alpine `
        sh -c "rm -rf /data/*" 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to clear volume data"
        exit 5
    }

    Write-Info "Volume cleared"
}

function Restore-BackupData {
    param(
        [string]$BackupPath,
        [string]$Volume
    )

    $backupDir = Split-Path -Path $BackupPath -Parent
    $backupName = Split-Path -Path $BackupPath -Leaf

    Write-Info "Restoring data from backup..."

    # Convert Windows path to Docker-compatible path
    $dockerBackupDir = $backupDir -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'

    docker run --rm `
        -v "${Volume}:/data" `
        -v "${dockerBackupDir}:/backup:ro" `
        alpine `
        tar xzf "/backup/$backupName" -C /data 2>$null

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to restore data from backup"
        exit 5
    }

    Write-Success "Data restored from backup"
}

function Show-Verification {
    Write-Host ""
    Write-Info "Verification:"
    Write-Host "  curl http://localhost:8000/api/v2/heartbeat"
    Write-Host "  curl http://localhost:8000/api/v2/collections"
    Write-Host ""
    Write-Host "Or in PowerShell:"
    Write-Host "  Invoke-WebRequest -Uri 'http://localhost:8000/api/v2/heartbeat'"
    Write-Host "  Invoke-WebRequest -Uri 'http://localhost:8000/api/v2/collections'"
    Write-Host ""
}

# =============================================================================
# Main Execution
# =============================================================================

function Main {
    Write-Info "ChromaDB Restore Script (PowerShell)"
    Write-Info "====================================="

    # Pre-flight checks
    if (-not (Test-DockerAvailable)) {
        Write-Err "Docker is not installed, not in PATH, or daemon is not running"
        exit 2
    }

    # Validate backup file
    $BackupFile = Test-BackupFile -Path $BackupFile
    Write-Info "Backup file validated: $BackupFile"

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

    # Confirm with user
    Confirm-Restore -BackupPath $BackupFile -Volume $VolumeName

    # Perform restore
    Stop-ChromaDBContainer
    Clear-VolumeData -Volume $VolumeName
    Restore-BackupData -BackupPath $BackupFile -Volume $VolumeName

    $null = Start-ChromaDBContainer
    $null = Wait-ForHealthy

    # Show verification commands
    Show-Verification

    Write-Success "Restore completed successfully"
}

# Run main function
try {
    Main
    exit 0
}
catch {
    Write-Err "Unexpected error: $_"
    exit 1
}

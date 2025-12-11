# PowerShell script to create GitHub issues for Phase 1
# Run from repository root: .\pm\scripts\create-github-issues.ps1

# Ensure gh CLI is authenticated
$null = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: GitHub CLI not authenticated. Run 'gh auth login' first." -ForegroundColor Red
    exit 1
}

$repo = "sethb75/PersonalKnowledgeMCP"
$issuesDir = "$PSScriptRoot\..\issues"

# Create labels first
Write-Host "Creating labels..." -ForegroundColor Cyan

$labels = @(
    @{name="phase-1"; color="0e8a16"; description="Phase 1: Core MCP + Vector Search"},
    @{name="P0"; color="b60205"; description="Must have - Critical priority"},
    @{name="P1"; color="e99695"; description="Should have - High priority"},
    @{name="feature"; color="a2eeef"; description="New feature or enhancement"},
    @{name="infrastructure"; color="d4c5f9"; description="Infrastructure and tooling"},
    @{name="testing"; color="fef2c0"; description="Testing related"},
    @{name="documentation"; color="c5def5"; description="Documentation improvements"},
    @{name="epic"; color="3E4B9E"; description="Epic tracking issue"}
)

foreach ($label in $labels) {
    $existing = gh label list --repo $repo --json name 2>&1 | ConvertFrom-Json | Where-Object { $_.name -eq $label.name }
    if (-not $existing) {
        try {
            # Try gh label create first
            $result = gh label create $label.name --repo $repo --color $label.color --description $label.description 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  Created label: $($label.name)" -ForegroundColor Green
            } else {
                # Fallback to API
                Write-Host "  Trying API method for $($label.name)..." -ForegroundColor Yellow
                $apiResult = gh api repos/$repo/labels -f name=$label.name -f color=$label.color -f description=$label.description 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  Created label (API): $($label.name)" -ForegroundColor Green
                } else {
                    Write-Host "  Warning: Failed to create label $($label.name): $apiResult" -ForegroundColor Yellow
                }
            }
        } catch {
            Write-Host "  Warning: Failed to create label $($label.name): $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Label exists: $($label.name)" -ForegroundColor Yellow
    }
}

# Wait a moment for labels to propagate
Write-Host "Waiting for labels to propagate..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Verify all labels exist
Write-Host "`nVerifying labels..." -ForegroundColor Cyan
$allLabels = gh label list --repo $repo --json name 2>&1 | ConvertFrom-Json
$missingLabels = @()

foreach ($label in $labels) {
    $exists = $allLabels | Where-Object { $_.name -eq $label.name }
    if (-not $exists) {
        $missingLabels += $label.name
        Write-Host "  Missing: $($label.name)" -ForegroundColor Red
    } else {
        Write-Host "  Verified: $($label.name)" -ForegroundColor Green
    }
}

if ($missingLabels.Count -gt 0) {
    Write-Host "`nError: Some labels could not be created. Please create them manually:" -ForegroundColor Red
    foreach ($labelName in $missingLabels) {
        Write-Host "  - $labelName" -ForegroundColor Red
    }
    Write-Host "`nYou can create labels at: https://github.com/$repo/labels" -ForegroundColor Yellow
    $continue = Read-Host "`nContinue anyway? (y/N)"
    if ($continue -ne 'y' -and $continue -ne 'Y') {
        exit 1
    }
}

# Create milestone
Write-Host "`nCreating milestone..." -ForegroundColor Cyan
$milestones = gh api repos/$repo/milestones --jq '.[].title' 2>&1
if ($milestones -notcontains "Phase 1: Core MCP + Vector Search") {
    gh api repos/$repo/milestones -f title="Phase 1: Core MCP + Vector Search" -f description="Core MCP service with semantic search capability" -f due_on="2025-01-15T00:00:00Z"
    Write-Host "  Created milestone" -ForegroundColor Green
} else {
    Write-Host "  Milestone exists" -ForegroundColor Yellow
}

# Issue definitions (order matters for dependencies)
$issues = @(
    @{
        file = "00-phase1-epic.md"
        title = "[EPIC] Phase 1: Core MCP + Vector Search"
        labels = "phase-1,P0,epic"
    },
    @{
        file = "01-project-setup.md"
        title = "[Infrastructure] Project Setup and Tooling Configuration"
        labels = "phase-1,P0,infrastructure"
    },
    @{
        file = "02-docker-compose.md"
        title = "[Infrastructure] Docker Compose Configuration for ChromaDB"
        labels = "phase-1,P0,infrastructure"
    },
    @{
        file = "03-chroma-storage-client.md"
        title = "[Feature] ChromaDB Storage Client Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "04-embedding-provider.md"
        title = "[Feature] Embedding Provider Interface and OpenAI Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "05-repository-metadata-store.md"
        title = "[Feature] Repository Metadata Store"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "06-repository-cloner.md"
        title = "[Feature] Repository Cloner Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "07-file-scanner.md"
        title = "[Feature] File Scanner Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "08-file-chunker.md"
        title = "[Feature] File Chunker Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "09-ingestion-service.md"
        title = "[Feature] Ingestion Service Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "10-search-service.md"
        title = "[Feature] Search Service Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "11-mcp-server-semantic-search.md"
        title = "[Feature] MCP Server and semantic_search Tool Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "12-mcp-list-repositories.md"
        title = "[Feature] MCP list_indexed_repositories Tool Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "13-cli-commands.md"
        title = "[Feature] CLI Commands Implementation"
        labels = "phase-1,P0,feature"
    },
    @{
        file = "14-claude-code-integration.md"
        title = "[Feature] Claude Code Integration and Testing"
        labels = "phase-1,P0,feature,testing"
    },
    @{
        file = "15-logging-infrastructure.md"
        title = "[Infrastructure] Logging Infrastructure Setup"
        labels = "phase-1,P1,infrastructure"
    },
    @{
        file = "16-testing-quality.md"
        title = "[Testing] Test Coverage and Quality Validation"
        labels = "phase-1,P0,testing"
    },
    @{
        file = "17-documentation.md"
        title = "[Documentation] Phase 1 Documentation and README"
        labels = "phase-1,P1,documentation"
    }
)

# Track created issue numbers
$createdIssues = @{}

Write-Host "`nCreating issues..." -ForegroundColor Cyan

foreach ($issue in $issues) {
    $filePath = Join-Path $issuesDir $issue.file

    if (-not (Test-Path $filePath)) {
        Write-Host "  Warning: File not found: $filePath" -ForegroundColor Yellow
        continue
    }

    # Read issue body and remove the first line (markdown title) if it exists
    $content = Get-Content $filePath -Raw
    $lines = $content -split "`r?`n"

    # Skip first line if it's a markdown header
    if ($lines[0] -match '^#\s+') {
        $body = ($lines[1..($lines.Length-1)] -join "`n").Trim()
    } else {
        $body = $content.Trim()
    }

    # Create the issue
    Write-Host "  Creating: $($issue.title)" -ForegroundColor White
    Write-Host "    Labels: $($issue.labels)" -ForegroundColor Gray

    try {
        $result = gh issue create `
            --repo $repo `
            --title $issue.title `
            --body $body `
            --label $issue.labels `
            --milestone "Phase 1: Core MCP + Vector Search" 2>&1

        if ($LASTEXITCODE -eq 0) {
            # Extract issue number from URL
            $issueNumber = ($result -split '/')[-1]
            $createdIssues[$issue.file] = $issueNumber
            Write-Host "    Created: #$issueNumber" -ForegroundColor Green
        } else {
            Write-Host "    Failed: $result" -ForegroundColor Red
        }
    } catch {
        Write-Host "    Error: $_" -ForegroundColor Red
    }

    # Small delay to avoid rate limiting
    Start-Sleep -Milliseconds 500
}

Write-Host "`nIssue creation complete!" -ForegroundColor Cyan
Write-Host "Created $($createdIssues.Count) issues" -ForegroundColor Green

# Output issue numbers for reference
Write-Host "`nIssue Numbers:" -ForegroundColor Cyan
foreach ($key in $createdIssues.Keys | Sort-Object) {
    Write-Host "  $key -> #$($createdIssues[$key])"
}

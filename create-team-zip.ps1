# PowerShell script to create a ZIP file for sharing CodeCollab project
# This script will create a clean ZIP file ready for team distribution

$projectName = "CodeCollab"
$version = "v1.0"
$date = Get-Date -Format "yyyy-MM-dd"
$zipName = "$projectName-$version-TeamSetup-$date.zip"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Creating ZIP file for team sharing" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Get current directory
$sourceDir = Get-Location
Write-Host "Source directory: $sourceDir" -ForegroundColor Yellow

# Define output path (one level up from project)
$outputPath = Join-Path (Split-Path $sourceDir -Parent) $zipName
Write-Host "Output ZIP file: $outputPath" -ForegroundColor Yellow
Write-Host ""

# Files and folders to include
$includeItems = @(
    "*.md",           # All markdown files (README, guides, etc.)
    "*.bat",          # Setup scripts
    "*.ps1",          # PowerShell scripts
    "package.json",   # Root package.json
    "LICENSE",        # License file
    "client",         # Client folder
    "server",         # Server folder
    "database"        # Database folder
)

# Files and folders to exclude (case-insensitive)
$excludePatterns = @(
    "node_modules",
    "build",
    "dist",
    ".git",
    "*.log",
    "*.zip"           # Don't include other zip files
)

# Specific files to exclude (but allow .env.example)
$excludeFiles = @(
    ".env"            # Exclude .env but keep .env.example
)

Write-Host "Creating temporary staging directory..." -ForegroundColor Yellow
$tempDir = Join-Path $env:TEMP "CodeCollab-Staging"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Copying files to staging directory..." -ForegroundColor Yellow

# Function to check if path should be excluded
function Should-Exclude {
    param($path, $fileName)
    
    # Check exclude patterns
    foreach ($pattern in $excludePatterns) {
        if ($path -like "*$pattern*") {
            return $true
        }
    }
    
    # Check specific files to exclude (but allow .env.example)
    foreach ($file in $excludeFiles) {
        if ($fileName -eq $file) {
            return $true
        }
    }
    
    return $false
}

# Copy files and folders
foreach ($item in $includeItems) {
    $items = Get-ChildItem -Path $item -ErrorAction SilentlyContinue
    foreach ($file in $items) {
        if (-not (Should-Exclude $file.FullName $file.Name)) {
            $destPath = Join-Path $tempDir $file.Name
            if ($file.PSIsContainer) {
                # It's a directory - copy recursively but exclude unwanted items
                Write-Host "  Copying folder: $($file.Name)" -ForegroundColor Green
                robocopy $file.FullName $destPath /E /XD node_modules build dist .git /XF *.log .env *.zip /NFL /NDL /NJH /NJS | Out-Null
                
                # Manually copy .env.example files since robocopy excludes .env
                $envExamples = Get-ChildItem -Path $file.FullName -Recurse -Filter ".env.example" -ErrorAction SilentlyContinue
                foreach ($envExample in $envExamples) {
                    $relativePath = $envExample.FullName.Substring($file.FullName.Length + 1)
                    $envDestPath = Join-Path $destPath $relativePath
                    $envDestDir = Split-Path $envDestPath -Parent
                    if (-not (Test-Path $envDestDir)) {
                        New-Item -ItemType Directory -Path $envDestDir -Force | Out-Null
                    }
                    Copy-Item $envExample.FullName $envDestPath -Force
                    Write-Host "    Added: $relativePath" -ForegroundColor Cyan
                }
            } else {
                # It's a file
                Write-Host "  Copying file: $($file.Name)" -ForegroundColor Green
                Copy-Item $file.FullName $destPath
            }
        }
    }
}

Write-Host ""
Write-Host "Creating ZIP archive..." -ForegroundColor Yellow

# Create the ZIP file
try {
    Compress-Archive -Path "$tempDir\*" -DestinationPath $outputPath -CompressionLevel Optimal -Force
    Write-Host "ZIP file created successfully!" -ForegroundColor Green
} catch {
    Write-Host "Error creating ZIP file: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Clean up temporary directory
Remove-Item $tempDir -Recurse -Force

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "ZIP Creation Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "ZIP file location: $outputPath" -ForegroundColor Cyan
Write-Host "File size: $([math]::Round((Get-Item $outputPath).Length / 1MB, 2)) MB" -ForegroundColor Cyan
Write-Host ""

# Show contents
Write-Host "ZIP file contents:" -ForegroundColor Yellow
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($outputPath)
$zip.Entries | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor White }
$zip.Dispose()

Write-Host ""
Write-Host "🎉 Your CodeCollab project is ready for sharing!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Share the ZIP file with your teammates" -ForegroundColor White
Write-Host "2. Tell them to extract it and run setup.bat" -ForegroundColor White
Write-Host "3. Or point them to QUICK_START.md for instructions" -ForegroundColor White
Write-Host ""

# Ask if user wants to open the folder
$choice = Read-Host "Would you like to open the folder containing the ZIP file? (y/n)"
if ($choice -eq "y" -or $choice -eq "Y") {
    Start-Process explorer.exe -ArgumentList "/select,`"$outputPath`""
}

Write-Host ""
Read-Host "Press Enter to exit"

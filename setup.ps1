# CodeCollab Setup Script for Windows PowerShell
# Run this script in PowerShell to automatically set up the project

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "CodeCollab Setup Script for Windows" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-CommandExists {
    param($command)
    try {
        Get-Command $command -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# Check if Node.js is installed
Write-Host "Checking for Node.js..." -ForegroundColor Yellow
if (Test-CommandExists "node") {
    $nodeVersion = node --version
    Write-Host "Node.js found: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "ERROR: Node.js is not installed!" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    Write-Host "Download the LTS version and run the installer." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if npm is available
Write-Host "Checking for npm..." -ForegroundColor Yellow
if (Test-CommandExists "npm") {
    $npmVersion = npm --version
    Write-Host "npm found: $npmVersion" -ForegroundColor Green
} else {
    Write-Host "ERROR: npm is not available!" -ForegroundColor Red
    Write-Host "Please reinstall Node.js from https://nodejs.org/" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Installing project dependencies..." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Install root dependencies
Write-Host "Installing root dependencies..." -ForegroundColor Yellow
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host "Root dependencies installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to install root dependencies!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install client dependencies
Write-Host ""
Write-Host "Installing client dependencies..." -ForegroundColor Yellow
try {
    Set-Location "client"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host "Client dependencies installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to install client dependencies!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Install server dependencies
Write-Host ""
Write-Host "Installing server dependencies..." -ForegroundColor Yellow
try {
    Set-Location "..\server"
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Host "Server dependencies installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to install server dependencies!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Go back to root
Set-Location ".."

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Setting up environment configuration..." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Check if .env.example exists
if (-not (Test-Path "server\.env.example")) {
    Write-Host "ERROR: Environment template file server\.env.example not found!" -ForegroundColor Red
    Write-Host "This file is required for setup. Please check your project files." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if .env already exists
if (Test-Path "server\.env") {
    Write-Host "Environment file already exists. Skipping creation." -ForegroundColor Yellow
} else {
    Write-Host "Creating environment file..." -ForegroundColor Yellow
    try {
        Copy-Item "server\.env.example" "server\.env"
        Write-Host "Created server\.env from template" -ForegroundColor Green
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Magenta
        Write-Host "IMPORTANT: Environment Configuration" -ForegroundColor Magenta
        Write-Host "============================================" -ForegroundColor Magenta
        Write-Host "The environment file has been created with default values." -ForegroundColor White
        Write-Host "For security, you should update the JWT_SECRET with a random string." -ForegroundColor White
        Write-Host ""
        Write-Host "You can edit server\.env in any text editor like Notepad." -ForegroundColor White
        Write-Host "Example: JWT_SECRET=my-super-secret-random-key-12345" -ForegroundColor Cyan
        Write-Host ""
    } catch {
        Write-Host "ERROR: Failed to create environment file!" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your CodeCollab project is ready to run!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application:" -ForegroundColor White
Write-Host "  1. Open a command prompt or PowerShell" -ForegroundColor White
Write-Host "  2. Navigate to this folder" -ForegroundColor White
Write-Host "  3. Run: npm run dev" -ForegroundColor Cyan
Write-Host "  4. Open your browser to http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANT NOTES:" -ForegroundColor Magenta
Write-Host "- Environment file created: server\.env" -ForegroundColor White
Write-Host "- Default JWT_SECRET is set (recommended to change for production)" -ForegroundColor White
Write-Host "- Firebase configuration is optional (for Google auth)" -ForegroundColor White
Write-Host "- If you encounter port conflicts, close other development servers" -ForegroundColor White
Write-Host "- The first startup might take a moment to compile everything" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Would you like to start the application now? (y/n)"
if ($choice -eq "y" -or $choice -eq "Y") {
    Write-Host ""
    Write-Host "Starting CodeCollab..." -ForegroundColor Green
    npm run dev
} else {
    Write-Host ""
    Write-Host "You can start the application later by running: npm run dev" -ForegroundColor Cyan
}

Write-Host ""
Read-Host "Press Enter to exit"

@echo off
echo ============================================
echo CodeCollab Setup Script for Windows
echo ============================================
echo.

REM Check if Node.js is installed
echo Checking for Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo Download the LTS version and run the installer.
    pause
    exit /b 1
)

echo Node.js found: 
node --version

REM Check if npm is available
echo Checking for npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not available!
    echo Please reinstall Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo npm found: 
npm --version
echo.

echo ============================================
echo Installing project dependencies...
echo ============================================
echo.

echo Installing root dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install root dependencies!
    pause
    exit /b 1
)

echo.
echo Installing client dependencies...
cd client
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install client dependencies!
    pause
    exit /b 1
)

echo.
echo Installing server dependencies...
cd ..\server
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install server dependencies!
    pause
    exit /b 1
)

cd ..

echo.
echo ============================================
echo Setting up environment configuration...
echo ============================================

REM Check if .env.example exists
if not exist "server\.env.example" (
    echo ERROR: Environment template file server\.env.example not found!
    echo This file is required for setup. Please check your project files.
    pause
    exit /b 1
)

REM Check if .env already exists
if exist "server\.env" (
    echo Environment file already exists. Skipping creation.
) else (
    echo Creating environment file...
    copy "server\.env.example" "server\.env" >nul
    if %errorlevel% neq 0 (
        echo ERROR: Failed to create environment file!
        pause
        exit /b 1
    )
    echo Created server\.env from template
    echo.
    echo ============================================
    echo IMPORTANT: Environment Configuration
    echo ============================================
    echo The environment file has been created with default values.
    echo For security, you should update the JWT_SECRET with a random string.
    echo.
    echo You can edit server\.env in any text editor like Notepad.
    echo Example: JWT_SECRET=my-super-secret-random-key-12345
    echo.
)

echo.
echo ============================================
echo Setup Complete!
echo ============================================
echo.
echo Your CodeCollab project is ready to run!
echo.
echo To start the application:
echo   1. Open a command prompt or PowerShell
echo   2. Navigate to this folder
echo   3. Run: npm run dev
echo   4. Open your browser to http://localhost:3000
echo.
echo IMPORTANT NOTES:
echo - Environment file created: server\.env
echo - Default JWT_SECRET is set (recommended to change for production)
echo - Firebase configuration is optional (for Google auth)
echo - If you encounter port conflicts, close other development servers
echo - The first startup might take a moment to compile everything
echo.
echo Would you like to start the application now? (y/n)
set /p choice=
if /i "%choice%"=="y" (
    echo Starting CodeCollab...
    npm run dev
) else (
    echo.
    echo You can start the application later by running: npm run dev
)

echo.
pause

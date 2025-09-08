@echo off
echo ============================================
echo CodeCollab Project Cleanup for Sharing
echo ============================================
echo.
echo This script will clean up development files to prepare for sharing.
echo.

set /p confirm="Are you sure you want to clean the project for sharing? (y/n): "
if /i not "%confirm%"=="y" (
    echo Operation cancelled.
    pause
    exit /b 0
)

echo.
echo Cleaning up development files...

REM Remove node_modules directories
if exist "node_modules" (
    echo Removing root node_modules...
    rmdir /s /q "node_modules"
)

if exist "client\node_modules" (
    echo Removing client node_modules...
    rmdir /s /q "client\node_modules"
)

if exist "server\node_modules" (
    echo Removing server node_modules...
    rmdir /s /q "server\node_modules"
)

REM Remove build directories
if exist "client\build" (
    echo Removing client build directory...
    rmdir /s /q "client\build"
)

REM Remove environment files (keep .env.example)
if exist "server\.env" (
    echo Removing server .env file...
    del "server\.env"
)

REM Remove log files
if exist "*.log" (
    echo Removing log files...
    del "*.log"
)

if exist "server\*.log" (
    echo Removing server log files...
    del "server\*.log"
)

if exist "client\*.log" (
    echo Removing client log files...
    del "client\*.log"
)

REM Remove package-lock files (optional - they'll be regenerated)
echo.
set /p cleanLocks="Remove package-lock.json files? They'll be regenerated. (y/n): "
if /i "%cleanLocks%"=="y" (
    if exist "package-lock.json" (
        echo Removing root package-lock.json...
        del "package-lock.json"
    )
    if exist "client\package-lock.json" (
        echo Removing client package-lock.json...
        del "client\package-lock.json"
    )
    if exist "server\package-lock.json" (
        echo Removing server package-lock.json...
        del "server\package-lock.json"
    )
)

echo.
echo ============================================
echo Cleanup Complete!
echo ============================================
echo.
echo Your project is now ready for sharing!
echo.
echo Files removed:
echo - node_modules directories
echo - build/dist directories  
echo - .env files (keeping .env.example)
echo - log files
if /i "%cleanLocks%"=="y" echo - package-lock.json files
echo.
echo Files preserved:
echo - Source code
echo - Configuration files
echo - Setup scripts
echo - Documentation
echo.
echo You can now safely share this project folder with your team.
echo.
pause

@echo off
echo ============================================
echo Environment Configuration Helper
echo ============================================
echo.
echo This script will help you configure environment variables
echo for the CodeCollab project.
echo.

REM Check if .env.example exists
if not exist "server\.env.example" (
    echo ERROR: Environment template file server\.env.example not found!
    echo Please run this from the project root directory.
    pause
    exit /b 1
)

REM Check if .env already exists
if exist "server\.env" (
    echo Environment file already exists: server\.env
    echo.
    set /p overwrite="Do you want to recreate it? (y/n): "
    if /i not "%overwrite%"=="y" (
        echo Operation cancelled.
        pause
        exit /b 0
    )
)

echo Creating environment file...
copy "server\.env.example" "server\.env" >nul

REM Generate a random JWT secret
echo Generating secure JWT secret...
powershell -Command "$chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?'; $secret=''; for($i=0; $i -lt 64; $i++){$secret += $chars[(Get-Random -Maximum $chars.Length)]}; (Get-Content 'server\.env') -replace 'JWT_SECRET=your-super-secret-jwt-key-here', \"JWT_SECRET=$secret\" | Set-Content 'server\.env'"

echo.
echo ============================================
echo Environment Configuration Complete!
echo ============================================
echo.
echo ✓ Created server\.env from template
echo ✓ Generated secure JWT secret (64 characters)
echo ✓ Default port: 3001
echo ✓ Development mode enabled
echo.
echo Optional configurations:
echo - Firebase authentication (for Google login)
echo - Database settings (for future database integration)
echo - Email settings (for notifications)
echo.
echo You can edit server\.env manually if you need to customize these settings.
echo.
pause

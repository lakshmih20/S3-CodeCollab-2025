# CodeCollab Team Setup Guide for Windows

This guide will help your teammates set up the CodeCollab project from scratch on their Windows laptops, regardless of their current development environment.

## 📋 Prerequisites Check

Before starting, check if you have these installed by opening PowerShell and running these commands:

```powershell
node --version
npm --version
git --version
```

If any of these commands fail, follow the installation steps below.

## 🛠️ Step 1: Install Required Software

### 1.1 Install Node.js and npm
1. Go to [nodejs.org](https://nodejs.org/)
2. Download the **LTS version** (recommended for most users)
3. Run the installer with default settings
4. Restart your computer after installation
5. Verify installation by opening PowerShell and running:
   ```powershell
   node --version
   npm --version
   ```

### 1.2 Install Git (if not already installed)
1. Go to [git-scm.com](https://git-scm.com/download/win)
2. Download Git for Windows
3. Run the installer with default settings
4. Verify installation:
   ```powershell
   git --version
   ```

### 1.3 Install a Code Editor (Recommended)
- **VS Code**: Download from [code.visualstudio.com](https://code.visualstudio.com/)
- **Alternative**: Any text editor you prefer

## 📁 Step 2: Get the Project

### Option A: If you have access to the Git repository
```powershell
git clone [REPOSITORY_URL]
cd CodeCollab
```

### Option B: If you received a ZIP file
1. Extract the ZIP file to a folder (e.g., `C:\Projects\CodeCollab`)
2. Open PowerShell and navigate to the folder:
   ```powershell
   cd "C:\Projects\CodeCollab"
   ```

## ⚙️ Step 3: Install Project Dependencies

Run these commands in the project root directory:

```powershell
# Install root dependencies
npm install

# Install client dependencies
cd client
npm install

# Install server dependencies
cd ..\server
npm install

# Go back to root
cd ..
```

**Note**: The installation might take 5-10 minutes depending on your internet speed.

## 🔧 Step 4: Environment Configuration

1. Navigate to the server folder:
   ```powershell
   cd server
   ```

2. Copy the environment example file:
   ```powershell
   copy .env.example .env
   ```

3. Edit the `.env` file (you can use Notepad or VS Code):
   ```powershell
   notepad .env
   ```

4. Update the JWT_SECRET with a random string (keep it secure):
   ```env
   JWT_SECRET=your-random-secret-key-here-make-it-long-and-complex
   ```

5. Save and close the file

## 🚀 Step 5: Start the Application

1. Make sure you're in the project root directory:
   ```powershell
   cd ..  # if you're still in the server folder
   ```

2. Start the application:
   ```powershell
   npm run dev
   ```

3. Wait for both servers to start. You should see messages like:
   ```
   Server running on port 3001
   Client running on port 3000
   ```

4. Open your web browser and go to: `http://localhost:3000`

## 🎉 Step 6: Verify Everything Works

1. The CodeCollab interface should load in your browser
2. Try creating an account or logging in
3. Test creating a new project or joining a session

## 🔧 Troubleshooting

### Common Issues and Solutions

#### "npm is not recognized"
- Node.js wasn't installed correctly
- Restart your computer and try again
- Reinstall Node.js with administrator privileges

#### "Port 3000 is already in use"
- Another application is using port 3000
- Close other development servers
- Or kill the process:
  ```powershell
  netstat -ano | findstr :3000
  taskkill /PID [PID_NUMBER] /F
  ```

#### "Port 3001 is already in use"
- Similar to above, but for port 3001
  ```powershell
  netstat -ano | findstr :3001
  taskkill /PID [PID_NUMBER] /F
  ```

#### Installation errors with npm
- Try clearing npm cache:
  ```powershell
  npm cache clean --force
  ```
- Try running PowerShell as administrator

#### "Permission denied" errors
- Run PowerShell as administrator
- Or try:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```

## 🛡️ Windows Security Notes

If Windows Defender or your antivirus flags any files:
1. These are false positives common with Node.js applications
2. Add the project folder to your antivirus exceptions
3. If prompted by Windows Firewall, allow Node.js network access

## 📱 Next Steps

Once everything is running:
1. **Create an account** in the application
2. **Share your username** with the project owner
3. **Join a collaboration session** by getting an invite code
4. **Start coding together!**

## 🆘 Getting Help

If you encounter issues:
1. Check this troubleshooting section first
2. Try restarting your computer and following the steps again
3. Contact the project owner with:
   - Your Windows version
   - Screenshots of any error messages
   - Output from `node --version` and `npm --version`

## 💻 Useful Commands Reference

```powershell
# Start the full application
npm run dev

# Start only the server
npm run start

# Start only the client
npm run client

# Stop the application
Ctrl + C

# Check if servers are running
netstat -an | findstr :3000
netstat -an | findstr :3001

# Clear npm cache if issues occur
npm cache clean --force
```

## 🔄 Updating the Project

When the project gets updated:
```powershell
# Pull latest changes (if using Git)
git pull

# Update dependencies
npm install
cd client && npm install
cd ..\server && npm install
cd ..

# Restart the application
npm run dev
```

---

**🎯 Quick Start Summary:**
1. Install Node.js, npm, and Git
2. Get the project files
3. Run `npm install` in root, client, and server folders
4. Copy `.env.example` to `.env` in server folder
5. Run `npm run dev` from the project root
6. Open `http://localhost:3000` in your browser

**Need help?** Contact the project owner with any issues!

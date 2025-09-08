# 🚀 Quick Start for Team Members

Welcome to CodeCollab! This document will get you up and running in minutes.

## 📦 What You Need

- Windows laptop (any version from Windows 10+)
- Internet connection
- Administrator access to install software

## ⚡ Super Quick Setup

### Option 1: Automated Setup (Recommended)
1. Extract the project files to a folder (e.g., `C:\CodeCollab`)
2. Open the folder in File Explorer
3. **Right-click** on `setup.bat` and select **"Run as administrator"**
4. Follow the prompts - the script will handle everything automatically!

### Option 2: Manual Setup
1. **Install Node.js**: Go to [nodejs.org](https://nodejs.org/) and download the LTS version
2. **Restart your computer** after installing Node.js
3. Open **PowerShell** in the project folder
4. Run these commands:
   ```powershell
   npm install
   cd client; npm install
   cd ..\server; npm install
   cd ..
   copy server\.env.example server\.env
   npm run dev
   ```

## 🌐 Access the Application

Once setup is complete:
1. Open your web browser
2. Go to: `http://localhost:3000`
3. Create an account or log in
4. Start collaborating!

## 🆘 Need Help?

**If you see errors:**
1. Make sure Node.js is installed correctly
2. Try running PowerShell as administrator
3. Check the full setup guide: `TEAM_SETUP_GUIDE.md`

**Quick fixes:**
- **"npm is not recognized"** → Restart your computer after installing Node.js
- **"Port already in use"** → Close other development applications
- **Permission errors** → Run as administrator

## 📞 Contact

If you're still having issues, contact [PROJECT_OWNER] with:
- Screenshot of any error messages
- Your Windows version
- What step you're stuck on

---

**🎯 That's it! You should be coding together in under 10 minutes!**

// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const { exec } = require('child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Firebase Admin SDK for token verification
let admin = null;
try {
  // Only initialize Firebase Admin if credentials are available
  if (process.env.FIREBASE_ADMIN_KEY) {
    admin = require('firebase-admin');
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    
    console.log('✅ Firebase Admin SDK initialized');
  } else {
    console.log('⚠️ Firebase Admin SDK not initialized - FIREBASE_ADMIN_KEY not provided');
  }
} catch (error) {
  console.warn('⚠️ Firebase Admin SDK initialization failed:', error.message);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Import enhanced models
const { User, Project, Activity, Session } = require('./models/User');

// Import database service
const databaseService = require('./services/database');

// JWT secret key (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'codecollab-enhanced-secret-key';

// Token verification helper function
const verifyToken = async (token) => {
  // Validate token format
  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Invalid token format');
  }

  // Clean token (remove any whitespace/newlines)
  const cleanToken = token.trim();

  // First, try to verify as Firebase token
  if (admin) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(cleanToken);
      return {
        type: 'firebase',
        decoded: decodedToken,
        userId: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name || decodedToken.email?.split('@')[0] || 'User'
      };
    } catch (firebaseError) {
      // If Firebase verification fails, try JWT
      console.log(`🔍 Token is not a valid Firebase token (${firebaseError.code}), trying JWT...`);
    }
  }

  // Try to verify as JWT token
  try {
    const decoded = jwt.verify(cleanToken, JWT_SECRET, { algorithms: ['HS256', 'RS256'] }); // Allow both algorithms
    return {
      type: 'jwt',
      decoded: decoded,
      userId: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded.email?.split('@')[0] || 'User'
    };
  } catch (jwtError) {
    console.log(`🔍 JWT verification failed: ${jwtError.message}`);
    
    // Check if this is a demo token (fallback for development) or Google/Firebase token
    try {
      const tokenParts = cleanToken.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf8'));
        
        // Accept any valid JWT structure for development/demo purposes
        if (payload.sub && payload.email) {
          console.log(`🔍 Accepting demo/development token for: ${payload.email}`);
          return {
            type: 'demo-jwt',
            decoded: payload,
            userId: payload.sub,
            email: payload.email,
            name: payload.name || payload.email?.split('@')[0] || 'User'
          };
        }
      }
    } catch (demoError) {
      console.log(`🔍 Demo token parsing failed: ${demoError.message}`);
    }
    
    throw new Error(`Invalid token: Neither Firebase nor JWT verification succeeded (Firebase: ${admin ? 'available' : 'not configured'}, JWT: ${jwtError.message})`);
  }
};

// In-memory stores (in production, use a proper database)
const users = new Map();
const projects = new Map();
const activities = [];
const refreshTokens = new Set();

// Session/Room management for private collaboration
const collaborationSessions = new Map(); // sessionId -> session data
const sessionInviteKeys = new Map(); // inviteKey -> sessionId
const sessionUsers = new Map(); // sessionId -> Set of connected users

// Initialize enhanced demo users
const initializeDemoUsers = async () => {
  try {
    const demoUsersData = [
      {
        id: '1',
        name: 'Admin User',
        email: 'admin@codecollab.com',
        role: 'admin'
      },
      {
        id: '2',
        name: 'Demo User',
        email: 'user@codecollab.com',
        role: 'user'
      },
      {
        id: 'test-user-123',
        name: 'Test User',
        email: 'test@codecollab.com',
        role: 'user'
      }
    ];

    for (const userData of demoUsersData) {
      const user = new User(userData);
      await user.hashPassword(userData.email === 'admin@codecollab.com' ? 'admin123' : 'user123');
      users.set(user.email, user);
    }
    
    console.log('✅ Enhanced demo users initialized with models');
  } catch (error) {
    console.error('❌ Error initializing demo users:', error);
  }
};

// Initialize demo users
initializeDemoUsers();

// Import routes
const authRoutes = require('./routes/auth');

// Use routes
app.use('/api/auth', authRoutes);

// Serve static files from the React app build directory
const buildPath = path.join(__dirname, '..', 'client', 'build');
app.use(express.static(buildPath));

const server = http.createServer(app);

// Enhanced Socket.IO with authentication
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket authentication middleware with enhanced user models and session support
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  const sessionId = socket.handshake.auth.sessionId;
  const inviteKey = socket.handshake.auth.inviteKey;
  
  // For now, we'll allow connections but validate session access later
  if (!token || token === 'null' || token === 'undefined') {
    console.log(`⚠️ Socket connection as guest - No token provided`);
    // Allow guest access with limited permissions
    socket.userId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    socket.userEmail = 'guest@codecollab.com';
    socket.userName = 'Guest User';
    socket.userRole = 'guest';
    socket.userAvatar = null;
    socket.authenticated = false;
    socket.tokenType = 'guest';
    socket.sessionId = null; // Will be set when joining a session
    return next();
  }

  try {
    console.log(`🔍 Attempting to verify token for socket connection: ${token.substring(0, 20)}...`);
    const tokenInfo = await verifyToken(token);
    
    // Get or create user based on token type
    let user;
    if (tokenInfo.type === 'firebase') {
      // For Firebase users, get or create user record
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
      
      if (!user) {
        // Create new user for Firebase authentication
        const newUser = new User({
          id: tokenInfo.userId,
          name: tokenInfo.name,
          email: tokenInfo.email,
          role: 'user',
          provider: 'google'
        });
        users.set(tokenInfo.email, newUser);
        user = newUser;
        console.log(`✅ Created new user from Firebase auth: ${user.name}`);
      }
    } else {
      // For JWT tokens, find existing user or auto-create for demo tokens
      user = users.get(tokenInfo.email);
      if (!user && (tokenInfo.type === 'demo-jwt' || tokenInfo.type === 'jwt')) {
        // Auto-create user for demo/development tokens
        user = {
          id: tokenInfo.userId,
          email: tokenInfo.email,
          name: tokenInfo.name,
          role: 'user',
          createdAt: new Date().toISOString(),
          isActive: true,
          updateActivity: function() {
            this.lastActive = new Date().toISOString();
          }
        };
        users.set(tokenInfo.email, user);
        console.log(`✅ Auto-created user for demo/development socket: ${tokenInfo.email}`);
      }
      
      if (!user || !user.isActive) {
        console.log(`⚠️ Socket connection rejected - User not found or inactive:`, tokenInfo.email);
        return next(new Error('User not found or inactive'));
      }
    }

    // Update user activity
    user.updateActivity();

    socket.userId = user.id;
    socket.userEmail = user.email;
    socket.userName = user.name;
    socket.userRole = user.role;
    socket.userAvatar = user.avatar;
    socket.authenticated = true;
    socket.tokenType = tokenInfo.type;
    socket.sessionId = null; // Will be set when joining a session

    console.log(`✅ Socket authenticated for user: ${user.name} (${user.email}) - Role: ${user.role} - Token: ${tokenInfo.type}`);
    next();
    
  } catch (error) {
    console.log(`⚠️ Socket connection rejected - Token verification failed:`, error.message);
    console.log(`⚠️ Token details: Type=${typeof token}, Length=${token?.length}, Value=${token?.substring(0, 50)}...`);
    
    // Allow connection as guest if token verification fails
    console.log(`🔓 Allowing connection as guest due to token verification failure`);
    socket.userId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    socket.userEmail = 'guest@codecollab.com';
    socket.userName = 'Guest User';
    socket.userRole = 'guest';
    socket.userAvatar = null;
    socket.authenticated = false;
    socket.tokenType = 'guest';
    socket.sessionId = null;
    return next();
  }
});

let currentCode = ''; // This will hold the shared code
let virtualFileStore = new Map(); // In-memory virtual file system

// Performance monitoring variables
let connectedClients = new Set();
let performanceMetrics = {
  cpu: 0,
  memory: 0,
  network: 0,
  buildTime: 0,
  activeUsers: 0,
  serverLoad: 0,
  errorRate: 0,
  responseTime: 0
};
let monitoringInterval = null;

// Piston API configuration
const PISTON_API_URL = 'https://emkc.org/api/v2/piston';

// Language mapping for Piston API
const languageMap = {
  'javascript': { language: 'javascript', version: '18.15.0' },
  'python': { language: 'python', version: '3.10.0' },
  'java': { language: 'java', version: '15.0.2' },
  'cpp': { language: 'cpp', version: '10.2.0' },
  'c': { language: 'c', version: '10.2.0' },
  'typescript': { language: 'typescript', version: '5.0.3' },
  'php': { language: 'php', version: '8.2.3' },
  'ruby': { language: 'ruby', version: '3.0.1' },
  'go': { language: 'go', version: '1.16.2' },
  'rust': { language: 'rust', version: '1.68.2' },
  'kotlin': { language: 'kotlin', version: '1.8.20' },
  'swift': { language: 'swift', version: '5.3.3' },
  'csharp': { language: 'csharp', version: '6.12.0' }
};

// Helper function to generate secure invite keys
const generateInviteKey = (length = 12) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Helper function to create a new collaboration session
const createCollaborationSession = (creatorId, sessionName, settings = {}) => {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const inviteKey = generateInviteKey();
  
  const session = {
    id: sessionId,
    name: sessionName || `Session ${sessionId.substr(-6)}`,
    creatorId: creatorId,
    inviteKey: inviteKey,
    createdAt: Date.now(),
    settings: {
      maxUsers: settings.maxUsers || 10,
      allowGuests: settings.allowGuests || false,
      isPublic: false, // Always private now
      permissions: settings.permissions || {
        canViewFiles: true,
        canEditFiles: true,
        canCreateFiles: true,
        canCreateFolders: true,
        canDeleteFiles: false,
        canManagePermissions: false,
        canInviteOthers: false,
        canExecute: true,
        canChat: true
      }
    },
    files: new Map(), // Session-specific file system
    currentCode: '', // Session-specific code
    chatHistory: [],
    connectedUsers: new Set(),
    userPermissions: new Map() // userId -> permissions
  };

  collaborationSessions.set(sessionId, session);
  sessionInviteKeys.set(inviteKey, sessionId);
  sessionUsers.set(sessionId, new Set());

  console.log(`🔐 Created private session: ${sessionId} with invite key: ${inviteKey}`);
  return session;
};

// Helper function to join a session with invite key
const joinSessionWithKey = async (inviteKey, userId, userInfo) => {
  const sessionId = sessionInviteKeys.get(inviteKey);
  if (!sessionId) {
    throw new Error('Invalid or expired invite key');
  }

  const session = collaborationSessions.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // Check if session is full
  if (session.connectedUsers.size >= session.settings.maxUsers) {
    throw new Error('Session is full');
  }

  // Check if user is already in session
  if (session.connectedUsers.has(userId)) {
    console.log(`📝 User ${userInfo.name} rejoined session ${sessionId}`);
    return session;
  }

  // Add user to session
  session.connectedUsers.add(userId);
  sessionUsers.get(sessionId).add(userId);

  // Set default permissions for new user
  if (!session.userPermissions.has(userId)) {
    // Assign all granular permissions from session.settings.permissions
    session.userPermissions.set(userId, {
      canViewFiles: session.settings.permissions.canViewFiles,
      canEditFiles: session.settings.permissions.canEditFiles,
      canCreateFiles: session.settings.permissions.canCreateFiles,
      canCreateFolders: session.settings.permissions.canCreateFolders,
      canDeleteFiles: session.settings.permissions.canDeleteFiles,
      canManagePermissions: session.settings.permissions.canManagePermissions,
      canInviteOthers: session.settings.permissions.canInviteOthers || userId === session.creatorId,
      canExecute: session.settings.permissions.canExecute,
      canChat: session.settings.permissions.canChat
    });
  }

  // Log activity
  const joinActivity = new Activity({
    type: 'session',
    action: 'user_joined',
    target: sessionId,
    user: userInfo,
    details: {
      sessionName: session.name,
      userCount: session.connectedUsers.size
    }
  });
  activities.push(joinActivity);

  console.log(`👥 User ${userInfo.name} joined session ${sessionId} (${session.connectedUsers.size}/${session.settings.maxUsers} users)`);
  return session;
};

// Helper function to leave a session
const leaveSession = (sessionId, userId, userInfo) => {
  const session = collaborationSessions.get(sessionId);
  if (!session) return false;

  session.connectedUsers.delete(userId);
  const sessionUserSet = sessionUsers.get(sessionId);
  if (sessionUserSet) {
    sessionUserSet.delete(userId);
  }

  // Log activity
  const leaveActivity = new Activity({
    type: 'session',
    action: 'user_left',
    target: sessionId,
    user: userInfo,
    details: {
      sessionName: session.name,
      userCount: session.connectedUsers.size
    }
  });
  activities.push(leaveActivity);

  console.log(`👋 User ${userInfo.name} left session ${sessionId} (${session.connectedUsers.size} users remaining)`);

  // If session is empty and creator left, optionally clean up after some time
  if (session.connectedUsers.size === 0) {
    console.log(`🧹 Session ${sessionId} is now empty, scheduling cleanup...`);
    // Clean up empty session after 1 hour
    setTimeout(() => {
      if (session.connectedUsers.size === 0) {
        collaborationSessions.delete(sessionId);
        sessionInviteKeys.delete(session.inviteKey);
        sessionUsers.delete(sessionId);
        console.log(`🗑️ Cleaned up empty session ${sessionId}`);
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  return true;
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    activeUsers: connectedClients.size,
    totalActivities: activities.length
  });
});

// API endpoints for file operations
app.get('/api/files', async (req, res) => {
  // Check if user is authenticated
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    // Return empty directory for non-authenticated users
    res.json([]);
    return;
  }

  try {
    // Verify token
    const tokenInfo = await verifyToken(token);
    
    // Get user
    let user;
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
    } else {
      user = users.get(tokenInfo.email);
    }

    if (!user) {
      res.json([]);
      return;
    }

    // Get files from database for the user
    const dbFiles = await databaseService.getFilesByUser(user.id);
    
    // Also get virtual file system files for backwards compatibility
    const virtualFiles = Array.from(virtualFileStore.entries()).map(([path, data]) => ({
      path,
      name: path.split('/').pop(),
      type: data.type,
      source: 'virtual',
      ...data
    }));

    // Combine database files and virtual files
    const allFiles = [
      ...dbFiles.map(file => ({
        path: file.path,
        name: file.name,
        type: file.isDirectory ? 'folder' : 'file',
        source: 'database',
        id: file.id,
        content: file.content,
        size: file.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        authorName: file.authorName
      })),
      ...virtualFiles.filter(vf => !dbFiles.some(df => df.path === vf.path))
    ];
    
    res.json(allFiles);
    
  } catch (error) {
    console.error('Error processing file request:', error);
    res.json([]);
  }
});

app.post('/api/files/create', async (req, res) => {
  const { path: filePath, type, content = '', name, projectId = 'default' } = req.body;
  
  // Check if user is authenticated
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    // Verify token and get user info
    const tokenInfo = await verifyToken(token);
    
    // Get user from our user store
    let user;
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
      if (!user) {
        // Create new user for Firebase authentication
        const newUser = new User({
          id: tokenInfo.userId,
          name: tokenInfo.name,
          email: tokenInfo.email,
          role: 'user',
          provider: 'google'
        });
        users.set(tokenInfo.email, newUser);
        user = newUser;
      }
    } else {
      user = users.get(tokenInfo.email);
      if (!user || !user.isActive) {
        res.status(401).json({ success: false, message: 'User not found or inactive' });
        return;
      }
    }

    // Create file/folder data
    const fileData = {
      name: name || filePath.split('/').pop(),
      path: filePath,
      content: content,
      type: type,
      projectId: projectId,
      authorName: user.name
    };

    // Save to database
    const savedFile = await databaseService.createFile(fileData, user.id);

    // Also save to virtual file system for backwards compatibility
    const virtualPath = filePath;
    if (type === 'file') {
      virtualFileStore.set(virtualPath, {
        content,
        type: 'file',
        lastModified: Date.now(),
        createdBy: user.email,
        dbId: savedFile.id
      });
    } else if (type === 'folder') {
      virtualFileStore.set(virtualPath + '/', {
        content: '',
        type: 'folder',
        lastModified: Date.now(),
        createdBy: user.email,
        dbId: savedFile.id
      });
    }

    res.json({ 
      success: true, 
      message: `${type} created successfully`,
      file: savedFile
    });
    
    // Broadcast virtual file system update to all clients
    io.emit('virtual_fs_update', {
      action: 'create',
      path: virtualPath,
      data: {
        ...virtualFileStore.get(type === 'folder' ? virtualPath + '/' : virtualPath),
        dbFile: savedFile
      }
    });

    console.log(`📁 ${type} created and saved to database: ${fileData.name} by ${user.name} (${user.email})`);
    
  } catch (error) {
    console.error('Error creating file/folder:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/files/read/:*', async (req, res) => {
  const filePath = req.params[0];
  
  // Check if user is authenticated
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    // Verify token
    const tokenInfo = await verifyToken(token);
    
    // First check database for the file
    const dbFile = await databaseService.getFileByPath(filePath);
    if (dbFile && !dbFile.isDirectory) {
      res.json({ 
        content: dbFile.content,
        file: dbFile
      });
      return;
    }
    
    // Fallback to virtual file system
    const virtualFile = virtualFileStore.get(filePath);
    if (virtualFile && virtualFile.type === 'file') {
      res.json({ content: virtualFile.content });
      return;
    }
    
    res.status(404).json({ success: false, message: 'File not found' });
    
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Virtual file system endpoints
app.post('/api/virtual-files', async (req, res) => {
  const { path: filePath, content, type = 'file' } = req.body;
  
  try {
    // Save to virtual file system
    virtualFileStore.set(filePath, {
      content,
      type,
      lastModified: Date.now()
    });

    // Check if user is authenticated and save to database
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const tokenInfo = await verifyToken(token);
        let user;
        
        if (tokenInfo.type === 'firebase') {
          user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
        } else {
          user = users.get(tokenInfo.email);
        }

        if (user) {
          const fileData = {
            name: filePath.split('/').pop(),
            path: filePath,
            content: content,
            type: type === 'folder' ? 'folder' : 'file',
            projectId: 'default',
            authorName: user.name
          };

          await databaseService.createFile(fileData, user.id);
          console.log(`📁 Virtual file saved to database: ${filePath} by ${user.name}`);
        }
      } catch (authError) {
        console.log('Authentication failed for virtual file creation, proceeding with virtual-only storage');
      }
    }
    
    res.json({ success: true, message: 'File saved to virtual file system' });
    
    // Broadcast virtual file system update
    io.emit('virtual_fs_update', {
      action: 'create',
      path: filePath,
      data: virtualFileStore.get(filePath)
    });
    
  } catch (error) {
    console.error('Error creating virtual file:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/virtual-files/:*', (req, res) => {
  const filePath = req.params[0];
  
  const file = virtualFileStore.get(filePath);
  if (file) {
    res.json({ content: file.content, ...file });
  } else {
    res.status(404).json({ success: false, message: 'File not found in virtual file system' });
  }
});

app.put('/api/virtual-files/:*', async (req, res) => {
  const filePath = req.params[0];
  const { content } = req.body;
  
  // Check if user is authenticated
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    if (token) {
      // Verify token for authenticated users
      const tokenInfo = await verifyToken(token);
      
      // Get user
      let user;
      if (tokenInfo.type === 'firebase') {
        user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
      } else {
        user = users.get(tokenInfo.email);
      }

      if (user) {
        // Try to update in database first
        const dbFile = await databaseService.getFileByPath(filePath);
        if (dbFile) {
          await databaseService.updateFile(dbFile.id, { content }, user.id);
          console.log(`📝 Database file updated: ${filePath} by ${user.name}`);
        }
      }
    }

    // Update virtual file system for backwards compatibility
    const existingFile = virtualFileStore.get(filePath);
    if (existingFile) {
      virtualFileStore.set(filePath, {
        ...existingFile,
        content,
        lastModified: Date.now()
      });
      
      res.json({ success: true, message: 'File updated in virtual file system' });
      
      // Broadcast update
      io.emit('virtual_fs_update', {
        action: 'update',
        path: filePath,
        data: virtualFileStore.get(filePath)
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found in virtual file system' });
    }
  } catch (error) {
    console.error('Error updating file:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/virtual-files/:*', (req, res) => {
  const filePath = req.params[0];
  
  if (virtualFileStore.has(filePath)) {
    virtualFileStore.delete(filePath);
    res.json({ success: true, message: 'File deleted from virtual file system' });
    
    // Broadcast deletion
    io.emit('virtual_fs_update', {
      action: 'delete',
      path: filePath
    });
  } else {
    res.status(404).json({ success: false, message: 'File not found in virtual file system' });
  }
});

app.get('/api/virtual-files', async (req, res) => {
  // Check if user is authenticated
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    let allFiles = [];

    if (token) {
      // Get database files for authenticated users
      const tokenInfo = await verifyToken(token);
      let user;
      
      if (tokenInfo.type === 'firebase') {
        user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
      } else {
        user = users.get(tokenInfo.email);
      }

      if (user) {
        const dbFiles = await databaseService.getFilesByUser(user.id);
        allFiles = dbFiles.map(file => ({
          path: file.path,
          content: file.content,
          type: file.isDirectory ? 'folder' : 'file',
          size: file.size,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          authorName: file.authorName,
          source: 'database',
          id: file.id
        }));
      }
    }

    // Add virtual file system files
    const virtualFiles = Array.from(virtualFileStore.entries()).map(([path, data]) => ({
      path,
      ...data,
      source: 'virtual'
    }));

    // Combine and deduplicate (database files take precedence)
    const combinedFiles = [...allFiles];
    virtualFiles.forEach(vf => {
      if (!allFiles.some(df => df.path === vf.path)) {
        combinedFiles.push(vf);
      }
    });

    res.json(combinedFiles);
  } catch (error) {
    console.error('Error getting virtual files:', error);
    // Fallback to virtual file system only
    const files = Array.from(virtualFileStore.entries()).map(([path, data]) => ({
      path,
      ...data,
      source: 'virtual'
    }));
    res.json(files);
  }
});

// Database-specific file management endpoints
app.get('/api/database/files', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const tokenInfo = await verifyToken(token);
    let user;
    
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
    } else {
      user = users.get(tokenInfo.email);
    }

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    const files = await databaseService.getFilesByUser(user.id);
    res.json({ success: true, files });
    
  } catch (error) {
    console.error('Error getting database files:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/database/files/stats', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const stats = await databaseService.getFileStats();
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('Error getting file stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/database/activities', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const { projectId, limit = 50 } = req.query;
    const activities = await databaseService.getActivities(projectId, parseInt(limit));
    res.json({ success: true, activities });
    
  } catch (error) {
    console.error('Error getting activities:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/database/files/search', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const { query, projectId } = req.body;
    const results = await databaseService.searchFiles(query, projectId);
    res.json({ success: true, results });
    
  } catch (error) {
    console.error('Error searching files:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Session management endpoints
const sessions = new Map(); // In-memory session storage

// Private collaboration session endpoints
app.post('/api/sessions/create', async (req, res) => {
  const { sessionName, settings } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required to create sessions' });
    return;
  }

  try {
    const tokenInfo = await verifyToken(token);
    let user;
    
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
    } else {
      user = users.get(tokenInfo.email);
    }

    // Auto-create user for demo/development tokens
    if (!user && (tokenInfo.type === 'demo-jwt' || tokenInfo.type === 'jwt')) {
      user = {
        id: tokenInfo.userId,
        email: tokenInfo.email,
        name: tokenInfo.name,
        role: 'user',
        createdAt: new Date().toISOString()
      };
      users.set(tokenInfo.email, user);
      console.log(`✅ Auto-created user for demo/development: ${tokenInfo.email}`);
    }

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

  const session = createCollaborationSession(user.id, sessionName, settings);
    
    // Automatically add the creator to the session
    const userInfo = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role
    };
    
    try {
      await joinSessionWithKey(session.inviteKey, user.id, userInfo);
      console.log(`✅ Session creator auto-joined to session ${session.id}`);
    } catch (joinError) {
      console.warn(`⚠️ Failed to auto-join creator to session ${session.id}:`, joinError.message);
    }
    
    res.json({ 
      success: true, 
      session: {
        id: session.id,
        name: session.name,
        creatorId: session.creatorId,
        inviteKey: session.inviteKey,
        createdAt: session.createdAt,
        settings: session.settings,
        userCount: session.connectedUsers.size
      }
    });
    
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/sessions/join', async (req, res) => {
  const { inviteKey } = req.body;
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!inviteKey) {
    res.status(400).json({ success: false, message: 'Invite key is required' });
    return;
  }

  try {
    let user = null;
    
    if (token) {
      // Authenticated user
      const tokenInfo = await verifyToken(token);
      
      if (tokenInfo.type === 'firebase') {
        user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
      } else {
        user = users.get(tokenInfo.email);
      }
    }

    // If no authenticated user, check if guests are allowed
    const sessionId = sessionInviteKeys.get(inviteKey);
    if (!sessionId) {
      res.status(404).json({ success: false, message: 'Invalid invite key' });
      return;
    }

    const session = collaborationSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    if (!user && !session.settings.allowGuests) {
      res.status(401).json({ success: false, message: 'Authentication required for this session' });
      return;
    }

    // Create guest user if needed
    if (!user) {
      user = {
        id: `guest_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: `Guest User`,
        email: 'guest@codecollab.com',
        role: 'guest',
        avatar: 'G'
      };
    }

    const joinedSession = await joinSessionWithKey(inviteKey, user.id, user);
    
    res.json({ 
      success: true, 
      session: {
        id: joinedSession.id,
        name: joinedSession.name,
        creatorId: joinedSession.creatorId,
        createdAt: joinedSession.createdAt,
        settings: joinedSession.settings,
        userCount: joinedSession.connectedUsers.size,
        userPermissions: joinedSession.userPermissions.get(user.id)
      },
      user: user
    });
    
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const token = req.headers.authorization?.split(' ')[1];
  
  try {
    const session = collaborationSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    // Verify user has access to this session
    let hasAccess = false;
    
    if (token) {
      const tokenInfo = await verifyToken(token);
      let user;
      
      if (tokenInfo.type === 'firebase') {
        user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
      } else {
        user = users.get(tokenInfo.email);
      }

      if (user && session.connectedUsers.has(user.id)) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      res.status(403).json({ success: false, message: 'Access denied to this session' });
      return;
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        name: session.name,
        creatorId: session.creatorId,
        createdAt: session.createdAt,
        settings: session.settings,
        userCount: session.connectedUsers.size,
        files: Array.from(session.files.entries()).map(([path, data]) => ({
          path,
          ...data
        }))
      }
    });
    
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/sessions', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const tokenInfo = await verifyToken(token);
    let user;
    
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
    } else {
      user = users.get(tokenInfo.email);
    }

    // Auto-create user for demo/development tokens
    if (!user && (tokenInfo.type === 'demo-jwt' || tokenInfo.type === 'jwt')) {
      user = {
        id: tokenInfo.userId,
        email: tokenInfo.email,
        name: tokenInfo.name,
        role: 'user',
        createdAt: new Date().toISOString()
      };
      users.set(tokenInfo.email, user);
      console.log(`✅ Auto-created user for demo/development: ${tokenInfo.email}`);
    }

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    // Get sessions where user is connected or is the creator
    const userSessions = Array.from(collaborationSessions.values())
      .filter(session => 
        session.creatorId === user.id || 
        session.connectedUsers.has(user.id)
      )
      .map(session => ({
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        userCount: session.connectedUsers.size,
        isCreator: session.creatorId === user.id,
        inviteKey: session.creatorId === user.id ? session.inviteKey : undefined
      }));

    res.json({ success: true, sessions: userSessions });
    
  } catch (error) {
    console.error('Error getting user sessions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/sessions/:sessionId/regenerate-key', async (req, res) => {
  const { sessionId } = req.params;
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const tokenInfo = await verifyToken(token);
    let user;
    
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
    } else {
      user = users.get(tokenInfo.email);
    }

    const session = collaborationSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    // Only creator can regenerate invite key
    if (session.creatorId !== user.id) {
      res.status(403).json({ success: false, message: 'Only session creator can regenerate invite key' });
      return;
    }

    // Remove old key and generate new one
    sessionInviteKeys.delete(session.inviteKey);
    const newInviteKey = generateInviteKey();
    session.inviteKey = newInviteKey;
    sessionInviteKeys.set(newInviteKey, sessionId);

    res.json({ 
      success: true, 
      inviteKey: newInviteKey,
      message: 'Invite key regenerated successfully'
    });
    
  } catch (error) {
    console.error('Error regenerating invite key:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const tokenInfo = await verifyToken(token);
    let user;
    
    if (tokenInfo.type === 'firebase') {
      user = Array.from(users.values()).find(u => u.id === tokenInfo.userId || u.email === tokenInfo.email);
    } else {
      user = users.get(tokenInfo.email);
    }

    const session = collaborationSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ success: false, message: 'Session not found' });
      return;
    }

    // Only creator can delete session
    if (session.creatorId !== user.id) {
      res.status(403).json({ success: false, message: 'Only session creator can delete session' });
      return;
    }

    // Notify all connected users that session is being deleted
    io.to(sessionId).emit('session_deleted', {
      sessionId: sessionId,
      message: 'Session has been deleted by the creator'
    });

    // Clean up session data
    collaborationSessions.delete(sessionId);
    sessionInviteKeys.delete(session.inviteKey);
    sessionUsers.delete(sessionId);

    res.json({ 
      success: true, 
      message: 'Session deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/sessions', (req, res) => {
  const { sessionId, sessionData } = req.body;
  
  try {
    sessions.set(sessionId, {
      ...sessionData,
      lastUpdated: Date.now()
    });
    
    res.json({ success: true, message: 'Session saved' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  const session = sessions.get(sessionId);
  if (session) {
    res.json(session);
  } else {
    res.status(404).json({ success: false, message: 'Session not found' });
  }
});

app.get('/api/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
    id,
    lastUpdated: data.lastUpdated,
    fileCount: data.virtualFileSystem ? Object.keys(data.virtualFileSystem.files || {}).length : 0,
    tabCount: data.tabs ? data.tabs.length : 0
  }));
  
  res.json(sessionList);
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (sessions.has(sessionId)) {
    sessions.delete(sessionId);
    res.json({ success: true, message: 'Session deleted' });
  } else {
    res.status(404).json({ success: false, message: 'Session not found' });
  }
});

// Test endpoint for debugging Socket.IO issues
app.get('/api/test-socket', (req, res) => {
  res.json({ 
    message: 'Server is running',
    socketConnections: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// Piston API endpoints for code execution

// Get available languages
app.get('/api/execution/languages', async (req, res) => {
  try {
    const response = await axios.get(`${PISTON_API_URL}/runtimes`);
    const supportedLanguages = Object.keys(languageMap).map(lang => {
      const pistonLang = response.data.find(r => 
        r.language === languageMap[lang].language && 
        r.version === languageMap[lang].version
      );
      return {
        name: lang,
        displayName: lang.charAt(0).toUpperCase() + lang.slice(1),
        version: languageMap[lang].version,
        available: !!pistonLang
      };
    });
    
    res.json({ languages: supportedLanguages });
  } catch (error) {
    console.error('❌ Error fetching languages:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch available languages',
      fallback: Object.keys(languageMap).map(lang => ({
        name: lang,
        displayName: lang.charAt(0).toUpperCase() + lang.slice(1),
        version: languageMap[lang].version,
        available: true
      }))
    });
  }
});

// Execute code
app.post('/api/execution/execute', async (req, res) => {
  try {
    const { code, language, input = '' } = req.body;
    
    if (!code || !language) {
      return res.status(400).json({
        error: 'Code and language are required'
      });
    }

    const pistonConfig = languageMap[language.toLowerCase()];
    if (!pistonConfig) {
      return res.status(400).json({
        error: `Unsupported language: ${language}`
      });
    }

    console.log(`🚀 Executing ${language} code...`);
    
    const executionRequest = {
      language: pistonConfig.language,
      version: pistonConfig.version,
      files: [
        {
          name: getFileName(language),
          content: code
        }
      ],
      stdin: input,
      compile_timeout: 10000,
      run_timeout: 3000,
      compile_memory_limit: -1,
      run_memory_limit: -1
    };

    const response = await axios.post(`${PISTON_API_URL}/execute`, executionRequest, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = response.data;
    
    // Format the response
    const executionResult = {
      success: true,
      language: language,
      version: pistonConfig.version,
      compile: result.compile || { stdout: '', stderr: '', code: 0 },
      run: result.run || { stdout: '', stderr: '', code: 0 },
      output: result.run?.stdout || '',
      error: result.run?.stderr || result.compile?.stderr || '',
      exitCode: result.run?.code ?? result.compile?.code ?? 0,
      executionTime: Date.now()
    };

    console.log(`✅ Code execution completed for ${language}`);
    res.json(executionResult);

  } catch (error) {
    console.error('❌ Code execution error:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({
        success: false,
        error: 'Code execution timed out',
        details: 'The code took too long to execute'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Code execution failed',
      details: error.message
    });
  }
});

// Helper function to get appropriate filename for language
function getFileName(language) {
  const extensions = {
    'javascript': 'main.js',
    'typescript': 'main.ts',
    'python': 'main.py',
    'java': 'Main.java',
    'cpp': 'main.cpp',
    'c': 'main.c',
    'php': 'main.php',
    'ruby': 'main.rb',
    'go': 'main.go',
    'rust': 'main.rs',
    'kotlin': 'Main.kt',
    'swift': 'main.swift',
    'csharp': 'Main.cs'
  };
  
  return extensions[language.toLowerCase()] || 'main.txt';
}

// Track connections to prevent spam and improve stability
const connectionTracker = new Map();
const MAX_CONNECTIONS_PER_IP = 10; // Increased limit
const CONNECTION_WINDOW = 30000; // 30 seconds - longer window

// Helper function to update performance metrics
const updatePerformanceMetrics = () => {
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  performanceMetrics = {
    cpu: Math.round(loadAvg[0] * 10), // Approximate CPU usage
    memory: Math.round((usedMem / totalMem) * 100),
    network: Math.random() * 5, // Simulated network usage
    buildTime: Math.random() * 10,
    activeUsers: connectedClients.size,
    serverLoad: loadAvg[0],
    errorRate: Math.random() * 2,
    responseTime: Math.round(Math.random() * 200 + 50)
  };
};

io.on('connection', (socket) => {
  const clientId = socket.id;
  const clientIP = socket.request.connection.remoteAddress || socket.handshake.address || 'unknown';
  const userName = socket.userName;
  const userEmail = socket.userEmail;
  
  // Enhanced rate limiting per IP
  const now = Date.now();
  const connections = connectionTracker.get(clientIP) || [];
  const recentConnections = connections.filter(time => now - time < CONNECTION_WINDOW);
  
  // Only apply rate limiting for excessive connections
  if (recentConnections.length >= MAX_CONNECTIONS_PER_IP) {
    console.log(`⚠️ Rate limiting client ${clientIP} (${recentConnections.length} connections)`);
    socket.emit('connection_error', 'Too many connections from this IP');
    socket.disconnect(true);
    return;
  }
  
  connectionTracker.set(clientIP, [...recentConnections, now]);
  connectedClients.add(clientId);
  performanceMetrics.activeUsers = connectedClients.size;
  
  console.log(`🔌 Client connected: ${userName} (${userEmail}) - ${clientId} from ${clientIP} (${connectedClients.size} total connections)`);

  // Add error handling for socket events
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${userName} (${clientId}):`, error);
  });

  console.log(`✅ Socket event handlers registered for ${userName} (${clientId})`);

  // Session management events
  socket.on('join_session', async (data) => {
    const { inviteKey, sessionId: requestedSessionId } = data;
    
    console.log(`📥 Join session request from ${socket.userName}: inviteKey=${inviteKey}, sessionId=${requestedSessionId}`);
    
    try {
      let session = null;
      
      if (inviteKey) {
        console.log(`🔑 Attempting to join session with invite key: ${inviteKey}`);
        
        // Join session using invite key
        const userInfo = {
          id: socket.userId,
          name: socket.userName,
          email: socket.userEmail,
          avatar: socket.userAvatar,
          role: socket.userRole
        };
        
        session = await joinSessionWithKey(inviteKey, socket.userId, userInfo);
        socket.sessionId = session.id;
        
        // Join the socket room for this session
        socket.join(session.id);
        
        // Send session data to the user
        socket.emit('session_joined', {
          session: {
            id: session.id,
            name: session.name,
            creatorId: session.creatorId,
            createdAt: session.createdAt,
            settings: session.settings,
            userCount: session.connectedUsers.size,
            userPermissions: session.userPermissions.get(socket.userId)
          },
          message: `Successfully joined session: ${session.name}`
        });

        console.log(`📤 Sent session_joined event to ${socket.userName} for session ${session.id}`);

        // Send current session state
        socket.emit('code_update', {
          code: session.currentCode,
          sessionId: session.id
        });

        // Send virtual file system state for this session
        const sessionFiles = Array.from(session.files.entries()).map(([path, data]) => ({
          path,
          ...data
        }));
        socket.emit('virtual_fs_state', sessionFiles);

        // Notify other users in the session
        socket.to(session.id).emit('user_joined_session', {
          userId: socket.userId,
          userName: socket.userName,
          userEmail: socket.userEmail,
          userRole: socket.userRole,
          userAvatar: socket.userAvatar,
          sessionId: session.id,
          userCount: session.connectedUsers.size,
          timestamp: Date.now()
        });

        // Send updated session info to all users in the session (including the one who just joined)
        io.to(session.id).emit('session_update', {
          sessionId: session.id,
          userCount: session.connectedUsers.size,
          timestamp: Date.now()
        });

        console.log(`👥 User ${socket.userName} joined session ${session.id} via invite key`);
        
      } else if (requestedSessionId) {
        // Join specific session (if user has access)
        session = collaborationSessions.get(requestedSessionId);
        if (!session) {
          socket.emit('session_error', { message: 'Session not found' });
          return;
        }

        if (!session.connectedUsers.has(socket.userId)) {
          socket.emit('session_error', { message: 'Access denied to this session' });
          return;
        }

        socket.sessionId = session.id;
        socket.join(session.id);

        socket.emit('session_joined', {
          session: {
            id: session.id,
            name: session.name,
            creatorId: session.creatorId,
            createdAt: session.createdAt,
            settings: session.settings,
            userCount: session.connectedUsers.size,
            userPermissions: session.userPermissions.get(socket.userId)
          },
          message: `Reconnected to session: ${session.name}`
        });

        // Send current session state
        socket.emit('code_update', {
          code: session.currentCode,
          sessionId: session.id
        });

        console.log(`🔄 User ${socket.userName} reconnected to session ${session.id}`);
        
      } else {
        socket.emit('session_error', { message: 'No session specified or invite key provided' });
        return;
      }

    } catch (error) {
      console.error(`❌ Error joining session for ${socket.userName}:`, error.message);
      socket.emit('session_error', { message: error.message });
    }
  });

  socket.on('leave_session', () => {
    if (socket.sessionId) {
      const session = collaborationSessions.get(socket.sessionId);
      if (session) {
        // Leave the socket room
        socket.leave(socket.sessionId);
        
        // Remove user from session
        const userInfo = {
          id: socket.userId,
          name: socket.userName,
          email: socket.userEmail,
          avatar: socket.userAvatar,
          role: socket.userRole
        };
        
        leaveSession(socket.sessionId, socket.userId, userInfo);
        
        // Notify other users in the session
        socket.to(socket.sessionId).emit('user_left_session', {
          userId: socket.userId,
          userName: socket.userName,
          sessionId: socket.sessionId,
          userCount: session.connectedUsers.size,
          timestamp: Date.now()
        });

        // Send updated session info to all remaining users in the session
        io.to(socket.sessionId).emit('session_update', {
          sessionId: socket.sessionId,
          userCount: session.connectedUsers.size,
          timestamp: Date.now()
        });
        
        socket.emit('session_left', { 
          sessionId: socket.sessionId,
          message: 'Successfully left the session'
        });
        
        console.log(`👋 User ${socket.userName} left session ${socket.sessionId}`);
        socket.sessionId = null;
      }
    }
  });

  socket.on('get_session_users', () => {
    if (socket.sessionId) {
      const session = collaborationSessions.get(socket.sessionId);
      if (session) {
        const sessionUsers = Array.from(session.connectedUsers).map(userId => {
          // Find user details (simplified for now)
          return {
            id: userId,
            name: `User ${userId}`, // You could enhance this to get actual user names
            status: 'online'
          };
        });
        
        socket.emit('session_users', { 
          users: sessionUsers,
          userCount: session.connectedUsers.size,
          sessionId: socket.sessionId
        });
      }
    }
  });

  socket.on('get_session_info', () => {
    if (socket.sessionId) {
      const session = collaborationSessions.get(socket.sessionId);
      if (session) {
        socket.emit('session_info', {
          sessionId: session.id,
          name: session.name,
          creatorId: session.creatorId,  // Include creatorId
          userCount: session.connectedUsers.size,
          settings: session.settings,
          createdAt: session.createdAt,   // Include createdAt for consistency
          timestamp: Date.now()
        });
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 Client disconnected: ${socket.userName} (${socket.userEmail}) - ${clientId} - Reason: ${reason}`);
    
    // Leave session if connected to one
    if (socket.sessionId) {
      const session = collaborationSessions.get(socket.sessionId);
      if (session) {
        const userInfo = {
          id: socket.userId,
          name: socket.userName,
          email: socket.userEmail,
          avatar: socket.userAvatar,
          role: socket.userRole
        };
        
        leaveSession(socket.sessionId, socket.userId, userInfo);
        
        // Notify other users in the session
        socket.to(socket.sessionId).emit('user_left_session', {
          userId: socket.userId,
          userName: socket.userName,
          sessionId: socket.sessionId,
          userCount: session.connectedUsers.size,
          reason: 'disconnect',
          timestamp: Date.now()
        });

        // Send updated session info to all remaining users in the session
        io.to(socket.sessionId).emit('session_update', {
          sessionId: socket.sessionId,
          userCount: session.connectedUsers.size,
          timestamp: Date.now()
        });
      }
    }
    
    // Update user status to offline
    const user = users.get(socket.userEmail);
    if (user) {
      if (typeof user.setOffline === 'function') {
        user.setOffline();
      }
      
      // Log activity
      const disconnectActivity = new Activity({
        type: 'user_session',
        action: 'disconnected',
        target: 'platform',
        user: {
          id: user.id,
          name: user.name,
          avatar: user.avatar
        },
        details: {
          clientId: clientId,
          reason: reason,
          sessionDuration: Date.now() - user.lastActivity,
          sessionId: socket.sessionId
        }
      });
      activities.push(disconnectActivity);
    }
    
    // Clean up connection tracking
    const connections = connectionTracker.get(clientIP) || [];
    const updatedConnections = connections.filter(time => now - time < CONNECTION_WINDOW);
    if (updatedConnections.length > 0) {
      connectionTracker.set(clientIP, updatedConnections);
    } else {
      connectionTracker.delete(clientIP);
    }
    
    connectedClients.delete(clientId);
    performanceMetrics.activeUsers = connectedClients.size;
    
    // Clean up old connection tracking data
    setTimeout(() => {
      const cleanupTime = Date.now() - 30000; // 30 seconds
      for (const [ip, times] of connectionTracker.entries()) {
        const recent = times.filter(time => time > cleanupTime);
        if (recent.length === 0) {
          connectionTracker.delete(ip);
        } else {
          connectionTracker.set(ip, recent);
        }
      }
    }, 5000);
  });

  socket.on('connect_error', (error) => {
    console.error(`❌ Connection error for ${clientId}:`, error);
  });

  // Real-time cursor tracking
  socket.on('cursor_update', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      const { sessionId, userId, userName, userColor, position, selection, filePath, fileName, timestamp } = data;
      
      // Validate session
      if (sessionId !== socket.sessionId) {
        return;
      }

      console.log(`👆 Cursor update from ${socket.userName}: ${fileName} at ${position?.lineNumber}:${position?.column}`);
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('cursor_update', {
        sessionId: socket.sessionId,
        userId: socket.userId,
        userName: socket.userName,
        userColor,
        position,
        selection,
        filePath,
        fileName,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error handling cursor update from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to process cursor update');
    }
  });

  // File activity tracking (when users switch files)
  socket.on('file_activity_update', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      const { sessionId, userId, userName, userColor, filePath, fileName, timestamp } = data;
      
      // Validate session
      if (sessionId !== socket.sessionId) {
        return;
      }

      console.log(`📁 File activity from ${socket.userName}: editing ${fileName}`);
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('file_activity_update', {
        sessionId: socket.sessionId,
        userId: socket.userId,
        userName: socket.userName,
        userColor,
        filePath,
        fileName,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error handling file activity update from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to process file activity update');
    }
  });

  // Handle code changes with session isolation
  socket.on('code_change', (newCode) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check user permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canEdit) {
        socket.emit('error', 'You do not have permission to edit in this session');
        return;
      }

      if (typeof newCode === 'string' && newCode.length < 1000000) { // 1MB limit
        session.currentCode = newCode;
        
        // Broadcast to other users in the same session only
        socket.to(socket.sessionId).emit('code_update', {
          code: newCode,
          updatedBy: {
            userId: socket.userId,
            userName: userName,
            userEmail: userEmail
          },
          sessionId: socket.sessionId,
          timestamp: Date.now()
        });
        
        console.log(`✏️ Code updated by ${userName} in session ${socket.sessionId} (${newCode.length} chars)`);
      } else {
        console.warn(`Invalid code change from ${userName} (${clientId})`);
        socket.emit('error', 'Invalid code format or size');
      }
    } catch (error) {
      console.error(`Error handling code change from ${userName} (${clientId}):`, error);
      socket.emit('error', 'Failed to process code change');
    }
  });
  // Real-time code synchronization
  socket.on('realtime_code_change', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check user permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canEdit) {
        socket.emit('error', 'You do not have permission to edit in this session');
        return;
      }

      const { filePath, content, sessionId } = data;
      
      // Validate data
      if (!filePath || typeof content !== 'string') {
        socket.emit('error', 'Invalid code change data');
        return;
      }

      // Update session file store
      if (session.files.has(filePath)) {
        session.files.set(filePath, {
          ...session.files.get(filePath),
          content: content,
          lastModified: Date.now(),
          lastEditedBy: socket.userId
        });
      } else {
        // Create new file entry
        session.files.set(filePath, {
          content: content,
          type: 'file',
          lastModified: Date.now(),
          createdBy: socket.userId,
          lastEditedBy: socket.userId
        });
      }

      // Also update global virtual file store
      virtualFileStore.set(filePath, {
        content: content,
        type: 'file',
        lastModified: Date.now(),
        createdBy: socket.userEmail,
        sessionId: socket.sessionId
      });

      console.log(`📝 Real-time code update by ${socket.userName}: ${filePath} (${content.length} chars) in session ${socket.sessionId}`);
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('realtime_code_update', {
        filePath: filePath,
        content: content,
        userId: socket.userId,
        userName: socket.userName,
        sessionId: socket.sessionId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error handling real-time code change from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to process code change');
    }
  });

  // File operations (create, delete, rename, save)
  socket.on('file_operation', (operation) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check user permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canEdit) {
        socket.emit('error', 'You do not have permission to edit files in this session');
        return;
      }

      const { action, path: filePath, data } = operation;
      
      // Validate file path
      if (typeof filePath !== 'string' || filePath.includes('..') || filePath.length > 500) {
        socket.emit('error', 'Invalid file path');
        return;
      }

      console.log(`📁 File operation by ${socket.userName}: ${action} - ${filePath} in session ${socket.sessionId}`);
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('file_operation', {
        ...operation,
        sessionId: socket.sessionId,
        userId: socket.userId,
        userName: socket.userName,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`Error handling file operation from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to process file operation');
    }
  });

  // Get session files state
  socket.on('get_session_files', () => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Convert session files to array format
      const sessionFiles = Array.from(session.files.entries()).map(([path, data]) => ({
        path,
        content: data.content || '',
        type: data.type || 'file',
        lastModified: data.lastModified || Date.now(),
        createdBy: data.createdBy,
        lastEditedBy: data.lastEditedBy
      }));

      console.log(`📡 Sending session files state to ${socket.userName}: ${sessionFiles.length} files`);
      socket.emit('session_files_state', sessionFiles);
    } catch (error) {
      console.error(`Error getting session files for ${socket.userName}:`, error);
      socket.emit('error', 'Failed to get session files');
    }
  });
  // OLD VIRTUAL FS HANDLER - REPLACED BY NEW REAL-TIME SYSTEM
  /*
  socket.on('virtual_fs_operation', async (operation) => {
    // This handler has been replaced by the new real-time synchronization system
    // Using 'realtime_code_change' and 'file_operation' events instead
    console.log('⚠️ Received deprecated virtual_fs_operation event. Please update client.');
  });
  */

  // Handle chat messages with session isolation
  socket.on('chat_message', (messageData) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check user permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canChat) {
        socket.emit('error', 'You do not have permission to chat in this session');
        return;
      }

      const message = {
        id: Date.now().toString(),
        content: messageData.content,
        userId: socket.userId,
        userName: socket.userName,
        userAvatar: socket.userAvatar,
        sessionId: socket.sessionId,
        timestamp: Date.now(),
        type: messageData.type || 'text'
      };

      // Add to session chat history
      session.chatHistory.push(message);

      // Broadcast to all users in the session
      io.to(socket.sessionId).emit('chat_message', message);

      console.log(`💬 Chat message in session ${socket.sessionId} from ${socket.userName}: ${message.content.substring(0, 50)}...`);
    } catch (error) {
      console.error(`Error handling chat message from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to send chat message');
    }
  });

  // Code execution with session isolation
  socket.on('execute_code', async (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check user permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canExecute) {
        socket.emit('error', 'You do not have permission to execute code in this session');
        return;
      }

      const { code, language, input = '' } = data;
      console.log(`🚀 Code execution request from ${clientId} in session ${socket.sessionId}: ${language}`);
      
      // Broadcast execution start to session users only
      io.to(socket.sessionId).emit('execution_started', {
        clientId,
        language,
        sessionId: socket.sessionId,
        userName: socket.userName,
        timestamp: Date.now()
      });

      const pistonConfig = languageMap[language.toLowerCase()];
      if (!pistonConfig) {
        const errorResult = {
          error: `Unsupported language: ${language}`,
          sessionId: socket.sessionId
        };
        socket.emit('execution_error', errorResult);
        io.to(socket.sessionId).emit('execution_error', errorResult);
        return;
      }

      const executionRequest = {
        language: pistonConfig.language,
        version: pistonConfig.version,
        files: [
          {
            name: getFileName(language),
            content: code
          }
        ],
        stdin: input,
        compile_timeout: 10000,
        run_timeout: 3000,
        compile_memory_limit: -1,
        run_memory_limit: -1
      };

      const response = await axios.post(`${PISTON_API_URL}/execute`, executionRequest, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = response.data;
      
      const executionResult = {
        success: true,
        language: language,
        version: pistonConfig.version,
        compile: result.compile || { stdout: '', stderr: '', code: 0 },
        run: result.run || { stdout: '', stderr: '', code: 0 },
        output: result.run?.stdout || '',
        error: result.run?.stderr || result.compile?.stderr || '',
        exitCode: result.run?.code ?? result.compile?.code ?? 0,
        executionTime: Date.now(),
        sessionId: socket.sessionId,
        clientId,
        userName: socket.userName
      };

      // Broadcast result to session users only
      io.to(socket.sessionId).emit('execution_result', executionResult);
      console.log(`✅ Code execution completed for ${clientId} in session ${socket.sessionId}: ${language}`);

    } catch (error) {
      console.error(`❌ Code execution error for ${clientId}:`, error.message);
      
      const errorResult = {
        success: false,
        error: error.code === 'ECONNABORTED' ? 'Execution timed out' : 'Execution failed',
        details: error.message,
        sessionId: socket.sessionId,
        clientId,
        userName: socket.userName
      };
      
      // Broadcast error to session users only
      io.to(socket.sessionId).emit('execution_error', errorResult);
    }
  });
  // Session-specific file operations
  socket.on('create_file', async (data) => {
    if (!socket.sessionId) {
      socket.emit('error', 'Not connected to any session');
      return;
    }

    const { name, content = '' } = data;
    console.log(`📄 Create file from ${socket.userName || socket.userEmail}: ${name} in session ${socket.sessionId}`);

    try {
      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canEdit) {
        socket.emit('error', 'You do not have permission to create files in this session');
        return;
      }

      const filePath = `${socket.sessionId}/${name}`;
      
      // Create in session file system
      session.files.set(filePath, {
        content,
        type: 'text/plain',
        size: content.length,
        createdBy: socket.id,
        createdAt: new Date().toISOString()
      });

      // Also add to global virtual file store
      virtualFileStore.set(filePath, {
        content,
        type: 'text/plain',
        size: content.length,
        createdBy: socket.id,
        createdAt: new Date().toISOString(),
        sessionId: socket.sessionId
      });

      // Save to database if authenticated
      if (socket.authenticated) {
        let user;
        if (socket.tokenType === 'firebase') {
          user = Array.from(users.values()).find(u => u.id === socket.userId || u.email === socket.userEmail);
        } else {
          user = users.get(socket.userEmail);
        }

        if (user) {
          const fileData = {
            name: name,
            path: filePath,
            content: content,
            type: 'file',
            projectId: socket.sessionId,
            authorName: user.name
          };

          await databaseService.createFile(fileData, user.id);
          console.log(`📄 File saved to database: ${name} by ${user.name} in session ${socket.sessionId}`);
        }
      }

      // Broadcast to session users
      io.to(socket.sessionId).emit('file_created', {
        name,
        path: filePath,
        sessionId: socket.sessionId,
        createdBy: socket.userName || socket.userEmail
      });
    } catch (error) {
      console.error(`Error creating file for ${socket.userName}:`, error);
      socket.emit('error', 'Failed to create file');
    }
  });

  socket.on('create_folder', async (data) => {
    if (!socket.sessionId) {
      socket.emit('error', 'Not connected to any session');
      return;
    }

    const { name } = data;
    console.log(`� Create folder from ${socket.userName || socket.userEmail}: ${name} in session ${socket.sessionId}`);

    try {
      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Check permissions
      const userPermissions = session.userPermissions.get(socket.userId);
      if (!userPermissions || !userPermissions.canEdit) {
        socket.emit('error', 'You do not have permission to create folders in this session');
        return;
      }

      const folderPath = `${socket.sessionId}/${name}/`;
      
      // Create in session file system
      session.files.set(folderPath, {
        type: 'directory',
        createdBy: socket.id,
        createdAt: new Date().toISOString()
      });

      // Also add to global virtual file store
      virtualFileStore.set(folderPath, {
        type: 'directory',
        createdBy: socket.id,
        createdAt: new Date().toISOString(),
        sessionId: socket.sessionId
      });

      // Save to database if authenticated
      if (socket.authenticated) {
        let user;
        if (socket.tokenType === 'firebase') {
          user = Array.from(users.values()).find(u => u.id === socket.userId || u.email === socket.userEmail);
        } else {
          user = users.get(socket.userEmail);
        }

        if (user) {
          const folderData = {
            name: name,
            path: folderPath,
            type: 'folder',
            projectId: socket.sessionId,
            authorName: user.name
          };

          await databaseService.createFile(folderData, user.id);
          console.log(`📁 Folder saved to database: ${name} by ${user.name} in session ${socket.sessionId}`);
        }
      }

      // Broadcast to session users
      io.to(socket.sessionId).emit('folder_created', {
        name,
        path: folderPath,
        sessionId: socket.sessionId,
        createdBy: socket.userName || socket.userEmail
      });
    } catch (error) {
      console.error(`Error creating folder for ${socket.userName}:`, error);
      socket.emit('error', 'Failed to create folder');
    }
  });

  // Performance monitoring (session-aware)
  socket.on('start_performance_monitoring', (data) => {
    if (!socket.sessionId) {
      socket.emit('error', 'Not connected to any session');
      return;
    }

    console.log(`� Starting performance monitoring for ${socket.id} in session ${socket.sessionId}`);

    if (!monitoringInterval) {
      monitoringInterval = setInterval(() => {
        updatePerformanceMetrics();
        // Send metrics only to users in sessions
        for (const [sessionId, session] of collaborationSessions.entries()) {
          io.to(sessionId).emit('performance_metrics', {
            ...performanceMetrics,
            sessionId: sessionId,
            sessionUsers: session.connectedUsers.size
          });
        }
      }, 2000); // Update every 2 seconds
    }

    socket.emit('monitoring_started', { sessionId: socket.sessionId });
  });

  socket.on('stop_performance_monitoring', (data) => {
    console.log(`📊 Stopping performance monitoring for ${socket.id}`);
    socket.emit('monitoring_stopped', { sessionId: socket.sessionId });
  });

  // Handle session management commands
  socket.on('get_session_users', () => {
    if (!socket.sessionId) {
      socket.emit('error', 'Not connected to any session');
      return;
    }

    const session = collaborationSessions.get(socket.sessionId);
    if (session) {
      const sessionUsers = Array.from(session.connectedUsers).map(userId => {
        // Find user info for each connected user
        const user = Array.from(users.values()).find(u => u.id === userId);
        return user ? {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          permissions: session.userPermissions.get(userId)
        } : null;
      }).filter(Boolean);

      socket.emit('session_users', {
        sessionId: socket.sessionId,
        users: sessionUsers,
        totalUsers: session.connectedUsers.size
      });
    }
  });

  socket.on('get_session_info', () => {
    if (!socket.sessionId) {
      socket.emit('error', 'Not connected to any session');
      return;
    }

    const session = collaborationSessions.get(socket.sessionId);
    if (session) {
      socket.emit('session_info', {
        id: session.id,
        name: session.name,
        creatorId: session.creatorId,
        inviteKey: session.inviteKey,  // Include invite key for all session members
        createdAt: session.createdAt,
        settings: session.settings,
        userCount: session.connectedUsers.size,
        fileCount: session.files.size,
        chatCount: session.chatHistory.length,
        userPermissions: session.userPermissions.get(socket.userId)
      });
    }
  });

  socket.on('update_user_permissions', async (data) => {
    if (!socket.sessionId) {
      socket.emit('error', 'Not connected to any session');
      return;
    }

    const session = collaborationSessions.get(socket.sessionId);
    if (!session) {
      socket.emit('error', 'Session not found');
      return;
    }

    // Only session creator can update permissions
    if (session.creatorId !== socket.userId) {
      socket.emit('error', 'Only session creator can update user permissions');
      return;
    }

    const { userId, permissions } = data;
    if (session.connectedUsers.has(userId)) {
      session.userPermissions.set(userId, permissions);
      
      // Notify the user about permission changes
      io.to(socket.sessionId).emit('permissions_updated', {
        userId: userId,
        permissions: permissions,
        updatedBy: socket.userName
      });

      console.log(`� Permissions updated for user ${userId} in session ${socket.sessionId} by ${socket.userName}`);
    } else {
      socket.emit('error', 'User not found in session');
    }
  });

  // Project sharing events
  socket.on('project_share_init', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Only session creator can initiate project sharing
      if (session.creatorId !== socket.userId) {
        socket.emit('error', 'Only session creator can share projects');
        return;
      }

      const { mode, projectData, ownerId } = data;
      
      console.log(`📁 Project sharing initiated by ${socket.userName}: ${mode} - ${projectData.name}`);
      
      // Store project data in session
      session.projectMode = mode;
      session.projectData = projectData;
      session.projectOwner = ownerId;
      
      // Broadcast to all users in the session
      io.to(socket.sessionId).emit('project_share_init', {
        sessionId: socket.sessionId,
        mode,
        projectData,
        ownerId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error handling project share init from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to initialize project sharing');
    }
  });

  socket.on('project_create_init', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Only session creator can create new projects
      if (session.creatorId !== socket.userId) {
        socket.emit('error', 'Only session creator can create new projects');
        return;
      }

      const { mode, template, projectData, ownerId } = data;
      
      console.log(`🚀 New project creation by ${socket.userName}: ${template} - ${projectData.name}`);
      
      // Store project data in session
      session.projectMode = mode;
      session.projectTemplate = template;
      session.projectData = projectData;
      session.projectOwner = ownerId;
      
      // Load project structure into session files if provided
      if (projectData.structure && Array.isArray(projectData.structure)) {
        projectData.structure.forEach(([path, metadata]) => {
          if (metadata.type === 'file') {
            session.files.set(path, {
              content: metadata.content || '',
              type: 'file',
              lastModified: Date.now(),
              createdBy: ownerId,
              lastEditedBy: ownerId
            });
          }
        });
      }
      
      // Broadcast to all users in the session
      io.to(socket.sessionId).emit('project_create_init', {
        sessionId: socket.sessionId,
        mode,
        template,
        projectData,
        ownerId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error handling project create init from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to initialize project creation');
    }
  });

  socket.on('access_rights_update', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      // Only project owner can update access rights
      if (session.projectOwner !== socket.userId) {
        socket.emit('error', 'Only project owner can update access rights');
        return;
      }

      const { userId, accessLevel, updatedBy } = data;
      
      console.log(`🔐 Access rights update by ${socket.userName}: ${userId} -> ${accessLevel}`);
      
      // Update user permissions in session
      const userPermissions = session.userPermissions.get(userId);
      if (userPermissions) {
        userPermissions.projectAccessLevel = accessLevel;
        
        // Update editing permissions based on access level
        userPermissions.canEdit = ['owner', 'editor'].includes(accessLevel);
        userPermissions.canExecute = ['owner', 'editor'].includes(accessLevel);
        
        session.userPermissions.set(userId, userPermissions);
      }
      
      // Broadcast to all users in the session
      io.to(socket.sessionId).emit('access_rights_update', {
        sessionId: socket.sessionId,
        userId,
        accessLevel,
        updatedBy,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error handling access rights update from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to update access rights');
    }
  });

  socket.on('file_activity_broadcast', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      const { filePath, activity } = data;
      
      console.log(`📝 File activity broadcast by ${socket.userName}: ${activity} on ${filePath}`);
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('file_activity', {
        sessionId: socket.sessionId,
        filePath,
        userId: socket.userId,
        userName: socket.userName,
        activity,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error handling file activity broadcast from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to broadcast file activity');
    }
  });

  socket.on('cursor_position_broadcast', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      const { filePath, position, selection } = data;
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('cursor_position', {
        sessionId: socket.sessionId,
        filePath,
        userId: socket.userId,
        position,
        selection,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error handling cursor position broadcast from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to broadcast cursor position');
    }
  });

  socket.on('user_presence_update', (data) => {
    try {
      if (!socket.sessionId) {
        socket.emit('error', 'Not connected to any session');
        return;
      }

      const session = collaborationSessions.get(socket.sessionId);
      if (!session) {
        socket.emit('error', 'Session not found');
        return;
      }

      const { presence } = data;
      
      // Broadcast to other users in the same session
      socket.to(socket.sessionId).emit('user_presence', {
        sessionId: socket.sessionId,
        userId: socket.userId,
        presence,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error(`Error handling user presence update from ${socket.userName}:`, error);
      socket.emit('error', 'Failed to update user presence');
    }
  });

  console.log(`✅ Socket event handlers registered for ${userName} (${clientId})`);
});

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

// Start the server on port 3001
const PORT = process.env.PORT || 3001;

function startServer(port) {
  const serverInstance = server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Server running on http://localhost:${port}`);
    console.log(`🌐 Open your browser and navigate to http://localhost:${port}`);
    console.log(`📡 For network sharing, use your local IP address instead of localhost`);
    console.log(`ℹ️  Run network-info.bat to see your network details`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`❌ Port ${port} is already in use. Trying port ${port + 1}...`);
      if (port < 3010) { // Prevent infinite loops
        startServer(port + 1);
      } else {
        console.error('❌ Unable to find an available port. Please close other applications using ports 3001-3010.');
        process.exit(1);
      }
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);

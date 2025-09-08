# Development Guide

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   cd client && npm install
   cd ../server && npm install
   cd ..
   ```

2. **Set up environment:**
   ```bash
   cp server/.env.example server/.env
   # Edit server/.env with your configuration
   ```

3. **Start development servers:**
   ```bash
   npm run dev
   ```

## 🏗️ Architecture Overview

### Frontend (React)
- **Port**: 3000
- **Main Components**: Located in `client/src/components/`
- **Contexts**: React contexts for state management
- **Styles**: Modern CSS with VS Code theme

### Backend (Node.js)
- **Port**: 3001
- **API Routes**: RESTful APIs in `server/routes/`
- **Socket.IO**: Real-time communication
- **Database**: SQLite with custom service layer

### Database
- **Type**: SQLite
- **Location**: `database/codecollab.db`
- **Models**: User management and session data

## 📁 Key Directories

```
client/src/
├── components/           # React components
│   ├── auth/            # Authentication components
│   ├── collaboration/   # Real-time collaboration features
│   ├── editor/          # Code editor components
│   └── ui/              # UI components
├── contexts/            # React contexts
├── services/            # API services
├── styles/              # CSS stylesheets
└── utils/               # Utility functions

server/
├── models/              # Database models
├── routes/              # Express routes
└── services/            # Business logic
```

## 🎨 Styling System

### Theme Files
- **vscode-theme.css**: Core VS Code-inspired styling
- **ui-fixes.css**: UI improvements and bug fixes
- **collaboration-features.css**: Real-time collaboration UI
- **terminal-panel.css**: Terminal panel styling

### CSS Variables
The theme system uses CSS custom properties for consistency:
```css
:root {
  --primary-color: #007acc;
  --secondary-color: #1e1e1e;
  --text-primary: #cccccc;
  --text-secondary: #969696;
}
```

## 🔧 Development Scripts

### Root Level
- `npm run dev`: Start both client and server
- `npm run start`: Start server only
- `npm run client`: Start client only

### Client Scripts
- `npm start`: Start development server
- `npm build`: Build for production
- `npm test`: Run tests

### Server Scripts
- `npm start`: Start with nodemon
- `npm run dev`: Development mode

## 🌐 API Endpoints

### Authentication
- `POST /api/auth/login`: User login
- `POST /api/auth/register`: User registration
- `POST /api/auth/logout`: User logout

### Sessions
- `GET /api/sessions`: Get user sessions
- `POST /api/sessions`: Create new session
- `PUT /api/sessions/:id`: Update session
- `DELETE /api/sessions/:id`: Delete session

## 🔌 Socket.IO Events

### Collaboration
- `join_session`: Join a coding session
- `leave_session`: Leave a coding session
- `code_update`: Real-time code synchronization
- `cursor_position`: Live cursor tracking
- `typing_start/stop`: Typing indicators

### Chat
- `chat_message`: Send/receive chat messages
- `user_joined/left`: User presence updates

## 🐛 Debugging

### Client Debugging
1. Open browser developer tools
2. Check React DevTools for component state
3. Monitor network tab for API calls
4. Check console for errors

### Server Debugging
1. Check terminal output for server logs
2. Use `console.log()` for debugging
3. Monitor database queries
4. Check Socket.IO connection status

## 🧪 Testing

### Manual Testing
1. Open multiple browser windows/tabs
2. Test real-time collaboration features
3. Verify authentication flows
4. Test responsive design

### Automated Testing
```bash
cd client
npm test
```

## 🚀 Deployment

### Development
- Client: `http://localhost:3000`
- Server: `http://localhost:3001`

### Production Build
```bash
cd client
npm run build
```

## 🔐 Environment Variables

### Required Variables
```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database
DATABASE_PATH=../database/codecollab.db

# Firebase (Optional)
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_domain
FIREBASE_PROJECT_ID=your_project_id
```

## 📈 Performance Tips

1. **Bundle Size**: Monitor client build size
2. **Socket.IO**: Throttle frequent events (cursor positions)
3. **Database**: Use efficient queries
4. **Memory**: Monitor for memory leaks in long sessions
5. **Network**: Optimize real-time data transfer

## 🤝 Contributing Guidelines

1. Follow existing code style
2. Add comments for complex logic
3. Test real-time features thoroughly
4. Update documentation for new features
5. Use meaningful commit messages

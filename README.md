# CodeCollab - Real-time Collaborative Code Editor

A modern, VS Code-inspired collaborative code editor built with React and Node.js, featuring real-time collaboration, live cursors, and team management.

## 🚀 Features

- **Real-time Collaboration**: Live cursor tracking, typing indicators, and synchronized editing
- **VS Code-inspired Interface**: Modern, professional UI with split-screen editing
- **Team Management**: Role-based permissions and user management
- **File Management**: Advanced file explorer with drag & drop support
- **Live Chat**: Real-time communication between collaborators
- **Session Management**: Create, join, and manage coding sessions
- **Authentication**: Secure user authentication and authorization
- **Code Execution**: Integrated terminal for running code
- **Responsive Design**: Works on desktop and mobile devices

## 🛠️ Tech Stack

- **Frontend**: React 18, Socket.IO Client, Monaco Editor
- **Backend**: Node.js, Express, Socket.IO
- **Database**: SQLite with custom database service
- **Authentication**: Firebase Authentication
- **Styling**: CSS3 with modern design system

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd CodeCollab
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd client && npm install
   cd ../server && npm install
   ```

3. **Set up environment variables**
   - Copy `server/.env.example` to `server/.env`
   - Add your Firebase configuration

4. **Start the application**
   ```bash
   npm run dev
   ```

## 🏗️ Project Structure

```
CodeCollab/
├── client/                 # React frontend
│   ├── public/            # Static assets
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── contexts/      # React contexts
│   │   ├── services/      # API services
│   │   ├── styles/        # CSS stylesheets
│   │   └── utils/         # Utility functions
│   └── package.json
├── server/                # Node.js backend
│   ├── models/           # Database models
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   └── package.json
├── database/             # Database files and migrations
└── package.json         # Root package.json
```

## 🎨 Themes

The application includes modern themes located in `client/src/styles/`:

- **vscode-theme.css**: Main VS Code-inspired theme
- **ui-fixes.css**: UI improvements and fixes
- **collaboration-features.css**: Real-time collaboration styling
- **terminal-panel.css**: Terminal panel styling

## 🚀 Available Scripts

- `npm run dev`: Start both client and server in development mode
- `npm run start`: Start the server only
- `npm run client`: Start the client only

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the `server/` directory:

```env
PORT=3001
NODE_ENV=development
DATABASE_PATH=../database/codecollab.db
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
```

## 📝 Usage

1. **Start the application** using `npm run dev`
2. **Open your browser** to `http://localhost:3000`
3. **Sign up or login** to create an account
4. **Create or join a session** to start collaborating
5. **Invite team members** and start coding together!

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Inspired by VS Code and Figma's collaborative features
- Built with modern web technologies and best practices
- Thanks to the open-source community for amazing tools and libraries

// CodeCollab Database Migration and Setup Script
// This script handles both Firebase and PostgreSQL database setup

const admin = require('firebase-admin');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const config = {
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  },
  postgres: {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  }
};

// Initialize Firebase Admin
let db, auth, storage;
if (config.firebase.projectId && config.firebase.privateKey && config.firebase.clientEmail) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.firebase.projectId,
        privateKey: config.firebase.privateKey,
        clientEmail: config.firebase.clientEmail
      }),
      databaseURL: `https://${config.firebase.projectId}-default-rtdb.firebaseio.com`,
      storageBucket: `${config.firebase.projectId}.appspot.com`
    });
    
    db = admin.firestore();
    auth = admin.auth();
    storage = admin.storage();
    console.log('✅ Firebase Admin SDK initialized');
  } catch (error) {
    console.warn('⚠️ Firebase initialization failed:', error.message);
  }
}

// Initialize PostgreSQL
let pgPool;
if (config.postgres.connectionString) {
  try {
    pgPool = new Pool(config.postgres);
    console.log('✅ PostgreSQL connection pool created');
  } catch (error) {
    console.warn('⚠️ PostgreSQL initialization failed:', error.message);
  }
}

// Database Schema Definitions
const firebaseCollections = {
  users: {
    fields: [
      'uid', 'email', 'displayName', 'photoURL', 'emailVerified',
      'createdAt', 'updatedAt', 'lastLoginAt', 'isOnline',
      'profile', 'preferences', 'collaborationSettings'
    ],
    indexes: [
      { fields: ['email'] },
      { fields: ['createdAt'] },
      { fields: ['isOnline'] }
    ]
  },
  projects: {
    fields: [
      'id', 'name', 'description', 'ownerId', 'ownerName',
      'visibility', 'language', 'collaborators', 'fileCount',
      'createdAt', 'updatedAt', 'lastActivity', 'tags', 'settings'
    ],
    indexes: [
      { fields: ['ownerId'] },
      { fields: ['visibility'] },
      { fields: ['createdAt'] },
      { fields: ['updatedAt'] },
      { fields: ['collaborators'], arrayContains: true }
    ]
  },
  files: {
    fields: [
      'id', 'projectId', 'name', 'path', 'content', 'size',
      'type', 'isDirectory', 'parentId', 'authorId', 'authorName',
      'createdAt', 'updatedAt', 'lastModified', 'permissions',
      'tags', 'starred', 'checksum'
    ],
    indexes: [
      { fields: ['projectId'] },
      { fields: ['authorId'] },
      { fields: ['parentId'] },
      { fields: ['isDirectory'] },
      { fields: ['updatedAt'] }
    ]
  },
  fileVersions: {
    fields: [
      'id', 'fileId', 'version', 'content', 'changes',
      'authorId', 'authorName', 'timestamp', 'comment',
      'linesAdded', 'linesRemoved', 'checksum'
    ],
    indexes: [
      { fields: ['fileId'] },
      { fields: ['authorId'] },
      { fields: ['timestamp'] },
      { fields: ['version'] }
    ]
  },
  activities: {
    fields: [
      'id', 'projectId', 'userId', 'userName', 'type', 'action',
      'target', 'details', 'timestamp', 'metadata'
    ],
    indexes: [
      { fields: ['projectId'] },
      { fields: ['userId'] },
      { fields: ['type'] },
      { fields: ['timestamp'] }
    ]
  },
  chatMessages: {
    fields: [
      'id', 'projectId', 'userId', 'userName', 'userAvatar',
      'content', 'type', 'timestamp', 'edited', 'editedAt',
      'reactions', 'replyTo', 'attachments', 'channel'
    ],
    indexes: [
      { fields: ['projectId'] },
      { fields: ['userId'] },
      { fields: ['timestamp'] },
      { fields: ['channel'] }
    ]
  },
  collaborationSessions: {
    fields: [
      'id', 'projectId', 'participants', 'createdAt',
      'updatedAt', 'endedAt', 'isActive', 'metadata'
    ],
    indexes: [
      { fields: ['projectId'] },
      { fields: ['isActive'] },
      { fields: ['createdAt'] }
    ]
  }
};

const postgresSchema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(128) UNIQUE,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  photo_url TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  is_online BOOLEAN DEFAULT FALSE,
  profile JSONB DEFAULT '{}',
  preferences JSONB DEFAULT '{}',
  collaboration_settings JSONB DEFAULT '{}'
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  owner_name VARCHAR(255),
  visibility VARCHAR(50) DEFAULT 'private',
  language VARCHAR(50),
  collaborators JSONB DEFAULT '[]',
  file_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity TEXT,
  tags TEXT[],
  settings JSONB DEFAULT '{}'
);

-- Files table
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  path TEXT,
  content TEXT,
  size BIGINT DEFAULT 0,
  type VARCHAR(100),
  is_directory BOOLEAN DEFAULT FALSE,
  parent_id UUID REFERENCES files(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  author_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_modified TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  permissions JSONB DEFAULT '{"read": true, "write": true, "share": true}',
  tags TEXT[],
  starred BOOLEAN DEFAULT FALSE,
  checksum VARCHAR(64)
);

-- File versions table
CREATE TABLE IF NOT EXISTS file_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT,
  changes JSONB DEFAULT '{}',
  author_id UUID REFERENCES users(id),
  author_name VARCHAR(255),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  comment TEXT,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,
  checksum VARCHAR(64),
  UNIQUE(file_id, version)
);

-- Activities table
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  user_name VARCHAR(255),
  type VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target VARCHAR(255),
  details JSONB DEFAULT '{}',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  user_name VARCHAR(255),
  user_avatar VARCHAR(255),
  content TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'message',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP WITH TIME ZONE,
  reactions JSONB DEFAULT '[]',
  reply_to UUID REFERENCES chat_messages(id),
  attachments JSONB DEFAULT '[]',
  channel VARCHAR(100) DEFAULT 'general'
);

-- Collaboration sessions table
CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  participants JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);

CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_author_id ON files(author_id);
CREATE INDEX IF NOT EXISTS idx_files_is_directory ON files(is_directory);
CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at);

CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_author_id ON file_versions(author_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_timestamp ON file_versions(timestamp);

CREATE INDEX IF NOT EXISTS idx_activities_project_id ON activities(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp);

CREATE INDEX IF NOT EXISTS idx_chat_messages_project_id ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel);

CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_project_id ON collaboration_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_is_active ON collaboration_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_created_at ON collaboration_sessions(created_at);

-- Update triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_collaboration_sessions_updated_at BEFORE UPDATE ON collaboration_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// Migration functions
class DatabaseMigration {
  constructor() {
    this.firebase = { db, auth, storage };
    this.postgres = pgPool;
  }

  async runFirebaseMigration() {
    if (!this.firebase.db) {
      console.log('⚠️ Firebase not available, skipping Firebase migration');
      return;
    }

    console.log('🔄 Running Firebase migration...');

    try {
      // Create collections and indexes
      for (const [collectionName, schema] of Object.entries(firebaseCollections)) {
        console.log(`📁 Setting up collection: ${collectionName}`);
        
        // Create a sample document to initialize collection
        const sampleDoc = {};
        schema.fields.forEach(field => {
          sampleDoc[field] = null;
        });
        
        await this.firebase.db.collection(collectionName).doc('_init').set({
          ...sampleDoc,
          _isInitDoc: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Note: Firestore indexes should be created through Firebase Console
        // or using firebase deploy --only firestore:indexes
        console.log(`✅ Collection ${collectionName} initialized`);
      }

      // Clean up init documents
      for (const collectionName of Object.keys(firebaseCollections)) {
        await this.firebase.db.collection(collectionName).doc('_init').delete();
      }

      console.log('✅ Firebase migration completed');
    } catch (error) {
      console.error('❌ Firebase migration failed:', error);
      throw error;
    }
  }

  async runPostgresMigration() {
    if (!this.postgres) {
      console.log('⚠️ PostgreSQL not available, skipping PostgreSQL migration');
      return;
    }

    console.log('🔄 Running PostgreSQL migration...');

    try {
      await this.postgres.query(postgresSchema);
      console.log('✅ PostgreSQL migration completed');
    } catch (error) {
      console.error('❌ PostgreSQL migration failed:', error);
      throw error;
    }
  }

  async seedSampleData() {
    console.log('🌱 Seeding sample data...');

    const sampleData = {
      users: [
        {
          id: 'user1',
          email: 'admin@codecollab.dev',
          displayName: 'Admin User',
          emailVerified: true,
          isOnline: false,
          profile: {
            bio: 'System Administrator',
            location: 'Global',
            website: 'https://codecollab.dev'
          },
          preferences: {
            theme: 'dark',
            language: 'en',
            notifications: true
          },
          collaborationSettings: {
            defaultProjectVisibility: 'private',
            allowPublicProfile: false,
            showOnlineStatus: true
          }
        }
      ],
      projects: [
        {
          id: 'sample-project-1',
          name: 'Sample React App',
          description: 'A sample React application for demonstration',
          ownerId: 'user1',
          ownerName: 'Admin User',
          visibility: 'public',
          language: 'javascript',
          collaborators: ['user1'],
          fileCount: 3,
          lastActivity: 'Project created',
          tags: ['react', 'javascript', 'demo']
        }
      ],
      files: [
        {
          id: 'file1',
          projectId: 'sample-project-1',
          name: 'App.js',
          content: `import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Welcome to CodeCollab</h1>
        <p>Real-time collaborative code editor</p>
      </header>
    </div>
  );
}

export default App;`,
          size: 234,
          type: 'application/javascript',
          isDirectory: false,
          authorId: 'user1',
          authorName: 'Admin User',
          permissions: { read: true, write: true, share: true }
        },
        {
          id: 'file2',
          projectId: 'sample-project-1',
          name: 'App.css',
          content: `.App {
  text-align: center;
}

.App-header {
  background-color: #282c34;
  padding: 20px;
  color: white;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}`,
          size: 187,
          type: 'text/css',
          isDirectory: false,
          authorId: 'user1',
          authorName: 'Admin User',
          permissions: { read: true, write: true, share: true }
        }
      ]
    };

    // Seed Firebase
    if (this.firebase.db) {
      try {
        for (const [collection, documents] of Object.entries(sampleData)) {
          for (const doc of documents) {
            await this.firebase.db.collection(collection).doc(doc.id).set({
              ...doc,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
          console.log(`✅ Seeded ${documents.length} documents in ${collection}`);
        }
      } catch (error) {
        console.error('❌ Firebase seeding failed:', error);
      }
    }

    // Seed PostgreSQL
    if (this.postgres) {
      try {
        // Insert sample user
        await this.postgres.query(`
          INSERT INTO users (id, email, display_name, email_verified, is_online, profile, preferences, collaboration_settings)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (email) DO NOTHING
        `, [
          sampleData.users[0].id,
          sampleData.users[0].email,
          sampleData.users[0].displayName,
          sampleData.users[0].emailVerified,
          sampleData.users[0].isOnline,
          JSON.stringify(sampleData.users[0].profile),
          JSON.stringify(sampleData.users[0].preferences),
          JSON.stringify(sampleData.users[0].collaborationSettings)
        ]);

        // Insert sample project
        await this.postgres.query(`
          INSERT INTO projects (id, name, description, owner_id, owner_name, visibility, language, collaborators, file_count, last_activity, tags)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING
        `, [
          sampleData.projects[0].id,
          sampleData.projects[0].name,
          sampleData.projects[0].description,
          sampleData.projects[0].ownerId,
          sampleData.projects[0].ownerName,
          sampleData.projects[0].visibility,
          sampleData.projects[0].language,
          JSON.stringify(sampleData.projects[0].collaborators),
          sampleData.projects[0].fileCount,
          sampleData.projects[0].lastActivity,
          sampleData.projects[0].tags
        ]);

        // Insert sample files
        for (const file of sampleData.files) {
          await this.postgres.query(`
            INSERT INTO files (id, project_id, name, content, size, type, is_directory, author_id, author_name, permissions)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
          `, [
            file.id,
            file.projectId,
            file.name,
            file.content,
            file.size,
            file.type,
            file.isDirectory,
            file.authorId,
            file.authorName,
            JSON.stringify(file.permissions)
          ]);
        }

        console.log('✅ PostgreSQL seeding completed');
      } catch (error) {
        console.error('❌ PostgreSQL seeding failed:', error);
      }
    }

    console.log('✅ Sample data seeding completed');
  }

  async validateMigration() {
    console.log('🔍 Validating migration...');

    let errors = [];

    // Validate Firebase
    if (this.firebase.db) {
      try {
        for (const collectionName of Object.keys(firebaseCollections)) {
          const snapshot = await this.firebase.db.collection(collectionName).limit(1).get();
          console.log(`✅ Firebase collection ${collectionName} accessible`);
        }
      } catch (error) {
        errors.push(`Firebase validation failed: ${error.message}`);
      }
    }

    // Validate PostgreSQL
    if (this.postgres) {
      try {
        const tables = ['users', 'projects', 'files', 'file_versions', 'activities', 'chat_messages', 'collaboration_sessions'];
        for (const table of tables) {
          const result = await this.postgres.query(`SELECT COUNT(*) FROM ${table}`);
          console.log(`✅ PostgreSQL table ${table} has ${result.rows[0].count} records`);
        }
      } catch (error) {
        errors.push(`PostgreSQL validation failed: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      console.error('❌ Migration validation failed:');
      errors.forEach(error => console.error(`  - ${error}`));
      throw new Error('Migration validation failed');
    }

    console.log('✅ Migration validation completed successfully');
  }

  async close() {
    if (this.postgres) {
      await this.postgres.end();
      console.log('✅ PostgreSQL connection closed');
    }
  }
}

// Main migration function
async function runMigration() {
  console.log('🚀 Starting CodeCollab database migration...');
  
  const migration = new DatabaseMigration();

  try {
    await migration.runFirebaseMigration();
    await migration.runPostgresMigration();
    await migration.seedSampleData();
    await migration.validateMigration();
    
    console.log('🎉 Database migration completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('1. Configure Firebase security rules');
    console.log('2. Set up Firebase indexes');
    console.log('3. Configure authentication providers');
    console.log('4. Update environment variables');
    console.log('5. Deploy application');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migration.close();
  }
}

// Export for use as module
module.exports = {
  DatabaseMigration,
  runMigration,
  firebaseCollections,
  postgresSchema
};

// Run migration if called directly
if (require.main === module) {
  runMigration();
}

# Air IDE Backend

Real-time collaborative code editor backend built with Node.js, Express, Socket.IO, and PostgreSQL.

## Features

- **JWT Authentication** — Signup, login, logout with secure token management
- **Real-time Collaboration** — Socket.IO-based WebSocket connections for live editing
- **Multi-file Sessions** — Create sessions with multiple files, share via invite codes
- **Cursor Awareness** — See other users' cursor positions and text selections in real-time
- **Token Blocklist** — Secure logout that invalidates JWT tokens
- **Rate Limiting** — Protection against brute-force attacks on auth endpoints

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| WebSocket | Socket.IO |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | JWT + bcrypt |

## Getting Started

### Prerequisites

- Node.js v18+
- PostgreSQL database
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Copy environment template and fill in your values
cp .env.example .env

# Generate Prisma client
npm run db:generate

# Push schema to database (creates tables)
npm run db:push

# Start development server
npm run dev
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `4000` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string | *Required* |
| `JWT_SECRET` | Secret key for JWT signing | *Required* |
| `JWT_EXPIRES_IN` | JWT token expiry duration | `1d` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:3000` |

## API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/signup` | Public | Register a new account |
| `POST` | `/api/auth/login` | Public | Login and receive JWT |
| `POST` | `/api/auth/logout` | Protected | Invalidate current JWT |
| `GET` | `/api/auth/me` | Protected | Get current user profile |

### Sessions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/sessions` | Protected | Create a new session |
| `GET` | `/api/sessions` | Protected | List your sessions |
| `GET` | `/api/sessions/:inviteCode` | Protected | Get session by invite code |
| `POST` | `/api/sessions/:id/files` | Protected | Add a file to a session |
| `GET` | `/api/sessions/:id/files` | Protected | List files in a session |

### Health Check

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health status |

## Socket.IO Events

### Connecting

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:4000", {
  auth: {
    token: "YOUR_JWT_TOKEN"  // From /api/auth/login
  }
});

socket.on("connect", () => console.log("Connected:", socket.id));
socket.on("connect_error", (err) => console.error("Auth failed:", err.message));
```

### Client → Server Events

| Event | Payload | Description |
|---|---|---|
| `session:join` | `{ inviteCode }` | Join a session room |
| `session:leave` | `{ sessionId }` | Leave a session room |
| `file:open` | `{ sessionId, fileId }` | Open a file for editing |
| `file:edit` | `{ sessionId, fileId, changes }` | Send text changes |
| `file:save` | `{ sessionId, fileId, content }` | Save file to database |
| `cursor:move` | `{ sessionId, fileId, line, column }` | Update cursor position |
| `cursor:select` | `{ sessionId, fileId, selection }` | Update text selection |

### Server → Client Events

| Event | Payload | Description |
|---|---|---|
| `session:joined` | `{ session, users }` | Session joined successfully |
| `session:user-joined` | `{ userId, username, color }` | New user joined |
| `session:user-left` | `{ userId, username }` | User left the session |
| `session:users` | `[{ userId, username, color, cursor }]` | Active users list |
| `file:content` | `{ fileId, filename, content, language }` | File content |
| `file:edited` | `{ fileId, changes, userId, username }` | Edit from another user |
| `file:saved` | `{ fileId, savedBy, savedAt }` | File saved confirmation |
| `cursor:moved` | `{ userId, username, color, fileId, line, column }` | Cursor update |
| `cursor:selected` | `{ userId, username, color, fileId, selection }` | Selection update |
| `error` | `{ message }` | Error notification |

### Edit Changes Format

The `changes` object in `file:edit` / `file:edited` uses a delta format compatible with CodeMirror and Monaco:

```javascript
{
  from: { line: 1, ch: 0 },   // Start position of change
  to:   { line: 1, ch: 5 },   // End position of change
  text: ["hello", "world"]     // Replacement text (array of lines)
}
```

### Selection Format

```javascript
{
  startLine: 1,
  startColumn: 0,
  endLine: 3,
  endColumn: 15
}
```

## Project Structure

```
├── prisma/
│   └── schema.prisma           # Database schema
├── src/
│   ├── config/
│   │   ├── db.js               # Prisma client singleton
│   │   └── env.js              # Environment configuration
│   ├── controllers/
│   │   ├── auth.controller.js  # Auth request handlers
│   │   └── session.controller.js
│   ├── middlewares/
│   │   ├── auth.middleware.js  # JWT verification
│   │   └── error.middleware.js # Global error handler
│   ├── routes/
│   │   ├── auth.routes.js      # /api/auth/*
│   │   └── session.routes.js   # /api/sessions/*
│   ├── services/
│   │   ├── auth.service.js     # Auth business logic
│   │   └── session.service.js  # Session business logic
│   ├── sockets/
│   │   ├── index.js            # Socket.IO setup & auth
│   │   ├── presence.handler.js # Cursor & presence tracking
│   │   └── session.handler.js  # Room & file events
│   ├── utils/
│   │   ├── api-error.js        # Custom error class
│   │   └── helpers.js          # Utility functions
│   ├── validators/
│   │   └── auth.validator.js   # Input validation rules
│   └── app.js                  # Express app configuration
├── server.js                   # Server entry point
├── .env.example                # Environment template
└── package.json
```

## License

ISC

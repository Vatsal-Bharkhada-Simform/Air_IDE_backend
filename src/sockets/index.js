const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/db');
const sessionHandler = require('./session.handler');
const presenceHandler = require('./presence.handler');

/**
 * ─────────────────────────────────────────────────────────────────
 * SOCKET.IO SERVER INITIALIZATION
 * ─────────────────────────────────────────────────────────────────
 *
 * This module sets up the Socket.IO server with:
 *   1. CORS configuration
 *   2. JWT authentication middleware (handshake-level)
 *   3. Connection handler that registers session & presence events
 *
 * ── How to Connect (Client-Side Instructions) ──────────────────
 *
 * import { io } from "socket.io-client";
 *
 * const socket = io("http://localhost:4000", {
 *   auth: {
 *     token: "YOUR_JWT_TOKEN"   // ← Obtained from /api/auth/login
 *   }
 * });
 *
 * // Connection events
 * socket.on("connect",       () => console.log("Connected:", socket.id));
 * socket.on("connect_error", (err) => console.error("Auth failed:", err.message));
 * socket.on("disconnect",    (reason) => console.log("Disconnected:", reason));
 *
 * // Join a session
 * socket.emit("session:join", { inviteCode: "abc-xyz-123" });
 * socket.on("session:joined", ({ session, users }) => {
 *   console.log("Joined:", session.name, "Users:", users);
 * });
 *
 * // Open a file
 * socket.emit("file:open", { sessionId: "...", fileId: "..." });
 * socket.on("file:content", ({ fileId, content, language }) => {
 *   // Load content into your code editor (Monaco, CodeMirror, etc.)
 * });
 *
 * // Send edits (from your editor's onChange)
 * socket.emit("file:edit", {
 *   sessionId: "...",
 *   fileId: "...",
 *   changes: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 5 }, text: ["hello"] }
 * });
 *
 * // Receive edits from other users
 * socket.on("file:edited", ({ fileId, changes, userId, username }) => {
 *   // Apply changes to your editor
 * });
 *
 * // Send cursor position (from your editor's onCursorActivity)
 * socket.emit("cursor:move", {
 *   sessionId: "...",
 *   fileId: "...",
 *   line: 10,
 *   column: 5
 * });
 *
 * // Receive other users' cursor positions
 * socket.on("cursor:moved", ({ userId, username, color, fileId, line, column }) => {
 *   // Render remote cursor in your editor
 * });
 *
 * // Save file
 * socket.emit("file:save", {
 *   sessionId: "...",
 *   fileId: "...",
 *   content: "// full file content..."
 * });
 *
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * Initialize Socket.IO on an HTTP server.
 *
 * @param {http.Server} httpServer - Node.js HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
function initializeSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Performance tuning
    pingInterval: 25000,     // How often to ping clients (ms)
    pingTimeout: 20000,      // How long to wait for pong (ms)
    maxHttpBufferSize: 1e6,  // Max message size: 1MB
  });

  // ──────────────────────────────────────────────
  // Authentication Middleware
  // ──────────────────────────────────────────────
  // Runs ONCE during the WebSocket handshake.
  // Rejects the connection if the JWT is missing, invalid, or blocklisted.
  //
  // The client must send the token in the auth object:
  //   io("http://...", { auth: { token: "JWT_TOKEN" } })
  //
  // Do NOT send the token in query params — they're logged by proxies.
  // ──────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('Authentication required. Provide token in auth object.'));
      }

      // Verify JWT signature and expiration
      let decoded;
      try {
        decoded = jwt.verify(token, env.JWT_SECRET);
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return next(new Error('Token expired. Please log in again.'));
        }
        return next(new Error('Invalid authentication token.'));
      }

      // Check if token has been blocklisted (logged out)
      const blocked = await prisma.blockedToken.findUnique({
        where: { jti: decoded.jti },
      });

      if (blocked) {
        return next(new Error('Token has been revoked. Please log in again.'));
      }

      // Attach user info to the socket for use in event handlers
      // Fetch avatarSeed from DB — not embedded in JWT
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { avatarSeed: true },
      });

      socket.user = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.username,
        avatarSeed: dbUser?.avatarSeed ?? null,
      };

      next();
    } catch (error) {
      next(new Error('Authentication failed.'));
    }
  });

  // ──────────────────────────────────────────────
  // Connection Handler
  // ──────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`🔗 ${socket.user.username} connected (${socket.id})`);

    // Register all event handlers
    sessionHandler.registerHandlers(socket, io);
    presenceHandler.registerHandlers(socket, io);
  });

  console.log('🔌 Socket.IO initialized');
  return io;
}

module.exports = { initializeSocket };

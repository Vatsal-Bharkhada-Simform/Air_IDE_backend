const sessionService = require('../services/session.service');
const presenceHandler = require('./presence.handler');

/**
 * ─────────────────────────────────────────────────────────────────
 * SESSION HANDLER — Room management & file editing events
 * ─────────────────────────────────────────────────────────────────
 *
 * Handles session lifecycle (join/leave rooms) and file operations
 * (open, edit, save) over WebSocket.
 *
 * ── Socket Events (Client → Server) ────────────────────────────
 *
 * "session:join"  { inviteCode }
 *   → Validates the invite code, joins the socket to the session
 *     room, records participation in DB, adds to presence, and
 *     broadcasts the new user to all others in the room.
 *     Responds with: session details + list of active users.
 *
 * "session:leave" { sessionId }
 *   → Removes the socket from the session room, updates DB
 *     participant record, removes from presence, broadcasts
 *     user-left to remaining users.
 *
 * "file:open"     { sessionId, fileId }
 *   → Fetches file content from DB and sends it back to the
 *     requesting socket. Updates the user's presence to show
 *     which file they're viewing.
 *
 * "file:edit"     { sessionId, fileId, changes }
 *   → Broadcasts the edit delta to all OTHER users in the room.
 *     Does NOT persist to DB (use file:save for that).
 *     changes = { from: { line, ch }, to: { line, ch }, text: string[] }
 *
 * "file:save"     { sessionId, fileId, content }
 *   → Persists the full file content to the database.
 *     Broadcasts file:saved confirmation to all users in the room.
 *
 * ── Socket Events (Server → Client) ────────────────────────────
 *
 * "session:joined"      { session, users }
 *   → Sent to the joining user with session details and active users.
 *
 * "session:user-joined"  { userId, username, color }
 *   → Broadcast to all OTHER users when someone joins.
 *
 * "session:user-left"    { userId, username }
 *   → Broadcast to all OTHER users when someone leaves.
 *
 * "session:users"        [{ userId, username, color, cursor, selection }]
 *   → Full list of active users (sent on join).
 *
 * "file:content"         { fileId, filename, content, language }
 *   → Sent to the requesting user when they open a file.
 *
 * "file:edited"          { fileId, changes, userId, username }
 *   → Broadcast to all OTHER users when someone edits a file.
 *
 * "file:saved"           { fileId, savedBy, savedAt }
 *   → Broadcast to ALL users when a file is saved.
 *
 * "error"                { message }
 *   → Sent to the socket when an operation fails.
 *
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * Track which sessions each socket is connected to.
 * Map<socketId, Set<sessionId>>
 * Used for cleanup on disconnect.
 */
const socketSessions = new Map();

/**
 * Monotonic per-file sequence counter.
 * Map<"sessionId:fileId", number>
 *
 * Incremented on every file:edit event and stamped onto the outgoing
 * file:edited broadcast. Receivers use this to detect and discard
 * out-of-order or duplicate deltas (e.g. after a reconnect).
 */
const fileSeqCounters = new Map();

const sessionHandler = {
  /**
   * Register session and file event handlers on a socket.
   *
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Server} io     - Socket.IO server instance
   */
  registerHandlers(socket, io) {
    /**
     * session:join — Join a collaboration session room.
     *
     * Payload: { inviteCode: string }
     *
     * Flow:
     *   1. Validate invite code → fetch session from DB
     *   2. Join Socket.IO room (room name = sessionId)
     *   3. Record participation in DB (SessionParticipant)
     *   4. Add user to in-memory presence
     *   5. Broadcast user-joined to others
     *   6. Send session details + active users to the joining user
     */
    socket.on('session:join', async (data) => {
      try {
        const { inviteCode } = data;

        if (!inviteCode) {
          return socket.emit('error', { message: 'Invite code is required.' });
        }

        // Fetch session from DB (validates invite code)
        const session = await sessionService.getSessionByInviteCode(inviteCode);

        // Join the Socket.IO room
        socket.join(session.id);

        // Track this socket's sessions for cleanup
        if (!socketSessions.has(socket.id)) {
          socketSessions.set(socket.id, new Set());
        }
        socketSessions.get(socket.id).add(session.id);

        // Record participation in DB
        await sessionService.addParticipant(session.id, socket.user.id);

        // Add to in-memory presence
        const presence = presenceHandler.addUser(session.id, socket.id, socket.user);

        // Notify other users in the session
        socket.to(session.id).emit('session:user-joined', {
          userId: socket.user.id,
          username: socket.user.username,
          color: presence.color,
        });

        // Send session info and active users to the joining user
        const activeUsers = presenceHandler.getSessionUsers(session.id);

        socket.emit('session:joined', {
          session: {
            id: session.id,
            name: session.name,
            inviteCode: session.inviteCode,
            creator: session.creator,
            files: session.files,
          },
          users: activeUsers.map((u) => ({
            userId: u.userId,
            username: u.username,
            color: u.color,
            cursor: u.cursor,
            selection: u.selection,
          })),
        });

        console.log(`📂 ${socket.user.username} joined session "${session.name}" (${session.id})`);
      } catch (error) {
        console.error('session:join error:', error.message);
        socket.emit('error', { message: error.message || 'Failed to join session.' });
      }
    });

    /**
     * session:leave — Leave a collaboration session.
     *
     * Payload: { sessionId: string }
     */
    socket.on('session:leave', async (data) => {
      try {
        const { sessionId } = data;

        if (!sessionId) {
          return socket.emit('error', { message: 'Session ID is required.' });
        }

        await this.handleLeaveSession(socket, io, sessionId);
      } catch (error) {
        console.error('session:leave error:', error.message);
        socket.emit('error', { message: 'Failed to leave session.' });
      }
    });

    /**
     * file:open — Open a file for editing.
     *
     * Payload: { sessionId: string, fileId: string }
     *
     * Returns the full file content to the requesting socket.
     * Also updates the user's presence to reflect which file they're viewing.
     */
    socket.on('file:open', async (data) => {
      try {
        const { sessionId, fileId } = data;

        if (!sessionId || !fileId) {
          return socket.emit('error', { message: 'Session ID and file ID are required.' });
        }

        const file = await sessionService.getFileById(fileId);

        // Update cursor to indicate which file the user is viewing
        presenceHandler.updateCursor(sessionId, socket.id, {
          fileId,
          line: 1,
          column: 0,
        });

        socket.emit('file:content', {
          fileId: file.id,
          filename: file.filename,
          content: file.content,
          language: file.language,
        });
      } catch (error) {
        console.error('file:open error:', error.message);
        socket.emit('error', { message: error.message || 'Failed to open file.' });
      }
    });

    /**
     * file:edit — Broadcast a text change to other users.
     *
     * Payload: {
     *   sessionId: string,
     *   fileId: string,
     *   changes: {
     *     from: { line: number, ch: number },  // Start of change
     *     to:   { line: number, ch: number },   // End of change
     *     text: string[]                         // Replacement text lines
     *   }
     * }
     *
     * The change is NOT persisted to the database here — it's only
     * relayed to other connected users for real-time collaboration.
     * Use "file:save" to persist the current state.
     *
     * Each broadcast includes a monotonic `seq` number per file so
     * receivers can detect and discard out-of-order deltas.
     */
    socket.on('file:edit', (data) => {
      const { sessionId, fileId, changes } = data;

      if (!sessionId || !fileId || !changes) {
        return socket.emit('error', { message: 'Invalid edit data.' });
      }

      // Increment and stamp the per-file sequence number
      const seqKey = `${sessionId}:${fileId}`;
      const seq = (fileSeqCounters.get(seqKey) ?? 0) + 1;
      fileSeqCounters.set(seqKey, seq);

      // Broadcast to everyone else in the session
      socket.to(sessionId).emit('file:edited', {
        fileId,
        changes,
        userId: socket.user.id,
        username: socket.user.username,
        seq,
      });
    });

    /**
     * file:save — Persist the current file content to the database.
     *
     * Payload: {
     *   sessionId: string,
     *   fileId: string,
     *   content: string     // Full file content
     * }
     *
     * Saves to PostgreSQL and broadcasts confirmation to all users.
     */
    socket.on('file:save', async (data) => {
      try {
        const { sessionId, fileId, content } = data;

        if (!sessionId || !fileId || content == null) {
          return socket.emit('error', { message: 'Invalid save data.' });
        }

        await sessionService.updateFileContent(fileId, content);

        // Notify all users in the session (including the saver)
        io.to(sessionId).emit('file:saved', {
          fileId,
          savedBy: socket.user.username,
          savedAt: new Date().toISOString(),
        });

        console.log(`💾 ${socket.user.username} saved file ${fileId}`);
      } catch (error) {
        console.error('file:save error:', error.message);
        socket.emit('error', { message: 'Failed to save file.' });
      }
    });

    // ── Disconnect cleanup ─────────────────────
    socket.on('disconnect', async () => {
      await this.handleDisconnect(socket, io);
    });
  },

  /**
   * Handle a user leaving a specific session.
   * Called on explicit "session:leave" or during disconnect cleanup.
   */
  async handleLeaveSession(socket, io, sessionId) {
    // Remove from Socket.IO room
    socket.leave(sessionId);

    // Remove from tracking
    const sessions = socketSessions.get(socket.id);
    if (sessions) {
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        socketSessions.delete(socket.id);
      }
    }

    // Remove from presence
    const presence = presenceHandler.removeUser(sessionId, socket.id);

    // Clean up per-file sequence counters for this session if no users remain
    const remainingUsers = presenceHandler.getSessionUsers(sessionId);
    if (remainingUsers.length === 0) {
      // Delete all seq counters whose key starts with this sessionId
      for (const key of fileSeqCounters.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
          fileSeqCounters.delete(key);
        }
      }
    }

    // Record departure in DB
    await sessionService.removeParticipant(sessionId, socket.user.id);

    // Notify remaining users
    if (presence) {
      socket.to(sessionId).emit('session:user-left', {
        userId: presence.userId,
        username: presence.username,
      });

      // Send updated user list
      const activeUsers = presenceHandler.getSessionUsers(sessionId);
      io.to(sessionId).emit('session:users', activeUsers.map((u) => ({
        userId: u.userId,
        username: u.username,
        color: u.color,
        cursor: u.cursor,
        selection: u.selection,
      })));
    }

    console.log(`👋 ${socket.user.username} left session ${sessionId}`);
  },

  /**
   * Handle socket disconnection — clean up all sessions the user was in.
   */
  async handleDisconnect(socket, io) {
    const sessions = socketSessions.get(socket.id);

    if (sessions) {
      for (const sessionId of sessions) {
        await this.handleLeaveSession(socket, io, sessionId);
      }
    }

    socketSessions.delete(socket.id);
    console.log(`🔌 ${socket.user?.username || 'Unknown'} disconnected`);
  },
};

module.exports = sessionHandler;

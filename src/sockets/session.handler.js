const sessionService = require('../services/session.service');
const presenceHandler = require('./presence.handler');
const Y = require('yjs');

/**
 * ─────────────────────────────────────────────────────────────────
 * SESSION HANDLER — Room management & file editing events
 * ─────────────────────────────────────────────────────────────────
 *
 * Handles session lifecycle (join/leave/end) and file operations
 * (open, edit, save, delete, rename) over WebSocket.
 *
 * ── Socket Events (Client → Server) ────────────────────────────
 *
 * "session:join"   { inviteCode }
 *   → Validates the invite code, joins the socket to the session
 *     room, records participation in DB, adds to presence, and
 *     broadcasts the membership change to all others in the room.
 *     Responds with: session details + list of active users.
 *
 * "session:leave"  { sessionId }
 *   → Removes the socket from the session room, updates DB
 *     participant record, removes from presence, broadcasts
 *     membership change to remaining users.
 *
 * "session:end"    { sessionId }
 *   → Creator-only. Marks the session inactive in DB, kicks all
 *     users, and broadcasts session:ended to the whole room.
 *
 * "file:open"      { sessionId, fileId }
 *   → Fetches file content from DB and sends it back to the
 *     requesting socket. Updates the user's presence to show
 *     which file they're viewing.
 *
 * "file:delete"    { sessionId, fileId }
 *   → Deletes the file from DB, removes its in-memory Y.Doc, and
 *     broadcasts file:deleted to all users in the room.
 *
 * "file:rename"    { sessionId, fileId, newFilename }
 *   → Renames the file in DB and broadcasts file:renamed to all
 *     users in the room.
 *
 * "file:save"      { sessionId, fileId }
 *   → Persists the current Yjs document state to the database.
 *     Broadcasts file:saved confirmation to all users in the room.
 *
 * "update"         { sessionId, fileId, update: number[] }
 *   → Applies the Yjs binary update to the server-side Y.Doc and
 *     relays it to all OTHER users in the room.
 *
 * "sync-request"   { sessionId, fileId, stateVector }
 *   → Client asks for the current document state. Server responds
 *     with a diff (encodeStateAsUpdate) as sync-response.
 *
 * ── Socket Events (Server → Client) ────────────────────────────
 *
 * "session:joined"     { session, users }
 *   → Sent ONLY to the joining user with full session details and
 *     the current active user list.
 *
 * "session:membership" { type, users, actor? }
 *   → Sent to all OTHER users (on join) or ALL users (on leave/sync)
 *     whenever the presence list changes.
 *     type:  "joined" | "left" | "full-sync"
 *     users: always the full, up-to-date SessionUser list
 *     actor: { userId, username, color } — the user who joined/left
 *            (omitted for full-sync)
 *
 * "session:ended"      { sessionId, endedBy }
 *   → Broadcast to ALL users when the creator ends the session.
 *
 * "file:content"       { fileId, filename, content, language }
 *   → Sent to the requesting user when they open a file.
 *
 * "file:created"       { file: { id, filename, language }, createdBy }
 *   → Broadcast to ALL users when a new file is created via REST.
 *     (Emitted from session.controller after the DB write.)
 *
 * "file:deleted"       { fileId, deletedBy }
 *   → Broadcast to ALL users when a file is deleted.
 *
 * "file:renamed"       { fileId, newFilename, renamedBy }
 *   → Broadcast to ALL users when a file is renamed.
 *
 * "file:saved"         { fileId, savedBy, savedAt }
 *   → Broadcast to ALL users when a file is saved.
 *
 * "update"             { fileId, update: number[], userId, username }
 *   → Relayed to all OTHER users when someone edits a file.
 *
 * "sync-response"      { fileId, update: number[] }
 *   → Sent to the requesting user with the full document diff.
 *
 * "error"              { message }
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
 */
const fileSeqCounters = new Map();

/**
 * Yjs documents in memory.
 * Map<fileId, Y.Doc>
 */
const documents = new Map();

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Build a serialisable SessionUser array from presence data.
 * @param {string} sessionId
 * @returns {Array}
 */
function getActiveUsers(sessionId) {
  return presenceHandler.getSessionUsers(sessionId).map((u) => ({
    userId: u.userId,
    username: u.username,
    color: u.color,
    cursor: u.cursor,
    selection: u.selection,
  }));
}

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
     *   5. Broadcast session:membership (type: "joined") to others
     *   6. Send session:joined with details + active users to joining user
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

        // Notify other users — send full updated user list + actor
        const activeUsers = getActiveUsers(session.id);

        socket.to(session.id).emit('session:membership', {
          type: 'joined',
          users: activeUsers,
          actor: {
            userId: presence.userId,
            username: presence.username,
            color: presence.color,
          },
        });

        // Send session info and active users to the joining user
        socket.emit('session:joined', {
          session: {
            id: session.id,
            name: session.name,
            inviteCode: session.inviteCode,
            creator: session.creator,
            files: session.files,
          },
          users: activeUsers,
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
     * session:end — Creator ends the session for all participants.
     *
     * Payload: { sessionId: string }
     *
     * Only the session creator is permitted to end the session.
     * All users are kicked from the room and receive session:ended.
     */
    socket.on('session:end', async (data) => {
      try {
        const { sessionId } = data;

        if (!sessionId) {
          return socket.emit('error', { message: 'Session ID is required.' });
        }

        // Load session to verify the requester is the creator
        const prisma = require('../config/db');
        const sessionRecord = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { createdBy: true, name: true },
        });

        if (!sessionRecord) {
          return socket.emit('error', { message: 'Session not found.' });
        }

        if (sessionRecord.createdBy !== socket.user.id) {
          return socket.emit('error', { message: 'Only the session creator can end the session.' });
        }

        // Mark session as inactive in DB
        await sessionService.endSession(sessionId);

        // Broadcast to ALL users in the room (including the creator)
        io.to(sessionId).emit('session:ended', {
          sessionId,
          endedBy: socket.user.username,
        });

        // Clean up presence for all sockets in this room
        // Socket.IO rooms are cleaned up automatically when sockets leave
        io.in(sessionId).socketsLeave(sessionId);

        // Clean up per-file seq counters for this session
        for (const key of fileSeqCounters.keys()) {
          if (key.startsWith(`${sessionId}:`)) {
            fileSeqCounters.delete(key);
          }
        }

        console.log(`🔒 ${socket.user.username} ended session "${sessionRecord.name}" (${sessionId})`);
      } catch (error) {
        console.error('session:end error:', error.message);
        socket.emit('error', { message: 'Failed to end session.' });
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

        // --- YJS INITIALIZATION (DUAL-WRITE) ---
        if (!documents.has(fileId)) {
          const doc = new Y.Doc();
          if (file.yjsState) {
            Y.applyUpdate(doc, new Uint8Array(file.yjsState));
          } else {
            const ytext = doc.getText('content');
            ytext.insert(0, file.content || '');
          }
          documents.set(fileId, doc);
        }

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
     * file:delete — Delete a file from the session.
     *
     * Payload: { sessionId: string, fileId: string }
     *
     * Any participant may delete a file. The file is removed from DB,
     * its in-memory Y.Doc is destroyed, and file:deleted is broadcast
     * to all users so they can close the tab.
     */
    socket.on('file:delete', async (data) => {
      try {
        const { sessionId, fileId } = data;

        if (!sessionId || !fileId) {
          return socket.emit('error', { message: 'Session ID and file ID are required.' });
        }

        await sessionService.deleteFile(fileId);

        // Remove in-memory Yjs document
        if (documents.has(fileId)) {
          documents.get(fileId).destroy();
          documents.delete(fileId);
        }

        // Remove seq counters for this file
        fileSeqCounters.delete(`${sessionId}:${fileId}`);

        // Broadcast to ALL users so they close the tab
        io.to(sessionId).emit('file:deleted', {
          fileId,
          deletedBy: socket.user.username,
        });

        console.log(`🗑️  ${socket.user.username} deleted file ${fileId}`);
      } catch (error) {
        console.error('file:delete error:', error.message);
        socket.emit('error', { message: error.message || 'Failed to delete file.' });
      }
    });

    /**
     * file:rename — Rename a file in the session.
     *
     * Payload: { sessionId: string, fileId: string, newFilename: string }
     *
     * Any participant may rename a file. The new name is persisted to DB
     * and file:renamed is broadcast to all users.
     */
    socket.on('file:rename', async (data) => {
      try {
        const { sessionId, fileId, newFilename } = data;

        if (!sessionId || !fileId || !newFilename) {
          return socket.emit('error', { message: 'Session ID, file ID, and new filename are required.' });
        }

        await sessionService.renameFile(fileId, newFilename.trim());

        // Broadcast to ALL users so they update tab labels and file lists
        io.to(sessionId).emit('file:renamed', {
          fileId,
          newFilename: newFilename.trim(),
          renamedBy: socket.user.username,
        });

        console.log(`✏️  ${socket.user.username} renamed file ${fileId} to "${newFilename}"`);
      } catch (error) {
        console.error('file:rename error:', error.message);
        socket.emit('error', { message: error.message || 'Failed to rename file.' });
      }
    });

    /**
     * update — Broadcast a Yjs binary update to other users.
     *
     * Payload: {
     *   sessionId: string,
     *   fileId: string,
     *   update: Array<number> // Yjs binary update
     * }
     *
     * The change is NOT persisted to the database here — it's only
     * relayed to other connected users for real-time collaboration.
     * Use "file:save" to persist the current state.
     */
    socket.on('update', (data) => {
      const { sessionId, fileId, update } = data;

      if (!sessionId || !fileId || !update) {
        return socket.emit('error', { message: 'Invalid update data.' });
      }

      // Apply to server document
      const doc = documents.get(fileId);
      if (doc) {
        try {
          const updateArray = new Uint8Array(update);
          Y.applyUpdate(doc, updateArray);
        } catch (err) {
          console.error('Yjs update error:', err.message);
        }
      }

      // Broadcast to everyone else in the session
      socket.to(sessionId).emit('update', {
        fileId,
        update,
        userId: socket.user.id,
        username: socket.user.username,
      });
    });

    /**
     * sync-request — Client asks for current document state.
     *
     * Payload: { sessionId, fileId, stateVector }
     */
    socket.on('sync-request', async (data) => {
      try {
        const { sessionId, fileId, stateVector } = data;
        let doc = documents.get(fileId);

        if (!doc) {
          // Fallback: load from DB if missing (e.g. server restarted)
          const file = await sessionService.getFileById(fileId);
          doc = new Y.Doc();
          if (file.yjsState) {
            Y.applyUpdate(doc, new Uint8Array(file.yjsState));
          } else {
            const ytext = doc.getText('content');
            ytext.insert(0, file.content || '');
          }
          documents.set(fileId, doc);
        }

        let sv = null;
        if (stateVector) {
          sv = new Uint8Array(stateVector);
        }
        const update = Y.encodeStateAsUpdate(doc, sv);

        socket.emit('sync-response', {
          fileId,
          update: Array.from(update),
        });
      } catch (error) {
        console.error('sync-request error:', error.message);
      }
    });

    /**
     * file:save — Persist the current file content to the database.
     *
     * Payload: {
     *   sessionId: string,
     *   fileId: string
     * }
     *
     * Saves to PostgreSQL and broadcasts confirmation to all users.
     */
    socket.on('file:save', async (data) => {
      try {
        const { sessionId, fileId } = data;

        if (!sessionId || !fileId) {
          return socket.emit('error', { message: 'Invalid save data.' });
        }

        const doc = documents.get(fileId);
        if (!doc) {
          return socket.emit('error', { message: 'Document not open in memory.' });
        }

        const content = doc.getText('content').toString();
        const yjsState = Buffer.from(Y.encodeStateAsUpdate(doc));

        await sessionService.updateFileContent(fileId, content, yjsState);

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
      for (const key of fileSeqCounters.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
          fileSeqCounters.delete(key);
        }
      }
    }

    // Record departure in DB
    await sessionService.removeParticipant(sessionId, socket.user.id);

    // Broadcast session:membership (type: "left") to remaining users with updated list
    if (presence) {
      const activeUsers = getActiveUsers(sessionId);

      io.to(sessionId).emit('session:membership', {
        type: 'left',
        users: activeUsers,
        actor: {
          userId: presence.userId,
          username: presence.username,
          color: presence.color,
        },
      });
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

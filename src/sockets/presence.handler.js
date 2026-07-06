const { assignCursorColor } = require('../utils/helpers');

/**
 * ─────────────────────────────────────────────────────────────────
 * PRESENCE HANDLER — Cursor positions & user awareness
 * ─────────────────────────────────────────────────────────────────
 *
 * Manages the in-memory store for ephemeral user presence data:
 *   - Which users are in each session
 *   - Cursor positions (line, column) per user
 *   - Text selections per user
 *   - Which file each user is currently viewing
 *
 * This data is NOT persisted to the database — it exists only
 * while users are connected. When a user disconnects, their
 * presence data is automatically cleaned up.
 *
 * ── Data Structure ──────────────────────────────────────────────
 *
 * sessionPresence: Map<sessionId, Map<socketId, UserPresence>>
 *
 * UserPresence = {
 *   userId:    string,   // DB user ID
 *   username:  string,   // Display name
 *   color:     string,   // Hex color for cursor/selection highlight
 *   cursor: {
 *     fileId:  string,   // Which file the user is editing
 *     line:    number,   // 1-based line number
 *     column:  number,   // 0-based column offset
 *   },
 *   selection: {         // Text selection range (null if no selection)
 *     startLine:   number,
 *     startColumn: number,
 *     endLine:     number,
 *     endColumn:   number,
 *   } | null,
 *   lastActive: number,  // Unix timestamp of last activity
 * }
 *
 * ── Socket Events (Client → Server) ────────────────────────────
 *
 * "cursor:move"   { sessionId, fileId, line, column }
 *   → Updates the user's cursor position and broadcasts to the room.
 *
 * "cursor:select" { sessionId, fileId, selection }
 *   → Updates the user's text selection and broadcasts to the room.
 *     selection = { startLine, startColumn, endLine, endColumn }
 *
 * ── Socket Events (Server → Client) ────────────────────────────
 *
 * "cursor:moved"    { userId, username, color, fileId, line, column }
 *   → Sent to all OTHER users in the session when a cursor moves.
 *
 * "cursor:selected" { userId, username, color, fileId, selection }
 *   → Sent to all OTHER users when a text selection changes.
 *
 * "session:users"   [{ userId, username, color, cursor, selection }]
 *   → Full list of active users, sent when a new user joins
 *     so they can render all existing cursors.
 *
 * ─────────────────────────────────────────────────────────────────
 */

// In-memory presence store
// Map<sessionId, Map<socketId, UserPresence>>
const sessionPresence = new Map();

const presenceHandler = {
  /**
   * Add a user to a session's presence map.
   *
   * @param {string} sessionId - Session ID
   * @param {string} socketId  - Socket connection ID
   * @param {Object} user      - { id, username }
   * @returns {Object} The created UserPresence object
   */
  addUser(sessionId, socketId, user) {
    if (!sessionPresence.has(sessionId)) {
      sessionPresence.set(sessionId, new Map());
    }

    const users = sessionPresence.get(sessionId);
    const colorIndex = users.size;

    const presence = {
      userId: user.id,
      username: user.username,
      color: assignCursorColor(colorIndex),
      cursor: { fileId: null, line: 1, column: 0 },
      selection: null,
      lastActive: Date.now(),
    };

    users.set(socketId, presence);
    return presence;
  },

  /**
   * Remove a user from a session's presence map.
   *
   * @param {string} sessionId - Session ID
   * @param {string} socketId  - Socket connection ID
   * @returns {Object|null} The removed UserPresence, or null
   */
  removeUser(sessionId, socketId) {
    const users = sessionPresence.get(sessionId);
    if (!users) return null;

    const presence = users.get(socketId);
    users.delete(socketId);

    // Clean up empty sessions
    if (users.size === 0) {
      sessionPresence.delete(sessionId);
    }

    return presence || null;
  },

  /**
   * Get all active users in a session.
   *
   * @param {string} sessionId - Session ID
   * @returns {Array} Array of UserPresence objects
   */
  getSessionUsers(sessionId) {
    const users = sessionPresence.get(sessionId);
    if (!users) return [];

    return Array.from(users.values());
  },

  /**
   * Update a user's cursor position.
   *
   * @param {string} sessionId - Session ID
   * @param {string} socketId  - Socket connection ID
   * @param {Object} cursor    - { fileId, line, column }
   * @returns {Object|null} Updated UserPresence, or null
   */
  updateCursor(sessionId, socketId, cursor) {
    const users = sessionPresence.get(sessionId);
    if (!users) return null;

    const presence = users.get(socketId);
    if (!presence) return null;

    presence.cursor = {
      fileId: cursor.fileId,
      line: cursor.line,
      column: cursor.column,
    };
    presence.selection = null; // Clear selection on cursor move
    presence.lastActive = Date.now();

    return presence;
  },

  /**
   * Update a user's text selection.
   *
   * @param {string} sessionId - Session ID
   * @param {string} socketId  - Socket connection ID
   * @param {string} fileId    - File being edited
   * @param {Object} selection - { startLine, startColumn, endLine, endColumn }
   * @returns {Object|null} Updated UserPresence, or null
   */
  updateSelection(sessionId, socketId, fileId, selection) {
    const users = sessionPresence.get(sessionId);
    if (!users) return null;

    const presence = users.get(socketId);
    if (!presence) return null;

    presence.cursor.fileId = fileId;
    presence.selection = selection;
    presence.lastActive = Date.now();

    return presence;
  },

  /**
   * Register cursor/selection event handlers on a socket.
   *
   * @param {Socket} socket - Socket.IO socket instance
   * @param {Server} io     - Socket.IO server instance
   */
  registerHandlers(socket, io) {
    /**
     * cursor:move — User moved their cursor in the editor.
     *
     * Payload: { sessionId, fileId, line, column }
     *
     * Broadcasts cursor:moved to all other users in the session room.
     */
    socket.on('cursor:move', (data) => {
      const { sessionId, fileId, line, column } = data;

      if (!sessionId || !fileId || line == null || column == null) {
        return socket.emit('error', { message: 'Invalid cursor data.' });
      }

      const presence = this.updateCursor(sessionId, socket.id, {
        fileId,
        line,
        column,
      });

      if (presence) {
        // Broadcast to everyone else in the session
        socket.to(sessionId).emit('cursor:moved', {
          userId: presence.userId,
          username: presence.username,
          color: presence.color,
          fileId,
          line,
          column,
        });
      }
    });

    /**
     * cursor:select — User selected text in the editor.
     *
     * Payload: { sessionId, fileId, selection }
     *   selection = { startLine, startColumn, endLine, endColumn }
     *
     * Broadcasts cursor:selected to all other users in the session room.
     */
    socket.on('cursor:select', (data) => {
      const { sessionId, fileId, selection } = data;

      if (!sessionId || !fileId || !selection) {
        return socket.emit('error', { message: 'Invalid selection data.' });
      }

      const presence = this.updateSelection(
        sessionId,
        socket.id,
        fileId,
        selection
      );

      if (presence) {
        socket.to(sessionId).emit('cursor:selected', {
          userId: presence.userId,
          username: presence.username,
          color: presence.color,
          fileId,
          selection,
        });
      }
    });
  },
};

module.exports = presenceHandler;

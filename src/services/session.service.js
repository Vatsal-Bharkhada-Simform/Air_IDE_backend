const prisma = require('../config/db');
const ApiError = require('../utils/api-error');
const { generateInviteCode } = require('../utils/helpers');

/**
 * Session service — handles session CRUD, invite code generation,
 * file management, and participant tracking.
 */
const sessionService = {
  // ──────────────────────────────────────────────
  // Session CRUD
  // ──────────────────────────────────────────────

  /**
   * Create a new collaboration session.
   *
   * @param {Object} data - { name, userId }
   * @returns {Promise<Object>} Created session with invite code
   */
  async createSession({ name, userId }) {
    // Generate a unique invite code (retry on collision)
    let inviteCode;
    let isUnique = false;

    while (!isUnique) {
      inviteCode = generateInviteCode();
      const existing = await prisma.session.findUnique({
        where: { inviteCode },
      });
      isUnique = !existing;
    }

    const session = await prisma.session.create({
      data: {
        name,
        inviteCode,
        createdBy: userId,
      },
      include: {
        creator: {
          select: { id: true, username: true },
        },
      },
    });

    return session;
  },

  /**
   * List sessions for a user, optionally filtered by their role.
   *
   * @param {string} userId - User ID
   * @param {'owner'|'participant'|undefined} role
   *   - 'owner':       sessions the user created
   *   - 'participant': sessions the user joined but does not own
   *   - undefined:     all sessions (owner OR participant) — backward-compatible
   * @returns {Promise<Array>} Sessions array
   */
  async listUserSessions(userId, role) {
    let where;

    if (role === 'owner') {
      where = { createdBy: userId };
    } else if (role === 'participant') {
      where = {
        participants: { some: { userId } },
        NOT: { createdBy: userId },
      };
    } else {
      // Default: all sessions this user is involved in
      where = {
        OR: [
          { createdBy: userId },
          { participants: { some: { userId } } },
        ],
      };
    }

    const sessions = await prisma.session.findMany({
      where,
      include: {
        creator: { select: { id: true, username: true } },
        _count: { select: { files: true, participants: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return sessions;
  },

  /**
   * Get a session by its invite code.
   *
   * @param {string} inviteCode - Unique invite code
   * @returns {Promise<Object>} Session with files and participants
   * @throws {ApiError} If session not found or inactive
   */
  async getSessionByInviteCode(inviteCode) {
    const session = await prisma.session.findUnique({
      where: { inviteCode },
      include: {
        creator: { select: { id: true, username: true } },
        files: {
          select: { id: true, filename: true, language: true, updatedAt: true },
          orderBy: { filename: 'asc' },
        },
      },
    });

    if (!session) {
      throw ApiError.notFound('Session not found. Check the invite code.');
    }

    if (!session.isActive) {
      throw ApiError.badRequest('This session has been closed.');
    }

    return session;
  },

  // ──────────────────────────────────────────────
  // File operations
  // ──────────────────────────────────────────────

  /**
   * Create a new file within a session.
   *
   * @param {Object} data - { sessionId, filename, language?, content? }
   * @returns {Promise<Object>} Created file
   * @throws {ApiError} If filename already exists in session
   */
  async createFile({ sessionId, filename, language = 'plaintext', content = '' }) {
    // Verify session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw ApiError.notFound('Session not found.');
    }

    // Check for duplicate filename
    const existing = await prisma.sessionFile.findUnique({
      where: { sessionId_filename: { sessionId, filename } },
    });

    if (existing) {
      throw ApiError.conflict(`A file named "${filename}" already exists in this session.`);
    }

    const file = await prisma.sessionFile.create({
      data: { sessionId, filename, language, content },
    });

    return file;
  },

  /**
   * List all files in a session.
   *
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>} Files (without content for efficiency)
   */
  async listSessionFiles(sessionId) {
    return prisma.sessionFile.findMany({
      where: { sessionId },
      select: {
        id: true,
        filename: true,
        language: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { filename: 'asc' },
    });
  },

  /**
   * Get a file by ID, including its full content.
   *
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} File with content
   * @throws {ApiError} If file not found
   */
  async getFileById(fileId) {
    const file = await prisma.sessionFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw ApiError.notFound('File not found.');
    }

    return file;
  },

  /**
   * Update file content. Used when saving file changes to DB.
   *
   * @param {string} fileId  - File ID
   * @param {string} content - New file content
   * @param {Buffer} yjsState - New binary Yjs state (optional)
   * @returns {Promise<Object>} Updated file
   */
  async updateFileContent(fileId, content, yjsState) {
    const data = { content };
    if (yjsState) {
      data.yjsState = yjsState;
    }
    return prisma.sessionFile.update({
      where: { id: fileId },
      data,
    });
  },

  /**
   * Delete a file from a session.
   *
   * @param {string} fileId - File ID to delete
   * @returns {Promise<Object>} Deleted file record
   * @throws {ApiError} If file not found
   */
  async deleteFile(fileId) {
    const file = await prisma.sessionFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw ApiError.notFound('File not found.');
    }

    return prisma.sessionFile.delete({
      where: { id: fileId },
    });
  },

  /**
   * Rename a file in a session.
   *
   * @param {string} fileId      - File ID
   * @param {string} newFilename - New filename
   * @returns {Promise<Object>} Updated file record
   * @throws {ApiError} If file not found or name already taken
   */
  async renameFile(fileId, newFilename) {
    const file = await prisma.sessionFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw ApiError.notFound('File not found.');
    }

    // Check for duplicate filename within the same session
    const existing = await prisma.sessionFile.findUnique({
      where: { sessionId_filename: { sessionId: file.sessionId, filename: newFilename } },
    });

    if (existing) {
      throw ApiError.conflict(`A file named "${newFilename}" already exists in this session.`);
    }

    return prisma.sessionFile.update({
      where: { id: fileId },
      data: { filename: newFilename },
    });
  },

  /**
   * Update a session's active state.
   * Use to close (isActive=false) or reopen (isActive=true) a session.
   * Only the session creator should call this.
   *
   * @param {string}  sessionId - Session ID
   * @param {boolean} isActive  - Desired active state
   * @returns {Promise<Object>} Updated session record
   * @throws {ApiError} If session not found
   */
  async updateSessionStatus(sessionId, isActive) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw ApiError.notFound('Session not found.');
    }

    return prisma.session.update({
      where: { id: sessionId },
      data: { isActive },
      include: {
        creator: { select: { id: true, username: true } },
      },
    });
  },

  /**
   * Hard-delete a session and all its files.
   * SessionFile rows are removed via the onDelete: Cascade constraint.
   * Only the session creator should call this.
   *
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Deleted session record
   * @throws {ApiError} If session not found
   */
  async deleteSession(sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw ApiError.notFound('Session not found.');
    }

    return prisma.session.delete({
      where: { id: sessionId },
    });
  },

  /**
   * Get the participant history for a session.
   * Returns all join/leave records with basic user info, newest first.
   *
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>} Participant records
   */
  async getParticipants(sessionId) {
    return prisma.sessionParticipant.findMany({
      where: { sessionId },
      include: {
        user: { select: { id: true, username: true } },
      },
      orderBy: { joinedAt: 'desc' },
    });
  },

  // ──────────────────────────────────────────────
  // Participant tracking
  // ──────────────────────────────────────────────

  /**
   * Record a user joining a session.
   *
   * @param {string} sessionId - Session ID
   * @param {string} userId    - User ID
   * @returns {Promise<Object>} Participant record
   */
  async addParticipant(sessionId, userId) {
    return prisma.sessionParticipant.create({
      data: { sessionId, userId },
    });
  },

  /**
   * Record a user leaving a session (set leftAt timestamp).
   *
   * @param {string} sessionId - Session ID
   * @param {string} userId    - User ID
   */
  async removeParticipant(sessionId, userId) {
    // Find the most recent active participation record
    const participant = await prisma.sessionParticipant.findFirst({
      where: { sessionId, userId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });

    if (participant) {
      await prisma.sessionParticipant.update({
        where: { id: participant.id },
        data: { leftAt: new Date() },
      });
    }
  },
};

module.exports = sessionService;

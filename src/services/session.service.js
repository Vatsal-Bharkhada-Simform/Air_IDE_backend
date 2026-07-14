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
   * List all sessions a user has created or participated in.
   *
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Sessions array
   */
  async listUserSessions(userId) {
    const sessions = await prisma.session.findMany({
      where: {
        OR: [
          { createdBy: userId },
          { participants: { some: { userId } } },
        ],
      },
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

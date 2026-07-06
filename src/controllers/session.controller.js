const sessionService = require('../services/session.service');
const ApiError = require('../utils/api-error');

/**
 * Session controller — handles HTTP request/response for session
 * and file management. Business logic is delegated to sessionService.
 */
const sessionController = {
  /**
   * POST /api/sessions
   * Create a new collaboration session.
   *
   * Body: { name }
   * Response: { success, data: { session } }
   */
  async create(req, res, next) {
    try {
      const { name } = req.body;

      if (!name || !name.trim()) {
        throw ApiError.badRequest('Session name is required.');
      }

      const session = await sessionService.createSession({
        name: name.trim(),
        userId: req.user.id,
      });

      res.status(201).json({
        success: true,
        message: 'Session created successfully.',
        data: { session },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/sessions
   * List all sessions the current user has created or joined.
   *
   * Response: { success, data: { sessions } }
   */
  async list(req, res, next) {
    try {
      const sessions = await sessionService.listUserSessions(req.user.id);

      res.status(200).json({
        success: true,
        data: { sessions },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/sessions/:inviteCode
   * Get session details by invite code (used when joining via shared URL).
   *
   * Response: { success, data: { session } }
   */
  async getByInviteCode(req, res, next) {
    try {
      const { inviteCode } = req.params;
      const session = await sessionService.getSessionByInviteCode(inviteCode);

      res.status(200).json({
        success: true,
        data: { session },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/sessions/:id/files
   * Create a new file in a session.
   *
   * Body: { filename, language?, content? }
   * Response: { success, data: { file } }
   */
  async createFile(req, res, next) {
    try {
      const { id: sessionId } = req.params;
      const { filename, language, content } = req.body;

      if (!filename || !filename.trim()) {
        throw ApiError.badRequest('Filename is required.');
      }

      const file = await sessionService.createFile({
        sessionId,
        filename: filename.trim(),
        language,
        content,
      });

      res.status(201).json({
        success: true,
        message: 'File created successfully.',
        data: { file },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/sessions/:id/files
   * List all files in a session (metadata only, no content).
   *
   * Response: { success, data: { files } }
   */
  async listFiles(req, res, next) {
    try {
      const { id: sessionId } = req.params;
      const files = await sessionService.listSessionFiles(sessionId);

      res.status(200).json({
        success: true,
        data: { files },
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = sessionController;

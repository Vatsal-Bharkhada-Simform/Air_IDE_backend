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
     * Response: {
     *   success: boolean,
     *   message: string,
     *   data: {
     *     session: {
     *       id: string,
     *       name: string,
     *       inviteCode: string,
     *       createdBy: string,
     *       isActive: boolean,
     *       createdAt: string,
     *       updatedAt: string,
     *       creator: { id: string, username: string }
     *     }
     *   }
     * }
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
     * Response: {
     *   success: boolean,
     *   data: {
     *     sessions: [{
     *       id: string,
     *       name: string,
     *       inviteCode: string,
     *       createdBy: string,
     *       isActive: boolean,
     *       createdAt: string,
     *       updatedAt: string,
     *       creator: { id: string, username: string },
     *       _count: { files: number, participants: number }
     *     }]
     *   }
     * }
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
     * Response: {
     *   success: boolean,
     *   data: {
     *     session: {
     *       id: string,
     *       name: string,
     *       inviteCode: string,
     *       createdBy: string,
     *       isActive: boolean,
     *       createdAt: string,
     *       updatedAt: string,
     *       creator: { id: string, username: string },
     *       files: [{ id: string, filename: string, language: string, updatedAt: string }]
     *     }
     *   }
     * }
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
     * Response: {
     *   success: boolean,
     *   message: string,
     *   data: {
     *     file: {
     *       id: string,
     *       sessionId: string,
     *       filename: string,
     *       content: string,
     *       language: string,
     *       createdAt: string,
     *       updatedAt: string
     *     }
     *   }
     * }
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
     * Response: {
     *   success: boolean,
     *   data: {
     *     files: [{
     *       id: string,
     *       filename: string,
     *       language: string,
     *       createdAt: string,
     *       updatedAt: string
     *     }]
     *   }
     * }
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

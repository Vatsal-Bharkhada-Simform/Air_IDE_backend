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
     * GET /api/sessions?role=owner       — sessions the user created
     * GET /api/sessions?role=participant — sessions the user joined but doesn't own
     *
     * List sessions the current user is involved in, optionally filtered by role.
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
            // Only accept the two documented values; anything else is silently
            // ignored and falls through to the default (all sessions).
            const { role } = req.query;
            const validRole =
                role === 'owner' || role === 'participant' ? role : undefined;

            const sessions = await sessionService.listUserSessions(
                req.user.id,
                validRole
            );

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
     * PATCH /api/sessions/:id/status
     * Toggle the session's isActive flag (close or reopen).
     * Only the session owner may call this (enforced by requireSessionOwner middleware).
     *
     * Body: { isActive: boolean }
     * Response: {
     *   success: boolean,
     *   message: string,
     *   data: { session: { id, name, isActive, ... } }
     * }
     */
    async updateStatus(req, res, next) {
        try {
            const { id: sessionId } = req.params;
            const { isActive } = req.body;

            if (typeof isActive !== 'boolean') {
                throw ApiError.badRequest('isActive must be a boolean.');
            }

            const session = await sessionService.updateSessionStatus(sessionId, isActive);

            // Notify all connected clients so they can redirect / show a banner
            const io = req.app.get('io');
            if (io && !isActive) {
                io.to(sessionId).emit('session:ended', { sessionId });
            }

            res.status(200).json({
                success: true,
                message: `Session ${isActive ? 'reopened' : 'closed'} successfully.`,
                data: { session },
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * DELETE /api/sessions/:id
     * Permanently delete a session and all its files (cascade).
     * Only the session owner may call this (enforced by requireSessionOwner middleware).
     *
     * Response: 204 No Content
     */
    async deleteSession(req, res, next) {
        try {
            const { id: sessionId } = req.params;

            // Notify clients before the session is gone so they can clean up
            const io = req.app.get('io');
            if (io) {
                io.to(sessionId).emit('session:ended', { sessionId });
            }

            await sessionService.deleteSession(sessionId);

            res.status(204).send();
        } catch (error) {
            next(error);
        }
    },

    /**
     * GET /api/sessions/:id/participants
     * List participant history (join/leave times) for a session.
     * Only the session owner may call this (enforced by requireSessionOwner middleware).
     *
     * Response: {
     *   success: boolean,
     *   data: {
     *     participants: [{
     *       id: string,
     *       userId: string,
     *       joinedAt: string,
     *       leftAt: string | null,
     *       user: { id: string, username: string }
     *     }]
     *   }
     * }
     */
    async listParticipants(req, res, next) {
        try {
            const { id: sessionId } = req.params;
            const participants = await sessionService.getParticipants(sessionId);

            res.status(200).json({
                success: true,
                data: { participants },
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

            // Broadcast to all connected users in the session room so their
            // file lists update without requiring a manual refetch.
            // io is stored on the Express app instance in server.js via app.set('io', io).
            const io = req.app.get('io');
            if (io) {
                io.to(sessionId).emit('file:created', {
                    file: {
                        id: file.id,
                        filename: file.filename,
                        language: file.language,
                    },
                    createdBy: req.user.username,
                });
            }

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

    /**
     * GET /api/sessions/:id/files/:fileId
     * Get a single file's full content.
     *
     * Response: {
     *   success: boolean,
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
    async getFile(req, res, next) {
        try {
            const { fileId } = req.params;
            const file = await sessionService.getFileById(fileId);

            res.status(200).json({
                success: true,
                data: { file },
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * PATCH /api/sessions/:id/files/:fileId/rename
     * Rename a file within a session.
     *
     * Body: { newFilename: string }
     * Response: {
     *   success: boolean,
     *   message: string,
     *   data: { file: { id, filename, ... } }
     * }
     */
    async renameFile(req, res, next) {
        try {
            const { id: sessionId, fileId } = req.params;
            const { newFilename } = req.body;

            if (!newFilename || !newFilename.trim()) {
                throw ApiError.badRequest('New filename is required.');
            }

            const file = await sessionService.renameFile(fileId, newFilename.trim());

            const io = req.app.get('io');
            if (io) {
                io.to(sessionId).emit('file:renamed', {
                    fileId: file.id,
                    newFilename: file.filename,
                    renamedBy: req.user.username,
                });
            }

            res.status(200).json({
                success: true,
                message: 'File renamed successfully.',
                data: { file },
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * DELETE /api/sessions/:id/files/:fileId
     * Delete a file from a session.
     *
     * Response: 204 No Content
     */
    async deleteFile(req, res, next) {
        try {
            const { id: sessionId, fileId } = req.params;

            await sessionService.deleteFile(fileId);

            const io = req.app.get('io');
            if (io) {
                io.to(sessionId).emit('file:deleted', {
                    fileId,
                    deletedBy: req.user.username,
                });
            }

            res.status(204).send();
        } catch (error) {
            next(error);
        }
    },
};

module.exports = sessionController;

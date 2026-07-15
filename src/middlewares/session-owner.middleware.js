const prisma = require('../config/db');
const ApiError = require('../utils/api-error');

/**
 * Session Owner Middleware.
 *
 * Verifies that the authenticated user is the creator of the session
 * identified by `req.params.id`. Must be applied after `authMiddleware`
 * and on routes that use `:id` (the session UUID), not `:inviteCode`.
 *
 * Usage:
 *   router.delete('/:id', requireSessionOwner, sessionController.deleteSession);
 *
 * Throws:
 *   404 — if session not found
 *   403 — if authenticated user is not the session creator
 */
async function requireSessionOwner(req, res, next) {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { id: true, createdBy: true },
    });

    if (!session) {
      throw ApiError.notFound('Session not found.');
    }

    if (session.createdBy !== req.user.id) {
      throw ApiError.forbidden('Only the session owner can perform this action.');
    }

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireSessionOwner;

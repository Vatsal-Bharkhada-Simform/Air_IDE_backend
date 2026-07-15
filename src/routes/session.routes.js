const { Router } = require('express');
const sessionController = require('../controllers/session.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const requireSessionOwner = require('../middlewares/session-owner.middleware');

const router = Router();

/**
 * Session Routes — all routes require authentication.
 *
 * Route registration order matters:
 *   1. Static/exact paths and /:id/sub-routes are registered first.
 *   2. The bare /:inviteCode catch-all is registered last so it never
 *      shadow-matches paths like /:id/status, /:id/files, etc.
 *
 * POST   /api/sessions                                  → Create a new session
 * GET    /api/sessions                                  → List user's sessions
 *
 * PATCH  /api/sessions/:id/status       [owner only]    → Toggle isActive
 * DELETE /api/sessions/:id              [owner only]    → Hard-delete session (cascade files)
 * GET    /api/sessions/:id/participants  [owner only]   → Participant history
 *
 * POST   /api/sessions/:id/files                        → Create a file
 * GET    /api/sessions/:id/files                        → List files (metadata)
 * GET    /api/sessions/:id/files/:fileId                → Get file (with content)
 * PATCH  /api/sessions/:id/files/:fileId/rename         → Rename a file
 * DELETE /api/sessions/:id/files/:fileId                → Delete a file
 *
 * GET    /api/sessions/:inviteCode                      → Get session by invite code
 *                                                         (registered last — catch-all)
 */

// All session routes require authentication
router.use(authMiddleware);

// ── Collection routes ────────────────────────────────────────────────────────
router.post('/', sessionController.create);
router.get('/', sessionController.list);

// ── Session-level operations (owner only) ────────────────────────────────────
router.patch('/:id/status', requireSessionOwner, sessionController.updateStatus);
router.delete('/:id', requireSessionOwner, sessionController.deleteSession);
router.get('/:id/participants', requireSessionOwner, sessionController.listParticipants);

// ── File operations ──────────────────────────────────────────────────────────
router.post('/:id/files', sessionController.createFile);
router.get('/:id/files', sessionController.listFiles);
router.get('/:id/files/:fileId', sessionController.getFile);
router.patch('/:id/files/:fileId/rename', sessionController.renameFile);
router.delete('/:id/files/:fileId', sessionController.deleteFile);

// ── Invite-code lookup — registered last to avoid shadowing /:id/... routes ──
router.get('/:inviteCode', sessionController.getByInviteCode);

module.exports = router;

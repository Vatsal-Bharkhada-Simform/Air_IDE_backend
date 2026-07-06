const { Router } = require('express');
const sessionController = require('../controllers/session.controller');
const authMiddleware = require('../middlewares/auth.middleware');

const router = Router();

/**
 * Session Routes — all routes require authentication.
 *
 * POST   /api/sessions                → Create a new session
 * GET    /api/sessions                → List user's sessions
 * GET    /api/sessions/:inviteCode    → Get session by invite code
 * POST   /api/sessions/:id/files      → Create a file in a session
 * GET    /api/sessions/:id/files      → List files in a session
 */

// All session routes require authentication
router.use(authMiddleware);

router.post('/', sessionController.create);
router.get('/', sessionController.list);
router.get('/:inviteCode', sessionController.getByInviteCode);
router.post('/:id/files', sessionController.createFile);
router.get('/:id/files', sessionController.listFiles);

module.exports = router;

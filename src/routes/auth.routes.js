const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { signupRules, loginRules } = require('../validators/auth.validator');

const router = Router();

/**
 * Auth Routes
 *
 * POST   /api/auth/signup   → Register a new user
 * POST   /api/auth/login    → Authenticate & get JWT
 * POST   /api/auth/logout   → Invalidate current JWT (requires auth)
 * GET    /api/auth/me       → Get current user profile (requires auth)
 */

router.post('/signup', signupRules, authController.signup);
router.post('/login', loginRules, authController.login);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.me);

module.exports = router;

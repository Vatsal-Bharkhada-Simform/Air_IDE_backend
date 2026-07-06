const { validationResult } = require('express-validator');
const authService = require('../services/auth.service');
const ApiError = require('../utils/api-error');

/**
 * Auth controller — handles HTTP request/response for authentication.
 * Business logic is delegated to authService.
 */
const authController = {
    /**
     * POST /api/auth/signup
     * Register a new user account.
     *
     * Body: { username, email, password }
     * Response: {
     *   success: boolean,
     *   message: string,
     *   data: {
     *     user: { id: string, username: string, email: string, createdAt: string },
     *     token: string
     *   }
     * }
     */
    async signup(req, res, next) {
        try {
            // Check validation results
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw ApiError.badRequest(
                    'Validation failed.',
                    errors.array().map((e) => ({ field: e.path, message: e.msg }))
                );
            }

            const { username, email, password } = req.body;
            const user = await authService.signup({ username, email, password });
            const { token } = await authService.login({ email, password });

            // Set httpOnly cookie for browser clients
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 24 * 60 * 60 * 1000, // 1 day
            });

            res.status(201).json({
                success: true,
                message: 'Account created successfully.',
                data: { user, token },
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * POST /api/auth/login
     * Authenticate with email and password.
     *
     * Body: { email, password }
     * Response: {
     *   success: boolean,
     *   message: string,
     *   data: {
     *     user: { id: string, username: string, email: string },
     *     token: string
     *   }
     * }
     */
    async login(req, res, next) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw ApiError.badRequest(
                    'Validation failed.',
                    errors.array().map((e) => ({ field: e.path, message: e.msg }))
                );
            }

            const { email, password } = req.body;
            const { user, token } = await authService.login({ email, password });

            // Set httpOnly cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                maxAge: 24 * 60 * 60 * 1000,
            });

            res.status(200).json({
                success: true,
                message: 'Logged in successfully.',
                data: { user, token },
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * POST /api/auth/logout
     * Invalidate the current JWT by adding its jti to the blocklist.
     *
     * Requires: authMiddleware (provides req.tokenJti, req.tokenExp)
     * Response: {
     *   success: boolean,
     *   message: string
     * }
     */
    async logout(req, res, next) {
        try {
            // Block the current token
            await authService.blockToken(req.tokenJti, req.tokenExp);

            // Clear the httpOnly cookie
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            });

            res.status(200).json({
                success: true,
                message: 'Logged out successfully.',
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * GET /api/auth/me
     * Get the current authenticated user's profile.
     *
     * Requires: authMiddleware (provides req.user)
     * Response: {
     *   success: boolean,
     *   data: {
     *     user: { id: string, email: string, username: string }
     *   }
     * }
     */
    async me(req, res, next) {
        try {
            res.status(200).json({
                success: true,
                data: { user: req.user },
            });
        } catch (error) {
            next(error);
        }
    },
};

module.exports = authController;

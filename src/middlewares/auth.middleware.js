const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/db');
const ApiError = require('../utils/api-error');

/**
 * JWT Authentication Middleware.
 *
 * Extracts the JWT from either:
 *   1. Authorization header: "Bearer <token>"
 *   2. HttpOnly cookie: "token"
 *
 * Verifies the token signature and expiration, checks if the token
 * has been blocklisted (logout), and attaches the decoded user
 * payload to `req.user`.
 *
 * Usage:
 *   router.get('/protected', authMiddleware, handler);
 */
async function authMiddleware(req, res, next) {
  try {
    // ── Extract token ────────────────────────────
    let token = null;

    // Check Authorization header first (preferred for API clients)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // Fall back to httpOnly cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      throw ApiError.unauthorized('Authentication required. Please log in.');
    }

    // ── Verify token signature & expiration ──────
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Token has expired. Please log in again.');
      }
      throw ApiError.unauthorized('Invalid token.');
    }

    // ── Check if token is blocklisted (logged out) ─
    const blocked = await prisma.blockedToken.findUnique({
      where: { jti: decoded.jti },
    });

    if (blocked) {
      throw ApiError.unauthorized('Token has been revoked. Please log in again.');
    }

    // ── Attach user to request ───────────────────
    // Fetch avatarSeed from DB — it's not embedded in the JWT
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { avatarSeed: true },
    });

    req.user = {
      id: decoded.id,
      email: decoded.email,
      username: decoded.username,
      avatarSeed: dbUser?.avatarSeed ?? null,
    };

    // Store the raw token and jti for logout
    req.token = token;
    req.tokenJti = decoded.jti;
    req.tokenExp = decoded.exp;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authMiddleware;

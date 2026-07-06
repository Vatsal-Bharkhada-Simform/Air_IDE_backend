const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const prisma = require('../config/db');
const ApiError = require('../utils/api-error');

const SALT_ROUNDS = 12;

/**
 * Auth service — handles password hashing, JWT creation/verification,
 * and token blocklist operations.
 */
const authService = {
  // ──────────────────────────────────────────────
  // Password utilities
  // ──────────────────────────────────────────────

  /**
   * Hash a plaintext password with bcrypt.
   * @param {string} password - Plaintext password
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  /**
   * Compare a plaintext password against a hashed password.
   * @param {string} password     - Plaintext password
   * @param {string} passwordHash - Stored hash
   * @returns {Promise<boolean>} True if they match
   */
  async comparePassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash);
  },

  // ──────────────────────────────────────────────
  // JWT utilities
  // ──────────────────────────────────────────────

  /**
   * Generate a signed JWT for a user.
   * Includes a unique `jti` (JWT ID) for token revocation support.
   *
   * @param {Object} user - User object { id, email, username }
   * @returns {string} Signed JWT
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      username: user.username,
    };

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
      jwtid: crypto.randomUUID(), // Unique ID for blocklist support
    });
  },

  /**
   * Verify and decode a JWT.
   * @param {string} token - JWT string
   * @returns {Object} Decoded payload
   * @throws {ApiError} If token is invalid or expired
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Token has expired.');
      }
      throw ApiError.unauthorized('Invalid token.');
    }
  },

  // ──────────────────────────────────────────────
  // Token blocklist (for logout)
  // ──────────────────────────────────────────────

  /**
   * Add a token to the blocklist (effectively "logging out" that token).
   *
   * @param {string} jti       - JWT ID claim
   * @param {number} expiresAt - Token expiry as Unix timestamp (seconds)
   */
  async blockToken(jti, expiresAt) {
    await prisma.blockedToken.create({
      data: {
        jti,
        expiresAt: new Date(expiresAt * 1000), // Convert Unix seconds to Date
      },
    });
  },

  /**
   * Check if a token has been blocklisted.
   * @param {string} jti - JWT ID claim
   * @returns {Promise<boolean>} True if blocked
   */
  async isTokenBlocked(jti) {
    const blocked = await prisma.blockedToken.findUnique({
      where: { jti },
    });
    return !!blocked;
  },

  // ──────────────────────────────────────────────
  // User operations
  // ──────────────────────────────────────────────

  /**
   * Register a new user.
   * @param {Object} data - { username, email, password }
   * @returns {Promise<Object>} Created user (without password hash)
   * @throws {ApiError} If email or username already taken
   */
  async signup({ username, email, password }) {
    // Check for existing email
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw ApiError.conflict('An account with this email already exists.');
    }

    // Check for existing username
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      throw ApiError.conflict('This username is already taken.');
    }

    const passwordHash = await this.hashPassword(password);

    const user = await prisma.user.create({
      data: { username, email, passwordHash },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
      },
    });

    return user;
  },

  /**
   * Authenticate a user with email and password.
   * @param {Object} data - { email, password }
   * @returns {Promise<Object>} { user, token }
   * @throws {ApiError} If credentials are invalid
   */
  async login({ email, password }) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Use a generic message to prevent user enumeration
      throw ApiError.unauthorized('Invalid email or password.');
    }

    const isValid = await this.comparePassword(password, user.passwordHash);

    if (!isValid) {
      throw ApiError.unauthorized('Invalid email or password.');
    }

    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      token,
    };
  },
};

module.exports = authService;

const dotenv = require('dotenv');

// Load .env file into process.env
dotenv.config("../.env");

/**
 * Centralized environment configuration.
 * All env variables are accessed through this module to ensure
 * validation happens in one place and missing vars are caught early.
 */

const env = {
  /** Server port — defaults to 4000 */
  PORT: parseInt(process.env.PORT, 10) || 4000,

  /** Node environment — development | production | test */
  NODE_ENV: process.env.NODE_ENV || 'development',

  /** PostgreSQL connection string (required) */
  DATABASE_URL: process.env.DATABASE_URL,

  /** Secret key used to sign JWTs (required) */
  JWT_SECRET: process.env.JWT_SECRET,

  /** JWT expiration duration */
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',

  /** Allowed CORS origin(s) — comma-separated for multiple */
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
};

// ──────────────────────────────────────────────
// Validate required variables at startup
// ──────────────────────────────────────────────
const required = ['DATABASE_URL', 'JWT_SECRET'];

for (const key of required) {
  if (!env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
}

module.exports = env;

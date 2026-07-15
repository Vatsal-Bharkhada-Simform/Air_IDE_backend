const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const env = require('./config/env');
const errorMiddleware = require('./middlewares/error.middleware');

// Route imports
const authRoutes = require('./routes/auth.routes');
const sessionRoutes = require('./routes/session.routes');

const app = express();

// ──────────────────────────────────────────────
// Trust Proxy
// ──────────────────────────────────────────────

// Required when running behind a reverse proxy (e.g. Render, Heroku, Nginx).
// Tells Express to trust the first proxy hop so that X-Forwarded-For is used
// correctly for IP detection (needed for express-rate-limit to work properly).
app.set('trust proxy', 1);

// ──────────────────────────────────────────────
// Global Middleware
// ──────────────────────────────────────────────

// CORS — allow the configured frontend origin
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map(origin => origin.trim()),
    credentials: true, // Allow cookies to be sent cross-origin
  })
);

// Parse JSON request bodies (limit to 10MB for file content)
app.use(express.json({ limit: '10mb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Parse cookies (needed for httpOnly JWT cookie)
app.use(cookieParser());

// HTTP request logger — 'dev' in development, 'combined' in production
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ──────────────────────────────────────────────
// Rate Limiting
// ──────────────────────────────────────────────

// Strict rate limit on auth endpoints (prevent brute-force attacks)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 requests per window per IP
  message: {
    success: false,
    message: 'Too many requests. Please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General rate limit for all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running.',
    timestamp: new Date().toISOString(),
  });
});

// Auth routes with strict rate limiting
app.use('/api/auth', authLimiter, authRoutes);

// Session routes with general rate limiting
app.use('/api/sessions', apiLimiter, sessionRoutes);

// ──────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────

// Handle 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// Global error handler (must be last)
app.use(errorMiddleware);

module.exports = app;

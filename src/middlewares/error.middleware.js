const ApiError = require('../utils/api-error');

/**
 * Global error handling middleware.
 *
 * Catches all errors thrown in route handlers and middleware.
 * Returns a consistent JSON error response.
 *
 * Must be registered LAST in the Express middleware chain:
 *   app.use(errorMiddleware);
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  // Default to 500 if no status code is set
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  // Log unexpected (non-operational) errors for debugging
  if (!isOperational) {
    console.error('💥 Unexpected error:', err);
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    // Include validation errors if present (from express-validator)
    ...(err.errors && err.errors.length > 0 && { errors: err.errors }),
    // Include stack trace only in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorMiddleware;

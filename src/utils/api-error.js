/**
 * Custom API error class for consistent error handling.
 *
 * Usage:
 *   throw new ApiError(404, 'User not found');
 *   throw ApiError.badRequest('Invalid email format');
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code
   * @param {string} message    - Error message
   * @param {Array}  errors     - Optional array of validation errors
   */
  constructor(statusCode, message, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true; // Distinguishes expected errors from bugs

    Error.captureStackTrace(this, this.constructor);
  }

  // ── Factory methods ──────────────────────────

  static badRequest(message = 'Bad request', errors = []) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message);
  }
}

module.exports = ApiError;

class AppError extends Error {
  constructor(message, statusCode, code, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    
    // Captures stack trace, excluding constructor call from it.
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;

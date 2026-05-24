const AppError = require('./AppError');

class DatabaseError extends AppError {
  constructor(message, code = 'DATABASE_ERROR', statusCode = 500) {
    super(message, statusCode, code);
  }
}

module.exports = DatabaseError;

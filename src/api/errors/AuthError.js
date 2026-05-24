const AppError = require('./AppError');

class AuthError extends AppError {
  constructor(message, code = 'AUTH_ERROR') {
    super(message, 401, code);
  }
}

module.exports = AuthError;

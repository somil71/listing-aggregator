const AppError = require('./AppError');

class ValidationError extends AppError {
  constructor(message, field = null, code = 'VALIDATION_ERROR') {
    super(
      message, 
      400, 
      code, 
      field ? { field, message } : null
    );
  }
}

module.exports = ValidationError;

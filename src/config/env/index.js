const dotenvSafe = require('dotenv-safe');
const path = require('path');

// Ensure environment is set, fallback to development
const env = process.env.NODE_ENV || 'development';

// Load variables into process.env with safety check against .env.example
try {
  dotenvSafe.config({
    path: path.join(__dirname, '../../../.env'),
    example: path.join(__dirname, '../../../.env.example'),
    allowEmptyValues: true // some secrets might be empty in dev
  });
} catch (error) {
  if (error.name === 'MissingEnvVarsError') {
    console.error('❌ Environment configuration error. Missing variables:', error.missing);
    process.exit(1);
  }
}

// Load env-specific config file
const envConfig = require(`./${env}`);

module.exports = envConfig;

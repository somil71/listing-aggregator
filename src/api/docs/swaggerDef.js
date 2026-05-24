const swaggerJsdoc = require('swagger-jsdoc');
const envConfig = require('../../config/env');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Property Digest API',
      version: '1.0.0',
      description: 'API documentation for the Property Digest real estate platform.',
    },
    servers: [
      {
        url: `http://${envConfig.host}:${envConfig.port}/api/v1`,
        description: 'Development server (v1)',
      },
    ],
  },
  apis: ['./src/api/routes/*.js'], // Scan routes for JSDoc annotations
};

const specs = swaggerJsdoc(options);

module.exports = specs;

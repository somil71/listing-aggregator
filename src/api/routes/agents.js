const express = require('express');
const agentController = require('../controllers/agentController');
const { asyncHandler } = require('../middleware/errorHandler');
const { validatePaginationQuery } = require('../middleware/validateRequest');

const router = express.Router();

// GET /api/v1/agents
router.get(
  '/',
  validatePaginationQuery,
  asyncHandler(agentController.getAllAgents)
);

module.exports = router;

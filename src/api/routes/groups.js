const express = require('express');
const groupController = require('../controllers/groupController');
const { asyncHandler } = require('../middleware/errorHandler');
const { validatePaginationQuery } = require('../middleware/validateRequest');

const router = express.Router();

// GET /api/v1/groups
router.get(
  '/',
  validatePaginationQuery,
  asyncHandler(groupController.getAllGroups)
);

module.exports = router;

const express = require('express');
const searchController = require('../controllers/searchController');
const { asyncHandler } = require('../middleware/errorHandler');
const { validateSearchQuery } = require('../middleware/validateRequest');

const router = express.Router();

// GET /api/v1/search
router.get(
  '/',
  validateSearchQuery,
  asyncHandler(searchController.searchListings)
);

module.exports = router;

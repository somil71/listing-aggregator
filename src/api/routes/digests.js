const express = require('express');
const digestController = require('../controllers/digestController');
const { asyncHandler } = require('../middleware/errorHandler');
const { validateDateParam } = require('../middleware/validateRequest');

const router = express.Router();

// GET /api/v1/digests/:date
router.get(
  '/:date',
  validateDateParam,
  asyncHandler(digestController.getDigestForDate)
);

module.exports = router;

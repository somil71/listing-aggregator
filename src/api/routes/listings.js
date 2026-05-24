const express = require('express');
const listingController = require('../controllers/listingController');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  validateListingsQuery,
  validateListingId,
  validateNoteBody
} = require('../middleware/validateRequest');

const router = express.Router();

/**
 * @swagger
 * /listings/today:
 *   get:
 *     summary: Retrieve today's listings
 *     description: Fetch real-estate listings scraped today, with optional filters.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items to return
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *         description: Filter by location
 *     responses:
 *       200:
 *         description: A list of listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 */
// GET /api/v1/listings/today
router.get(
  '/today',
  validateListingsQuery,
  asyncHandler(listingController.getTodaysListings)
);

// GET /api/v1/listings/:id
router.get(
  '/:id',
  validateListingId,
  asyncHandler(listingController.getListingById)
);

// POST /api/v1/listings/:id/note
router.post(
  '/:id/note',
  validateListingId,
  validateNoteBody,
  asyncHandler(listingController.addNote)
);

module.exports = router;

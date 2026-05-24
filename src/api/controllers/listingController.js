const listingService = require('../services/listingService');
const formatters = require('../utils/formatters');

class ListingController {
  async getTodaysListings(req, res, next) {
    try {
      const result = await listingService.getTodaysListings(req.validatedQuery);
      res.json(formatters.success(result, 'Listings fetched successfully'));
    } catch (error) {
      next(error);
    }
  }

  async getListingById(req, res, next) {
    try {
      const { id } = req.validatedParams;
      const listing = await listingService.getListingById(id);
      res.json(formatters.success(listing, 'Listing fetched successfully'));
    } catch (error) {
      next(error);
    }
  }

  // Not directly in the original code, but stubbed based on the route note
  async addNote(req, res, next) {
    try {
      const { id } = req.validatedParams;
      const { note_text } = req.validatedBody;
      const { v4: uuidv4 } = require('uuid');
      const { getConnection } = require('../../db/connection');
      const queries = require('../../db/queries');
      
      const db = getConnection();
      const noteId = uuidv4();
      
      await db.run(queries.notes.insert, [noteId, id, note_text]);
      
      res.status(201).json(formatters.success({ id: noteId, listing_id: id, note_text }, 'Note added successfully', 201));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ListingController();

const listingService = require('../services/listingService');
const formatters = require('../utils/formatters');

class SearchController {
  async searchListings(req, res, next) {
    try {
      const { q, limit, offset } = req.validatedQuery;
      // Search is just a specialized call to listingService in this architecture
      // But keeping it separate allows future isolation (e.g., to Elasticsearch)
      
      const { getConnection } = require('../../db/connection');
      const queries = require('../../db/queries');
      const db = getConnection();
      
      const searchTerm = `%${q}%`;
      const params = [searchTerm, searchTerm, searchTerm, searchTerm, limit, offset];

      const [countResult, results] = await Promise.all([
        db.get(queries.search.count, [searchTerm, searchTerm, searchTerm, searchTerm]),
        db.all(queries.search.run, params)
      ]);

      const formattedResult = {
        results: results.map(formatters.listing),
        pagination: formatters.pagination(countResult?.count || 0, limit, offset)
      };

      res.json(formatters.success(formattedResult, `Found ${formattedResult.results.length} results`));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SearchController();

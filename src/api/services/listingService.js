const { getConnection } = require('../../db/connection');
const queries = require('../../db/queries');
const { errorLogger, queryLogger } = require('../middleware/logger');
const ERROR_CODES = require('../utils/errorCodes');
const formatters = require('../utils/formatters');

class ListingService {
  async getTodaysListings(filters) {
    try {
      const db = getConnection();
      const { limit, offset, min_confidence, ...filterParams } = filters;

      let sql = queries.listings.getToday;
      let filterClauses = [];
      let params = [];

      if (filterParams.location) {
        filterClauses.push('AND location = ?');
        params.push(filterParams.location);
      }
      if (filterParams.property_type) {
        filterClauses.push('AND property_type = ?');
        params.push(filterParams.property_type);
      }
      if (filterParams.min_price) {
        filterClauses.push('AND price >= ?');
        params.push(filterParams.min_price);
      }
      if (filterParams.max_price) {
        filterClauses.push('AND price <= ?');
        params.push(filterParams.max_price);
      }
      if (filterParams.agent_phone) {
        filterClauses.push('AND agent_phone = ?');
        params.push(filterParams.agent_phone);
      }
      if (filterParams.furnished !== null && filterParams.furnished !== undefined) {
        filterClauses.push('AND furnished = ?');
        params.push(filterParams.furnished ? 1 : 0);
      }

      // Inject dynamic WHERE clauses before ORDER BY
      if (filterClauses.length > 0) {
        const orderByIndex = sql.indexOf('ORDER BY');
        sql = sql.slice(0, orderByIndex) + filterClauses.join(' ') + ' ' + sql.slice(orderByIndex);
      }

      const countSql = sql
        .replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as count FROM')
        .replace(/ORDER BY[\s\S]*$/, '');

      const start = Date.now();
      
      const countParams = [min_confidence, ...params];
      const finalParams = [min_confidence, ...params, limit, offset];

      const [countResult, listings, statsResult] = await Promise.all([
        db.get(countSql, countParams),
        db.all(sql, finalParams),
        db.get(queries.listings.statsToday, [])
      ]);

      queryLogger('getTodaysListings (combined)', Date.now() - start);

      const total = countResult?.count || 0;

      return {
        listings: listings.map(formatters.listing),
        pagination: formatters.pagination(total, limit, offset),
        statistics: formatters.stats(statsResult)
      };
    } catch (error) {
      errorLogger(error, null, { service: 'ListingService', method: 'getTodaysListings' });
      throw error;
    }
  }

  async getListingById(id) {
    try {
      const db = getConnection();
      const start = Date.now();
      const listing = await db.get(queries.listings.getById, [id]);
      queryLogger(queries.listings.getById, Date.now() - start);
      
      if (!listing) {
        const error = new Error('Listing not found');
        error.errorCode = ERROR_CODES.LISTING_NOT_FOUND;
        throw error;
      }

      return formatters.listing(listing);
    } catch (error) {
      errorLogger(error, null, { service: 'ListingService', method: 'getListingById', id });
      throw error;
    }
  }
}

module.exports = new ListingService();

const { getConnection } = require('../../db/connection');
const queries = require('../../db/queries');
const { errorLogger, queryLogger } = require('../middleware/logger');
const formatters = require('../utils/formatters');

class DigestService {
  async getDigestForDate(dateStr) {
    try {
      const db = getConnection();
      const start = Date.now();

      // Get previous date count to calculate diff
      const date = new Date(dateStr);
      date.setDate(date.getDate() - 1);
      const prevDateStr = date.toISOString().split('T')[0];

      const [listings, topLocations, topAgents, prevCountResult] = await Promise.all([
        db.all(queries.digests.getForDate, [dateStr]),
        db.all(queries.digests.topLocations, [dateStr]),
        db.all(queries.digests.topAgents, [dateStr]),
        db.get(queries.digests.previousCount, [prevDateStr])
      ]);

      queryLogger('getDigestForDate (combined)', Date.now() - start);

      const prevCount = prevCountResult?.count || 0;
      const avgPrice = listings.length > 0 
        ? listings.reduce((sum, l) => sum + (l.price || 0), 0) / listings.length 
        : 0;

      return {
        date: dateStr,
        listings: listings.slice(0, 100).map(formatters.listing), // Limit returned to avoid giant payloads
        statistics: {
          total_listings: listings.length,
          new_from_previous: listings.length - prevCount,
          avg_price: Math.round(avgPrice)
        },
        top_locations: topLocations.map(l => ({
          location: l.location,
          count: l.count,
          avg_price: Math.round(l.avg_price || 0)
        })),
        top_agents: topAgents.map(a => ({
          phone: a.agent_phone,
          name: a.agent_name,
          count: a.count,
          avg_price: Math.round(a.avg_price || 0)
        }))
      };
    } catch (error) {
      errorLogger(error, null, { service: 'DigestService', method: 'getDigestForDate', dateStr });
      throw error;
    }
  }
}

module.exports = new DigestService();

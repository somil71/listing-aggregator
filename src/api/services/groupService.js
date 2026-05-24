const { getConnection } = require('../../db/connection');
const queries = require('../../db/queries');
const { errorLogger, queryLogger } = require('../middleware/logger');
const formatters = require('../utils/formatters');

class GroupService {
  async getAllGroups(limit, offset) {
    try {
      const db = getConnection();
      const start = Date.now();

      const [countResult, groups] = await Promise.all([
        db.get(queries.groups.countAll, []),
        db.all(queries.groups.getAll, [limit, offset])
      ]);

      queryLogger('getAllGroups (combined)', Date.now() - start);

      const total = countResult?.count || 0;

      return {
        groups: groups.map(g => ({
          name: g.group_name,
          listing_count: g.listing_count,
          unique_agents: g.unique_agents,
          avg_confidence: g.avg_confidence,
          last_update: g.last_update
        })),
        pagination: formatters.pagination(total, limit, offset)
      };
    } catch (error) {
      errorLogger(error, null, { service: 'GroupService', method: 'getAllGroups' });
      throw error;
    }
  }

  async getGroupListings(groupName, limit, offset) {
    try {
      const db = getConnection();
      const start = Date.now();
      
      const countSql = `SELECT COUNT(*) as count FROM listings WHERE group_name = ?`;
      
      const [countResult, listings] = await Promise.all([
        db.get(countSql, [groupName]),
        db.all(queries.groups.getListings, [groupName, limit, offset])
      ]);

      queryLogger('getGroupListings (combined)', Date.now() - start);

      const total = countResult?.count || 0;

      return {
        listings: listings.map(formatters.listing),
        pagination: formatters.pagination(total, limit, offset)
      };
    } catch (error) {
      errorLogger(error, null, { service: 'GroupService', method: 'getGroupListings', groupName });
      throw error;
    }
  }
}

module.exports = new GroupService();

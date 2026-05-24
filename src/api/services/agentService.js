const { getConnection } = require('../../db/connection');
const queries = require('../../db/queries');
const { errorLogger, queryLogger } = require('../middleware/logger');
const formatters = require('../utils/formatters');

class AgentService {
  async getAllAgents(limit, offset) {
    try {
      const db = getConnection();
      const start = Date.now();

      const [countResult, agents] = await Promise.all([
        db.get(queries.agents.countAll, []),
        db.all(queries.agents.getAll, [limit, offset])
      ]);

      queryLogger('getAllAgents (combined)', Date.now() - start);

      const total = countResult?.count || 0;

      return {
        agents: agents.map(a => ({
          phone: a.agent_phone,
          name: a.agent_name,
          listing_count: a.listing_count,
          avg_price: Math.round(a.avg_price || 0),
          group_count: a.group_count,
          last_listing: a.last_listing_date
        })),
        pagination: formatters.pagination(total, limit, offset)
      };
    } catch (error) {
      errorLogger(error, null, { service: 'AgentService', method: 'getAllAgents' });
      throw error;
    }
  }

  async getAgentListings(agentPhone, limit, offset) {
    try {
      const db = getConnection();
      const start = Date.now();
      
      // Need a dynamic count query for a specific agent
      const countSql = `SELECT COUNT(*) as count FROM listings WHERE agent_phone = ?`;
      
      const [countResult, listings] = await Promise.all([
        db.get(countSql, [agentPhone]),
        db.all(queries.agents.getListings, [agentPhone, limit, offset])
      ]);

      queryLogger('getAgentListings (combined)', Date.now() - start);

      const total = countResult?.count || 0;

      return {
        listings: listings.map(formatters.listing),
        pagination: formatters.pagination(total, limit, offset)
      };
    } catch (error) {
      errorLogger(error, null, { service: 'AgentService', method: 'getAgentListings', agentPhone });
      throw error;
    }
  }
}

module.exports = new AgentService();

const agentService = require('../services/agentService');
const formatters = require('../utils/formatters');

class AgentController {
  async getAllAgents(req, res, next) {
    try {
      const { limit, offset } = req.validatedQuery;
      const result = await agentService.getAllAgents(limit, offset);
      res.json(formatters.success(result, 'Agents fetched successfully'));
    } catch (error) {
      next(error);
    }
  }

  // Optional: Endpoint for specific agent's listings
  async getAgentListings(req, res, next) {
    try {
      // Assuming agent_phone is passed as a param like /api/agents/:phone/listings
      const { phone } = req.params;
      const { limit, offset } = req.validatedQuery;
      
      const result = await agentService.getAgentListings(phone, limit, offset);
      res.json(formatters.success(result, 'Agent listings fetched successfully'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AgentController();

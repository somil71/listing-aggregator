const groupService = require('../services/groupService');
const formatters = require('../utils/formatters');

class GroupController {
  async getAllGroups(req, res, next) {
    try {
      const { limit, offset } = req.validatedQuery;
      const result = await groupService.getAllGroups(limit, offset);
      res.json(formatters.success(result, 'Groups fetched successfully'));
    } catch (error) {
      next(error);
    }
  }

  // Optional: Endpoint for specific group's listings
  async getGroupListings(req, res, next) {
    try {
      // Assuming group name is passed as a query param or route param
      const { name } = req.params;
      const { limit, offset } = req.validatedQuery;
      
      const result = await groupService.getGroupListings(name, limit, offset);
      res.json(formatters.success(result, 'Group listings fetched successfully'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new GroupController();

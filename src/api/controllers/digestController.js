const digestService = require('../services/digestService');
const formatters = require('../utils/formatters');

class DigestController {
  async getDigestForDate(req, res, next) {
    try {
      const { date } = req.validatedParams;
      const result = await digestService.getDigestForDate(date);
      res.json(formatters.success(result, `Digest for ${date} fetched successfully`));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DigestController();

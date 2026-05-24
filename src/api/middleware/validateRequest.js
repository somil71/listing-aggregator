const { validators, ValidationError } = require('../utils/validators');

// Validate + normalise query params for listing endpoints
const validateListingsQuery = (req, res, next) => {
  try {
    const { min_price, max_price, limit, offset, min_confidence, furnished } = req.query;

    const minP = min_price ? parseInt(min_price, 10) : null;
    const maxP = max_price ? parseInt(max_price, 10) : null;
    validators.validatePriceRange(minP, maxP);

    const { limit: validLimit, offset: validOffset } = validators.validatePagination(limit, offset);

    req.validatedQuery = {
      min_price: minP,
      max_price: maxP,
      location: req.query.location || null,
      property_type: req.query.property_type || null,
      agent_phone: req.query.agent_phone || null,
      furnished: furnished === 'true' ? true : furnished === 'false' ? false : null,
      min_confidence: min_confidence ? parseFloat(min_confidence) : 0.5,
      limit: validLimit,
      offset: validOffset
    };

    next();
  } catch (err) {
    next(err);
  }
};

// Validate search query string
const validateSearchQuery = (req, res, next) => {
  try {
    const { q, limit, offset } = req.query;
    const query = validators.validateSearchQuery(q);
    const { limit: validLimit, offset: validOffset } = validators.validatePagination(limit, offset);
    req.validatedQuery = { q: query, limit: validLimit, offset: validOffset };
    next();
  } catch (err) {
    next(err);
  }
};

// Validate YYYY-MM-DD date in route params
const validateDateParam = (req, res, next) => {
  try {
    const validDate = validators.validateDateFormat(req.params.date);
    req.validatedParams = { ...req.validatedParams, date: validDate };
    next();
  } catch (err) {
    next(err);
  }
};

// Validate UUID-style listing id in route params
const validateListingId = (req, res, next) => {
  try {
    const validId = validators.validateId(req.params.id);
    req.validatedParams = { ...req.validatedParams, id: validId };
    next();
  } catch (err) {
    next(err);
  }
};

// Validate note body
const validateNoteBody = (req, res, next) => {
  try {
    const validNote = validators.validateNoteText(req.body.note_text);
    req.validatedBody = { note_text: validNote };
    next();
  } catch (err) {
    next(err);
  }
};

// General pagination-only validation (for agents, groups)
const validatePaginationQuery = (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    const { limit: validLimit, offset: validOffset } = validators.validatePagination(limit, offset);
    req.validatedQuery = { limit: validLimit, offset: validOffset };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  validateListingsQuery,
  validateSearchQuery,
  validateDateParam,
  validateListingId,
  validateNoteBody,
  validatePaginationQuery
};

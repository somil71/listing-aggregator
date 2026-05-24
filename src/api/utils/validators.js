const ERROR_CODES = require('./errorCodes');
const { PAGINATION } = require('./constants');
const ValidationError = require('../errors/ValidationError');

const validators = {
  validatePriceRange(minPrice, maxPrice) {
    if (minPrice !== null && minPrice < 0) {
      throw new ValidationError('Min price cannot be negative', 'min_price');
    }
    if (maxPrice !== null && maxPrice < 0) {
      throw new ValidationError('Max price cannot be negative', 'max_price');
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      throw new ValidationError('Min price cannot exceed max price', 'price_range', ERROR_CODES.INVALID_PRICE_RANGE.code);
    }
  },

  validateDateFormat(date) {
    if (!date) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ValidationError('Date must be in YYYY-MM-DD format', 'date', ERROR_CODES.INVALID_DATE_FORMAT.code);
    }
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      throw new ValidationError('Invalid date value', 'date', ERROR_CODES.INVALID_DATE_FORMAT.code);
    }
    return date;
  },

  validatePagination(limit, offset) {
    let parsedLimit = limit ? parseInt(limit, 10) : PAGINATION.DEFAULT_LIMIT;
    let parsedOffset = offset ? parseInt(offset, 10) : 0;

    if (isNaN(parsedLimit) || parsedLimit < PAGINATION.MIN_LIMIT) parsedLimit = PAGINATION.DEFAULT_LIMIT;
    if (parsedLimit > PAGINATION.MAX_LIMIT) parsedLimit = PAGINATION.MAX_LIMIT;
    if (isNaN(parsedOffset) || parsedOffset < 0) parsedOffset = 0;

    return { limit: parsedLimit, offset: parsedOffset };
  },

  validateSearchQuery(q) {
    if (!q || q.trim().length < 2) {
      throw new ValidationError('Search query must be at least 2 characters', 'q', ERROR_CODES.SEARCH_QUERY_TOO_SHORT.code);
    }
    return q.trim();
  },

  validateNoteText(text) {
    if (!text || text.trim().length === 0) {
      throw new ValidationError('Note cannot be empty', 'note_text', ERROR_CODES.MISSING_REQUIRED_FIELD.code);
    }
    if (text.trim().length > 500) {
      throw new ValidationError('Note cannot exceed 500 characters', 'note_text');
    }
    return text.trim();
  },

  validateId(id) {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new ValidationError('Invalid ID', 'id');
    }
    return id.trim();
  }
};

module.exports = { validators, ValidationError };

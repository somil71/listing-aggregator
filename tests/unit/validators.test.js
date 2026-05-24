const { validators, ValidationError } = require('../../src/api/utils/validators');

describe('Validators', () => {
  describe('validatePriceRange', () => {
    it('should throw if minPrice > maxPrice', () => {
      expect(() => validators.validatePriceRange(2000, 1000)).toThrow(ValidationError);
    });

    it('should pass if minPrice <= maxPrice', () => {
      expect(() => validators.validatePriceRange(1000, 2000)).not.toThrow();
    });
  });

  describe('validateDateFormat', () => {
    it('should throw on invalid format', () => {
      expect(() => validators.validateDateFormat('2023/05/24')).toThrow(ValidationError);
    });

    it('should return date on valid format', () => {
      expect(validators.validateDateFormat('2023-05-24')).toBe('2023-05-24');
    });
  });

  describe('validateSearchQuery', () => {
    it('should throw if query is too short', () => {
      expect(() => validators.validateSearchQuery('a')).toThrow(ValidationError);
    });

    it('should return trimmed query if valid', () => {
      expect(validators.validateSearchQuery(' test ')).toBe('test');
    });
  });
});

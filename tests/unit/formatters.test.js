const formatters = require('../../src/api/utils/formatters');

describe('Formatters', () => {
  describe('success', () => {
    it('should wrap data in success envelope', () => {
      const result = formatters.success({ id: 1 }, 'OK');
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data.id).toBe(1);
      expect(result.message).toBe('OK');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('pagination', () => {
    it('should calculate pages correctly', () => {
      const result = formatters.pagination(100, 20, 0);
      expect(result.total).toBe(100);
      expect(result.total_pages).toBe(5);
      expect(result.current_page).toBe(1);
      expect(result.has_more).toBe(true);
    });
    
    it('should calculate has_more correctly at the end', () => {
      const result = formatters.pagination(100, 20, 80);
      expect(result.has_more).toBe(false);
      expect(result.current_page).toBe(5);
    });
  });
});

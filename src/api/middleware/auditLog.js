const logger = require('../../config/logger');
const pg     = require('../../db/postgres/pool');

/**
 * Audit log middleware factory.
 * Must be used AFTER the authenticate middleware (needs req.userId).
 *
 * Writes to the Postgres `audit_log` table (not SQLite).
 * Failures are silently swallowed so they never block the request.
 *
 * Usage:
 *   router.get('/listings', authenticate, auditLog('view_listings', 'listing'), handler);
 */
function auditLog(action, resourceType) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return; // only log successful actions

      const resourceId = req.params?.id || null;
      // Use the real socket peer address — `x-forwarded-for` is trivially
      // spoofable by any client and must NEVER be used in audit logs.
      const ip = req.socket?.remoteAddress || 'unknown';
      const ua = req.get('user-agent') || 'unknown';

      // Fire-and-forget — do not await; never block the response
      pg.query(
        `INSERT INTO audit_log (user_id, action, resource, metadata)
         SELECT u.id, $1, $2, $3::jsonb
           FROM users u
          WHERE u.clerk_user_id = $4`,
        [
          action,
          resourceType,
          JSON.stringify({ resourceId, ip, userAgent: ua }),
          req.userId || '',
        ]
      ).catch(err => logger.warn('Audit log insert failed', { error: err.message }));
    });

    next();
  };
}

module.exports = auditLog;

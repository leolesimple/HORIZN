'use strict';

/**
 * Rate limiting middleware basé sur rate-limiter-flexible.
 *
 * Limites par défaut :
 *   - Routes publiques : 100 req/min par IP
 *   - Routes admin :     30 req/min par IP
 *   - /search :          20 req/min par IP (plus intensif)
 *
 * Les limites sont en mémoire (RateLimiterMemory) — reset au redémarrage.
 * Pour du multi-instance, faudrait passer par Redis/Memcached.
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');

// ---------- Limiteurs ----------

const publicLimiter = new RateLimiterMemory({
  points:    100,  // 100 requêtes
  duration:   60,  // par 60 secondes
  blockDuration: 30, // 30s de blocage si dépassé
});

const adminLimiter = new RateLimiterMemory({
  points:    30,
  duration:   60,
  blockDuration: 60,
});

const searchLimiter = new RateLimiterMemory({
  points:    20,
  duration:   60,
  blockDuration: 60,
});

const nextLimiter = new RateLimiterMemory({
  points:    60,
  duration:   60,
  blockDuration: 30,
});

// ---------- Middleware ----------

/**
 * Rate limiter pour les routes publiques.
 */
function rateLimitPublic(req, res, next) {
  const key = req.ip || req.connection?.remoteAddress || 'unknown';
  publicLimiter.consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({
        error: 'Trop de requêtes. Réessayez dans quelques instants.',
        retryAfter: '30s',
      });
    });
}

/**
 * Rate limiter pour les routes admin.
 */
function rateLimitAdmin(req, res, next) {
  const key = req.ip || req.connection?.remoteAddress || 'unknown';
  adminLimiter.consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({
        error: 'Trop de requêtes admin. Réessayez dans 60s.',
        retryAfter: '60s',
      });
    });
}

/**
 * Rate limiter spécifique pour /search.
 */
function rateLimitSearch(req, res, next) {
  const key = req.ip || req.connection?.remoteAddress || 'unknown';
  searchLimiter.consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({
        error: 'Trop de recherches. Réessayez dans 60s.',
        retryAfter: '60s',
      });
    });
}

/**
 * Rate limiter spécifique pour /next.
 */
function rateLimitNext(req, res, next) {
  const key = req.ip || req.connection?.remoteAddress || 'unknown';
  nextLimiter.consume(key)
    .then(() => next())
    .catch(() => {
      res.status(429).json({
        error: 'Trop de requêtes Next. Réessayez dans 30s.',
        retryAfter: '30s',
      });
    });
}

module.exports = { rateLimitPublic, rateLimitAdmin, rateLimitSearch, rateLimitNext };

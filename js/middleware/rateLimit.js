'use strict';

/**
 * Rate limiting middleware basé sur rate-limiter-flexible.
 *
 * Quota PAR CLÉ API :
 *   - Requête avec une clé API connue  → quota indexé sur sha256(clé)
 *   - Requête sans clé (ou clé inconnue) → quota indexé sur l'IP
 *
 * Le rate limiting s'exécute AVANT l'auth : le fallback IP protège donc contre
 * les rafales non authentifiées (brute-force de clés). Toutes les routes
 * limitées exigeant ensuite une clé valide, le quota effectif d'un client
 * légitime est bien celui de sa clé.
 *
 * Limites (points / 60 s) :
 *   - public : 100    (/timetable, /traffic, /equipments, /status)
 *   - next   :  60    (/next, /nextTrains)
 *   - admin  :  30    (/admin/*)
 *   - search :  20    (/search)
 *
 * Stockage en mémoire (RateLimiterMemory) — reset au redémarrage.
 * Pour du multi-instance, il faudrait passer par Redis/Memcached.
 */

const crypto = require('crypto');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { isKnownKey } = require('./auth');

// ---------- Limiteurs ----------

const LIMITERS = {
  public: new RateLimiterMemory({ points: 100, duration: 60, blockDuration: 30 }),
  next:   new RateLimiterMemory({ points: 60,  duration: 60, blockDuration: 30 }),
  admin:  new RateLimiterMemory({ points: 30,  duration: 60, blockDuration: 60 }),
  search: new RateLimiterMemory({ points: 20,  duration: 60, blockDuration: 60 }),
};

// ---------- Identification du quota ----------

function _hash(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32);
}

/**
 * Identifiant de quota pour la requête :
 *   'k:<hash>' pour une clé API connue, 'ip:<ip>' sinon.
 */
function _quotaId(req) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && isKnownKey(apiKey)) return `k:${_hash(apiKey)}`;
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

// ---------- Middleware ----------

function _middleware(limiter, retryAfter, message) {
  return (req, res, next) => {
    limiter.consume(_quotaId(req))
      .then(() => next())
      .catch(() => res.status(429).json({ error: message, retryAfter }));
  };
}

const rateLimitPublic = _middleware(LIMITERS.public, '30s', 'Trop de requêtes. Réessayez dans quelques instants.');
const rateLimitAdmin  = _middleware(LIMITERS.admin,  '60s', 'Trop de requêtes admin. Réessayez dans 60s.');
const rateLimitSearch = _middleware(LIMITERS.search, '60s', 'Trop de recherches. Réessayez dans 60s.');
const rateLimitNext   = _middleware(LIMITERS.next,   '30s', 'Trop de requêtes Next. Réessayez dans 30s.');

// ---------- Introspection (GET /admin/keys) ----------

/**
 * Consommation de quota courante d'une clé API, par classe de route.
 * Lecture seule — ne consomme aucun point.
 *
 * @param {string} apiKey
 * @returns {Promise<object>} { public, next, admin, search, worstPct }
 */
async function getUsage(apiKey) {
  const id = `k:${_hash(apiKey)}`;
  const out = {};

  for (const [name, limiter] of Object.entries(LIMITERS)) {
    const res      = await Promise.resolve(limiter.get(id));
    const limit    = limiter.points;
    const consumed = res ? res.consumedPoints : 0;
    out[name] = {
      limit,
      consumed,
      remaining:      Math.max(0, limit - consumed),
      usedPct:        Math.min(100, Math.round((consumed / limit) * 100)),
      blocked:        consumed > limit,
      resetInSeconds: res && res.msBeforeNext ? Math.ceil(res.msBeforeNext / 1000) : 0,
    };
  }

  out.worstPct = Math.max(0, ...Object.values(out).map(q => q.usedPct));
  return out;
}

module.exports = { rateLimitPublic, rateLimitAdmin, rateLimitSearch, rateLimitNext, getUsage };

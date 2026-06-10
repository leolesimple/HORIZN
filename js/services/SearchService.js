'use strict';

const axios  = require('axios');

const API_KEY      = process.env.PRIM_API_KEY || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const NAVITIA_BASE = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';
const TIMEOUT_MS   = 8000;
const CACHE_TTL_MS = 24 * 3600 * 1000; // 24 heures (les arrêts bougent rarement)

// Cache en mémoire { query: { data, ts } }
const cache = {};

/**
 * Recherche des arrêts/gares/lieux par nom.
 *
 * @param {string}  query  – Texte de recherche (ex: "austerlitz", "la défense")
 * @param {object}  [opts]
 * @param {number}  [opts.count=10]  – Max de résultats
 * @returns {Promise<Array>}
 */
async function search(query, opts = {}) {
  const count = opts.count || 10;

  // Vérifier le cache
  const cacheKey = `${query}:${count}`;
  const cached = cache[cacheKey];
  const now = Date.now();
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    return cached.data;
  }

  const resp = await axios.get(`${NAVITIA_BASE}/places`, {
    params: {
      q:       query,
      type:    ['stop_area'],
      count,
    },
    headers: {
      accept: 'application/json',
      apikey: API_KEY,
    },
    timeout: TIMEOUT_MS,
  });

  const places = resp.data?.places || [];

  const results = places.map(p => ({
    id:        p.id || null,
    name:      p.name || null,
    stopArea: {
      id:       p.stop_area?.id       || null,
      name:     p.stop_area?.name     || null,
      label:    p.stop_area?.label    || null,
      city:     p.stop_area?.city?.name || null,
      zipCode:  p.stop_area?.zip_code || null,
      timezone: p.stop_area?.timezone || null,
      coord:    p.stop_area?.coord    || null,
    },
    distance: p.distance || null,
    quality:  p.quality || null,
  }));

  // Mettre en cache
  cache[cacheKey] = { data: results, ts: now };

  return results;
}

module.exports = { search };

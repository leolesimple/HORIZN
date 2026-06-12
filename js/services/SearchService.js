'use strict';

const axios        = require('axios');
const fs           = require('fs');
const path         = require('path');
const cacheService = require('./CacheService');

const API_KEY=process.env.PRIM_KEY || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const NAVITIA_BASE = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';
const TIMEOUT_MS   = 8000;
const CACHE_TTL_SEC = 24 * 3600; // 24 heures (les arrêts bougent rarement)

// ---- Index zdaid (chargé une seule fois) ----
let _zdaidByName  = null; // Map<nom_normalisé, [{zdaid, arrtype}]>
let _zdaidByCoord = null; // QuadTree simplifié par grille 0.01°

function _normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _loadZdaidIndex() {
  if (_zdaidByName) return;

  const stopsPath = process.env.STOPS_MAP_PATH
    ? path.resolve(process.env.STOPS_MAP_PATH)
    : path.join(__dirname, '../../json/arrets-stopPoint.json');

  if (!fs.existsSync(stopsPath)) {
    console.warn(`[SearchService] Fichier stops introuvable : ${stopsPath}`);
    _zdaidByName = new Map();
    return;
  }

  const raw = JSON.parse(fs.readFileSync(stopsPath, 'utf-8'));
  _zdaidByName = new Map();

  for (const s of raw) {
    const key  = _normalize(s.arrname);
    const key2 = _normalize(s.arrname + ' ' + (s.arrtown || ''));

    const entry = { zdaid: s.zdaid, arrtype: s.arrtype, name: s.arrname };

    if (!_zdaidByName.has(key))  _zdaidByName.set(key, []);
    _zdaidByName.get(key).push(entry);

    if (key2 !== key) {
      if (!_zdaidByName.has(key2)) _zdaidByName.set(key2, []);
      _zdaidByName.get(key2).push(entry);
    }
  }

  console.log(`[SearchService] Index zdaid chargé : ${_zdaidByName.size} entrées`);
}

/**
 * Recherche des arrêts/gares/lieux par nom, enrichie avec les zdaid.
 *
 * @param {string}  query  – Texte de recherche (ex: "austerlitz", "la défense")
 * @param {object}  [opts]
 * @param {number}  [opts.count=10]  – Max de résultats
 * @returns {Promise<Array>}
 */
async function search(query, opts = {}) {
  const count = opts.count || 10;

  // Vérifier le cache (fichier, persistant entre redémarrages)
  const cacheKey = `v2:${query}:${count}`;
  const cached = cacheService.get(cacheKey, CACHE_TTL_SEC);
  if (cached) {
    return cached;
  }

  // Charger l'index zdaid (une seule fois)
  _loadZdaidIndex();

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

  const results = places.map(p => {
    const name = p.stop_area?.name || p.name || '';
    const city = p.stop_area?.city?.name || '';
    const normName = _normalize(name);
    const normFull = _normalize(name + ' ' + city);

    // Chercher les zdaid correspondants
    const matches = _zdaidByName.get(normFull) || _zdaidByName.get(normName) || [];
    const zdaids = [...new Map(matches.map(m => [m.zdaid, m])).values()]; // dédoublonné par zdaid

    return {
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
      zdaids: zdaids.map(m => m.zdaid),
      distance: p.distance || null,
      quality:  p.quality || null,
    };
  });

  // Mettre en cache (fichier)
  cacheService.set(cacheKey, results);

  return results;
}

module.exports = { search };

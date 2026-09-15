'use strict';

const axios        = require('axios');
const fs           = require('fs');
const path         = require('path');
const cacheService = require('./CacheService');

const API_KEY = process.env.PRIM_API_KEY;
const NAVITIA_BASE = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';
const TIMEOUT_MS   = 8000;
const CACHE_TTL_SEC = 24 * 3600; // 24 heures (les arrêts bougent rarement)

const GRID_STEP       = 0.01;  // taille de cellule en degrés (~1.1 km en latitude IDF)
const METERS_PER_CELL = 1000;  // approximation prudente pour le calcul du rayon de recherche
const DEFAULT_RADIUS_M = 1000;
const MAX_RADIUS_M     = 5000;

// ---- Index zdaid (chargé une seule fois) ----
let _zdaidByName  = null; // Map<nom_normalisé, [{zdaid, arrtype}]>
let _zdaidByCoord = null; // Map<"cellLat:cellLon", [{zdaid, name, town, type, lat, lon}]> — grille 0.01°

function _normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _gridCell(lat, lon) {
  return `${Math.floor(lat / GRID_STEP)}:${Math.floor(lon / GRID_STEP)}`;
}

function _haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function _loadZdaidIndex() {
  if (_zdaidByName) return;

  const stopsPath = process.env.STOPS_MAP_PATH
    ? path.resolve(process.env.STOPS_MAP_PATH)
    : path.join(__dirname, '../../json/arrets-stopPoint.json');

  if (!fs.existsSync(stopsPath)) {
    console.warn(`[SearchService] Fichier stops introuvable : ${stopsPath}`);
    _zdaidByName  = new Map();
    _zdaidByCoord = new Map();
    return;
  }

  const raw = JSON.parse(fs.readFileSync(stopsPath, 'utf-8'));
  _zdaidByName  = new Map();
  _zdaidByCoord = new Map();

  // Une "station" (zone d'arrêt, zdaid) regroupe plusieurs arrêts physiques
  // (quais/points d'arrêt) quasi-identiques en position : on en garde un
  // représentant par zdaid pour la recherche géographique.
  const stationsByZdaid = new Map();

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

    if (!stationsByZdaid.has(s.zdaid) && s.arrgeopoint) {
      stationsByZdaid.set(s.zdaid, {
        zdaid:   s.zdaid,
        name:    s.arrname,
        town:    s.arrtown || null,
        type:    s.arrtype || null,
        zipCode: s.arrpostalregion || null,
        lat:     s.arrgeopoint.lat,
        lon:     s.arrgeopoint.lon,
      });
    }
  }

  for (const station of stationsByZdaid.values()) {
    const cell = _gridCell(station.lat, station.lon);
    if (!_zdaidByCoord.has(cell)) _zdaidByCoord.set(cell, []);
    _zdaidByCoord.get(cell).push(station);
  }

  console.log(`[SearchService] Index zdaid chargé : ${_zdaidByName.size} entrées nom, ${stationsByZdaid.size} stations géolocalisées`);
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

  // Vérifier le cache (SQLite, persistant entre redémarrages)
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

  // Mettre en cache (SQLite)
  cacheService.set(cacheKey, results);

  return results;
}

/**
 * Recherche des stations à proximité d'un point (recherche 100% locale,
 * sans appel PRIM), via l'index géographique par grille 0.01°.
 *
 * @param {number}  lat
 * @param {number}  lon
 * @param {object}  [opts]
 * @param {number}  [opts.count=10]              – Max de résultats
 * @param {number}  [opts.radius=DEFAULT_RADIUS_M] – Rayon de recherche en mètres
 * @returns {Promise<Array>}
 */
async function searchNearby(lat, lon, opts = {}) {
  const count  = Math.min(opts.count || 10, 50);
  const radius = Math.min(opts.radius || DEFAULT_RADIUS_M, MAX_RADIUS_M);

  const cacheKey = `nearby:${lat.toFixed(4)}:${lon.toFixed(4)}:${radius}:${count}`;
  const cached = cacheService.get(cacheKey, CACHE_TTL_SEC);
  if (cached) {
    return cached;
  }

  _loadZdaidIndex();

  const cellRadius     = Math.max(1, Math.ceil(radius / METERS_PER_CELL));
  const centerCellLat  = Math.floor(lat / GRID_STEP);
  const centerCellLon  = Math.floor(lon / GRID_STEP);

  const candidates = [];
  for (let dLat = -cellRadius; dLat <= cellRadius; dLat++) {
    for (let dLon = -cellRadius; dLon <= cellRadius; dLon++) {
      const bucket = _zdaidByCoord.get(`${centerCellLat + dLat}:${centerCellLon + dLon}`);
      if (bucket) candidates.push(...bucket);
    }
  }

  const results = candidates
    .map(s => ({ ...s, distance: Math.round(_haversineMeters(lat, lon, s.lat, s.lon)) }))
    .filter(s => s.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map(s => ({
      id:   `stop_area:IDFM:${s.zdaid}`,
      name: s.name,
      stopArea: {
        id:       `stop_area:IDFM:${s.zdaid}`,
        name:     s.name,
        label:    s.town ? `${s.name} (${s.town})` : s.name,
        city:     s.town,
        zipCode:  s.zipCode,
        timezone: 'Europe/Paris',
        coord:    { lat: s.lat, lon: s.lon },
      },
      zdaids:   [s.zdaid],
      distance: s.distance,
      quality:  null,
    }));

  cacheService.set(cacheKey, results);

  return results;
}

module.exports = { search, searchNearby };

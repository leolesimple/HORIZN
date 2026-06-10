'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const fs         = require('fs');
const path       = require('path');

const departures = require('./services/DeparturesService');
const gtfs       = require('./services/GTFSService');
const traffic    = require('./services/TrafficService');
const search     = require('./services/SearchService');
const equipment  = require('./services/EquipmentService');

const app  = express();
const PORT = process.env.PORT || 3000;
const QUIET_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.QUIET_MODE || '').toLowerCase());

const HORIZN_ASCII = [
  '  _  _  ___  ___ ___ _____  _ ',
  '| || |/ _ \\| _ \\_ _|_  / \\| |',
  '| __ | (_) |   /| | / /| .` |',
  '|_||_|\\___/|_|_\\___/___|_|\\_|',
].join('\n');

// Chargement de la carte des arrêts (arrets-stopPoint.json)
const STOPS_MAP_PATH = process.env.STOPS_MAP_PATH
  || path.join(__dirname, '..', 'json', 'arrets-stopPoint.json');

let stopsMap = [];
try {
  stopsMap = JSON.parse(fs.readFileSync(STOPS_MAP_PATH, 'utf-8'));
} catch (err) {
  console.error(`[ERROR] Chargement des arrêts impossible (${STOPS_MAP_PATH}): ${err.message}`);
}

// Domaines autorisés
const ALLOWED_ORIGINS = [
  'https://infostation.fr',
  'https://beta.infostation.fr',
];

// Validation de l'origine
function isOriginAllowed(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ALLOWED_ORIGINS.some(allowed => new URL(allowed).hostname === url.hostname);
  } catch {
    return false;
  }
}

// CORS + restriction d'origine
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // On check Origin d'abord, puis Referer en fallback (pour les requêtes directes)
  const source = origin || referer;

  if (source && !isOriginAllowed(source)) {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }

  if (origin && isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ---------- GET /next | /nextTrains ----------
// Retourne les départs fusionnés GTFS + PRIM sur une fenêtre de H+5 (par défaut).
//
// Paramètres :
//   stopId    – ID d'arrêt (zdaid, ex: DU496 pour La Défense)
//   stopArea  – ID stop_area pour traffic/equipments (ex: 71135). Défaut = stopId
//   full      – Si "true", inclut aussi traffic + equipments de la gare
//   horizon   – Fenêtre en heures (max 12, défaut 5)
//   includeGTFS – Inclure les horaires GTFS statiques (défaut: true)

const nextTrainsHandler = async (req, res) => {
  const stopId      = req.query.stopId;
  const stopArea    = req.query.stopArea || stopId; // fallback: stopId = stopArea
  const full        = req.query.full === 'true';
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  const includeGTFS = req.query.includeGTFS !== 'false';
  const horizon     = Math.min(parseFloat(req.query.horizon || '5'), 12); // max H+12
  const useCache    = req.query.cache !== 'false';

  try {
    const [nextTrains, trafficData, equipmentData] = await Promise.all([
      departures.getNextDepartures(stopId, { includeGTFS, horizon, useCache }),

      full ? traffic.getLineTraffic(null, stopArea) : Promise.resolve(null),

      full ? equipment.getEquipmentStatus(stopArea) : Promise.resolve(null),
    ]);

    if (!nextTrains) {
      return res.status(404).json({ error: 'Aucune donnée disponible pour cet arrêt.' });
    }

    const stopMeta = stopsMap.find(s => s.zdaid === stopId) || {};

    const payload = {
      stopId,
      stopName:   stopMeta.arrname          || null,
      accessible: stopMeta.arraccessibility === 'true',
      geopoint:   stopMeta.arrgeopoint      || null,
      horizon,
      departures: nextTrains,
    };

    if (full) {
      payload.traffic    = { count: trafficData.length,    messages: trafficData };
      payload.equipments = { count: equipmentData.length, equipments: equipmentData };
    }

    res.json(payload);
  } catch (err) {
    console.error(`[ERROR] /next stopId=${stopId}: ${err.message}`);
    res.status(500).json({ error: 'Erreur lors de la récupération des données.' });
  }
};

app.get('/next',      nextTrainsHandler);
app.get('/nextTrains', nextTrainsHandler);

// ---------- GET /timetable ----------
// Retourne tous les horaires GTFS statiques de la journée entière pour un arrêt.

app.get('/timetable', (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  if (!gtfs.isAvailable()) {
    return res.status(503).json({
      error: 'Base GTFS indisponible. Lancez d\'abord : npm run setup-gtfs',
    });
  }

  // Paramètre date optionnel (format YYYY-MM-DD), défaut = aujourd'hui
  let date = new Date();
  if (req.query.date) {
    const parsed = new Date(req.query.date);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Paramètre date invalide. Format attendu : YYYY-MM-DD' });
    }
    date = parsed;
  }

  try {
    const rows = gtfs.getDayTimetable(stopId, date);

    if (!rows.length) {
      return res.status(404).json({ error: 'Aucun horaire trouvé pour cet arrêt à cette date.' });
    }

    const stopMeta  = stopsMap.find(s => s.zdaid === stopId) || {};
    const dateLabel = date.toISOString().slice(0, 10);

    const departures = rows.map(r => ({
      departure: r.departure_time,
      arrival:   r.arrival_time,
      line:      r.route_short_name,
      direction: r.trip_headsign,
      tripId:    r.trip_id,
      routeType: r.route_type,
      routeColor: r.route_color ? `#${r.route_color}` : null,
    }));

    res.json({
      stopId,
      arrname:    stopMeta.arrname          || null,
      accessible: stopMeta.arraccessibility || null,
      geopoint:   stopMeta.arrgeopoint      || null,
      date:       dateLabel,
      count:      departures.length,
      departures,
    });
  } catch (err) {
    console.error(`[ERROR] /timetable stopId=${stopId}: ${err.message}`);
    res.status(500).json({ error: 'Erreur lors de la récupération des horaires.' });
  }
});

// ---------- GET /traffic ----------
// Infos trafic PRIM pour une ligne et/ou un arrêt (RATP + SNCF/Transilien + Bus).
//
// Utilise l'API disruptions_bulk (couvre TOUTES les lignes IDFM).
// Cache en mémoire 5 min pour éviter de re-télécharger 1.5 Mo à chaque requête.
//
// Paramètres :
//   lineRef  – ID technique IDFM (ex: C01371 pour Métro 1, C01739 pour Transilien J)
//   stopId   – ID d'arrêt (ex: 71135 pour Gare d'Austerlitz, ou stop_area:IDFM:71135)
//
// Si les deux sont fournis, intersection des filtres (perturbations sur cette ligne
// ET cet arrêt). Si stopId seul, toutes les perturbations concernant cet arrêt
// toutes lignes confondues.
//
app.get('/traffic', async (req, res) => {
  const { lineRef, stopId } = req.query;

  if (!lineRef && !stopId) {
    return res.status(400).json({
      error: "Paramètre 'lineRef' ou 'stopId' requis.",
      hint:  "Ex: /traffic?lineRef=C01739 (Transilien J) ou /traffic?stopId=71135 (Gare d'Austerlitz)",
    });
  }

  try {
    const messages = await traffic.getLineTraffic(lineRef, stopId);

    res.json({
      lineRef: lineRef || null,
      stopId:  stopId  || null,
      count:   messages.length,
      messages,
    });
  } catch (err) {
    console.error(`[ERROR] /traffic lineRef=${lineRef}: ${err.message}`);
    res.status(502).json({
      error: 'Erreur lors de la récupération des informations trafic.',
      detail: err.message,
    });
  }
});

// ---------- GET /search ----------
// Recherche d'arrêts/gares par nom.
//
// Paramètres :
//   q       – Texte de recherche (ex: "austerlitz", "la défense")
//   count   – Max résultats (défaut: 10)
//
app.get('/search', async (req, res) => {
  const q     = req.query.q;
  const count = Math.min(parseInt(req.query.count || '10', 10), 50);

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Paramètre "q" requis (min 2 caractères).' });
  }

  try {
    const results = await search.search(q, { count });
    res.json({ query: q, count: results.length, results });
  } catch (err) {
    console.error(`[ERROR] /search q=${q}: ${err.message}`);
    res.status(502).json({ error: 'Erreur lors de la recherche.', detail: err.message });
  }
});

// ---------- GET /equipments ----------
// Pannes d'équipements (ascenseurs, escalators).
//
// Paramètres :
//   stopId  – Optionnel : filtrer par arrêt (ex: 71135 ou stop_area:IDFM:71135)
//
app.get('/equipments', async (req, res) => {
  const { stopId } = req.query;

  try {
    const items = await equipment.getEquipmentStatus(stopId);
    res.json({
      stopId:  stopId || null,
      count:   items.length,
      equipments: items,
    });
  } catch (err) {
    console.error(`[ERROR] /equipments stopId=${stopId}: ${err.message}`);
    res.status(502).json({ error: 'Erreur lors de la récupération des équipements.', detail: err.message });
  }
});

// ---------- Démarrage ----------

app.listen(PORT, () => {
  if (!QUIET_MODE) {
    console.log(`\n${HORIZN_ASCII}\n`);
    console.log(`✅ HORIZN en écoute sur http://localhost:${PORT} (GTFS + PRIM)\n`);
  }
});

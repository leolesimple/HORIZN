'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const fs         = require('fs');
const path       = require('path');

const departures = require('./services/DeparturesService');
const gtfs       = require('./services/GTFSService');

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

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ---------- GET /nextTrains ----------
// Retourne les départs fusionnés GTFS + PRIM sur une fenêtre de H+5 (par défaut).

app.get('/nextTrains', async (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  const includeGTFS = req.query.includeGTFS !== 'false';
  const horizon     = Math.min(parseFloat(req.query.horizon || '5'), 12); // max H+12
  const useCache    = req.query.cache !== 'false';

  try {
    const nextTrains = await departures.getNextDepartures(stopId, {
      includeGTFS,
      horizon,
      useCache,
    });

    if (!nextTrains) {
      return res.status(404).json({ error: 'Aucune donnée disponible pour cet arrêt.' });
    }

    const stopMeta = stopsMap.find(s => s.zdaid === stopId) || {};

    res.json({
      stopId,
      arrname:    stopMeta.arrname          || null,
      accessible: stopMeta.arraccessibility || null,
      geopoint:   stopMeta.arrgeopoint      || null,
      horizon,
      nextTrains,
    });
  } catch (err) {
    console.error(`[ERROR] /nextTrains stopId=${stopId}: ${err.message}`);
    res.status(500).json({ error: 'Erreur lors de la récupération des données.' });
  }
});

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

// ---------- Démarrage ----------

app.listen(PORT, () => {
  if (!QUIET_MODE) {
    console.log(`\n${HORIZN_ASCII}\n`);
    console.log(`✅ HORIZN en écoute sur http://localhost:${PORT} (GTFS + PRIM)\n`);
  }
});

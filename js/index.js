'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const axios      = require('axios');
const Database   = require('better-sqlite3');

const logger     = require('./services/LoggerService');
const admin      = require('./services/AdminService');
const departures = require('./services/DeparturesService');
const gtfs       = require('./services/GTFSService');
const traffic    = require('./services/TrafficService');
const search     = require('./services/SearchService');
const equipment  = require('./services/EquipmentService');
const { requireAdmin, requireFrontend } = require('./middleware/auth');
const { rateLimitPublic, rateLimitAdmin, rateLimitSearch, rateLimitNext } = require('./middleware/rateLimit');
const { denySensitivePaths, securityHeaders } = require('./middleware/security');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const QUIET_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.QUIET_MODE || '').toLowerCase());

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'infostation.db');
const CACHE_DIR = path.join(__dirname, 'cache');

const HORIZN_ASCII = [
  '  _  _  ___  ___ ___ _____  _ ',
  ' | || |/ _ \\| _ \\_ _|_  / \\| |',
  ' | __ | (_) |   /| | / /| .` |',
  ' |_||_|\\___/|_|_\\___/___|_|\\_|',
].join('\n');

// ---------- Chargement stopsMap ----------
const STOPS_MAP_PATH = process.env.STOPS_MAP_PATH
  || path.join(__dirname, '..', 'json', 'arrets-stopPoint.json');

let stopsMap = [];
try {
  stopsMap = JSON.parse(fs.readFileSync(STOPS_MAP_PATH, 'utf-8'));
} catch (err) {
  console.error(`[ERROR] Chargement des arrêts impossible (${STOPS_MAP_PATH}): ${err.message}`);
}

// ========================================================================
// SÉCURITÉ — middleware exécuté avant TOUTE route
// ========================================================================

app.use(denySensitivePaths);
app.use(securityHeaders);

// ---------- CORS ----------
const ALLOWED_ORIGINS = [
  'https://infostation.fr',
  'https://beta.infostation.fr',
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ALLOWED_ORIGINS.some(allowed => new URL(allowed).hostname === url.hostname);
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin || referer;

  if (source && !isOriginAllowed(source)) {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }

  if (origin && isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  next();
});

// ---------- Request ID ----------
let reqIdCounter = 0;
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || `horizn-${process.pid}-${Date.now()}-${++reqIdCounter}`;
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ---------- Logging ----------
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.log({
      ts:       new Date().toISOString(),
      reqId:    req.id,
      method:   req.method,
      path:     req.path,
      query:    req.query,
      status:   res.statusCode,
      duration: Date.now() - start,
      ip:       req.ip || req.connection?.remoteAddress || null,
      ua:       req.headers['user-agent'] || null,
    });
  });
  next();
});

// ========================================================================
// HEALTH (no auth, no rate limit — pour les healthchecks Docker)
// ========================================================================

app.get('/health', (req, res) => {
  // Check rapide DB
  let dbOk = false;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    db.prepare('SELECT 1').get();
    db.close();
    dbOk = true;
  } catch { /* DB pas dispo */ }

  res.json({
    status: dbOk ? 'ok' : 'degraded',
    uptime: Math.round((Date.now() - require('./services/AdminService').STARTED_AT) / 1000),
    db: dbOk,
    timestamp: new Date().toISOString(),
  });
});

// ========================================================================
// STATUS (auth optionnelle, rate limit normal)
// ========================================================================

app.get('/status', rateLimitPublic, requireFrontend, async (req, res) => {
  const results = {};

  // DB GTFS
  results.gtfs = { available: false };
  try {
    if (fs.existsSync(DB_PATH)) {
      const db = new Database(DB_PATH, { readonly: true });
      const count = db.prepare('SELECT COUNT(*) as c FROM stop_times').get().c;
      db.close();
      results.gtfs = { available: true, stopTimesCount: count };
    }
  } catch (err) {
    results.gtfs = { available: false, error: err.message };
  }

  // Cache
  results.cache = { available: false };
  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
      results.cache = {
        available: true,
        fileCount: files.length,
        totalSize: files.reduce((s, f) => s + (fs.statSync(path.join(CACHE_DIR, f)).size || 0), 0),
      };
    }
  } catch (err) {
    results.cache = { available: false, error: err.message };
  }

  // PRIM
  results.prim = { reachable: false };
  try {
    const primResp = await axios.get(
      'https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2',
      {
        headers: { accept: 'application/json', apikey: process.env.PRIM_API_KEY },
        timeout: 5000,
      }
    );
    results.prim = { reachable: primResp.status === 200 };
  } catch { /* PRIM indisponible */ }

  // Uptime
  const startedAt = require('./services/AdminService').STARTED_AT;
  results.uptime = Math.round((Date.now() - startedAt) / 1000);

  res.json({
    service: 'horizn',
    version: require('../package.json').version,
    status: results.gtfs.available && results.prim.reachable ? 'healthy' : 'degraded',
    ...results,
  });
});

// ========================================================================
// ROUTES PUBLIQUES (rate limit only)
// ========================================================================

// --- GET /next | /nextTrains ---
const nextTrainsHandler = async (req, res) => {
  const stopId      = req.query.stopId;
  const stopArea    = req.query.stopArea || stopId;
  const full        = req.query.full === 'true';
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  const includeGTFS = req.query.includeGTFS !== 'false';
  const horizon     = Math.min(parseFloat(req.query.horizon || '5'), 12);
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

app.get('/next',      rateLimitNext, requireFrontend, nextTrainsHandler);
app.get('/nextTrains', rateLimitNext, requireFrontend, nextTrainsHandler);

// --- GET /timetable ---
app.get('/timetable', rateLimitPublic, requireFrontend, (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  if (!gtfs.isAvailable()) {
    return res.status(503).json({
      error: 'Base GTFS indisponible. Lancez d\'abord : npm run setup-gtfs',
    });
  }

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

// --- GET /traffic ---
app.get('/traffic', rateLimitPublic, requireFrontend, async (req, res) => {
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
    res.status(502).json({ error: 'Erreur lors de la récupération des informations trafic.', detail: err.message });
  }
});

// --- GET /search ---
app.get('/search', rateLimitSearch, requireFrontend, async (req, res) => {
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

// --- GET /equipments ---
app.get('/equipments', rateLimitPublic, requireFrontend, async (req, res) => {
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

// ========================================================================
// ROUTES ADMIN (auth + rate limit admin)
// ========================================================================

// GET /admin/horizn — tableau de bord complet
app.get('/admin/horizn', rateLimitAdmin, requireAdmin, async (req, res) => {
  try {
    let primOk = false;
    try {
      const primResp = await axios.get(
        'https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2',
        {
          headers: { accept: 'application/json', apikey: process.env.PRIM_API_KEY },
          timeout: 5000,
        }
      );
      primOk = primResp.status === 200;
    } catch { /* PRIM indisponible */ }

    const health = admin.getHealth();
    health.primReachable = primOk;

    res.json({
      stats:        admin.getTodaysStats(),
      cache:        admin.getCacheStatus(),
      health,
      recentLogs:   admin.getRecentLogs(20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/stats
app.get('/admin/stats', rateLimitAdmin, requireAdmin, (req, res) => {
  res.json(admin.getTodaysStats());
});

// GET /admin/logs
app.get('/admin/logs', rateLimitAdmin, requireAdmin, (req, res) => {
  const limit       = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const filterPath  = req.query.path || null;
  const statusMin   = req.query.statusMin  ? parseInt(req.query.statusMin, 10)  : null;
  const statusMax   = req.query.statusMax  ? parseInt(req.query.statusMax, 10)  : null;
  const durationMin = req.query.durationMin ? parseInt(req.query.durationMin, 10) : null;
  const since       = req.query.since || null;

  let logs;
  if (filterPath || statusMin != null || statusMax != null || durationMin != null) {
    logs = admin.queryLogs({ path: filterPath, statusMin, statusMax, durationMin, limit });
  } else {
    logs = admin.getRecentLogs(limit, since);
  }

  res.json({ count: logs.length, logs });
});

// GET /admin/cache
app.get('/admin/cache', rateLimitAdmin, requireAdmin, (req, res) => {
  res.json(admin.getCacheStatus());
});

// GET /admin/health
app.get('/admin/health', rateLimitAdmin, requireAdmin, (req, res) => {
  res.json(admin.getHealth());
});

// ========================================================================
// DÉMARRAGE + GRACEFUL SHUTDOWN
// ========================================================================

let server;

function start() {
  server = app.listen(PORT, () => {
    if (!QUIET_MODE) {
      console.log(`\n${HORIZN_ASCII}\n`);
      console.log(`✅ HORIZN v${require('../package.json').version} — http://localhost:${PORT}`);
      console.log(`   GTFS: ${fs.existsSync(DB_PATH) ? '✓' : '✗'}  |  Cache: ${fs.existsSync(CACHE_DIR) ? '✓' : '✗'}`);
    }
  });
}

function shutdown(signal) {
  return new Promise((resolve) => {
    if (!server) { process.exit(0); return; }

    console.log(`\n[SIGNAL] ${signal} reçu. Arrêt gracieux…`);

    // Stop d'accepter les nouvelles requêtes
    server.close(async () => {
      console.log('  ✔ Serveur HTTP arrêté');

      // Fermer les connexions DB (GTFS)
      try {
        // GTFSService maintient une connexion — on la ferme
        if (typeof gtfs.close === 'function') {
          gtfs.close();
          console.log('  ✔ Connexion GTFS fermée');
        }
      } catch (err) {
        console.error('  ✗ Erreur fermeture GTFS:', err.message);
      }

      console.log('  ✋ Arrêt terminé');
      resolve();
      process.exit(0);
    });

    // Force shutdown après 10s si le graceful échoue
    setTimeout(() => {
      console.error('  ⏱ Timeout 10s — arrêt forcé');
      resolve();
      process.exit(1);
    }, 10000);
  });
}

// Signaux
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Crash handler
process.on('uncaughtException', (err) => {
  console.error('[CRASH] UncaughtException:', err.message);
  console.error(err.stack);
  shutdown('CRASH').then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] UnhandledRejection:', reason?.message || reason);
});

// Go
start();

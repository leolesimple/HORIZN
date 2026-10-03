'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const axios      = require('axios');
const Database   = require('better-sqlite3');

const logger     = require('./services/LoggerService');
const admin      = require('./services/AdminService');
const keyUsage   = require('./services/KeyUsageService');
const departures = require('./services/DeparturesService');
const gtfs       = require('./services/GTFSService');
const traffic    = require('./services/TrafficService');
const search     = require('./services/SearchService');
const equipment  = require('./services/EquipmentService');
const cache      = require('./services/CacheService');
const statusService = require('./services/SystemStatusService');
const { requireAdmin, requireFrontend } = require('./middleware/auth');
const { rateLimitPublic, rateLimitAdmin, rateLimitSearch, rateLimitNext } = require('./middleware/rateLimit');
const { denySensitivePaths, securityHeaders } = require('./middleware/security');

const app  = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3000', 10);
const QUIET_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.QUIET_MODE || '').toLowerCase());

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'infostation.db');

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
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Maintenance-Secret, Authorization');
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
  // Check rapide DB (local, pas d'appel réseau)
  let dbOk = false;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    db.prepare('SELECT 1').get();
    db.close();
    dbOk = true;
  } catch { /* DB pas dispo */ }

  // État global : combine le check DB local avec le registre passif des
  // sources (mémoire, alimenté par le trafic réel des autres routes) et le
  // mode maintenance manuel. Aucun appel réseau ici — /health doit rester
  // rapide pour le HEALTHCHECK Docker (poll toutes les 30s).
  const globalStatus = statusService.getGlobalStatus();
  let status;
  if (globalStatus === 'maintenance')      status = 'maintenance';
  else if (!dbOk || globalStatus === 'down') status = 'down';
  else if (globalStatus === 'degraded')    status = 'degraded';
  else                                      status = 'ok';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    version: require('../package.json').version,
    uptime: Math.round((Date.now() - require('./services/AdminService').STARTED_AT) / 1000),
    db: dbOk,
    timestamp: new Date().toISOString(),
  });
});

// ---------- Garde mode maintenance (routes de données uniquement) ----------
// Court-circuite les routes dépendant d'une source externe quand le mode
// maintenance manuel est actif (POST /admin/maintenance ou `npm run
// maintenance`), avant même de tenter les appels amont.
function maintenanceGuard(req, res, next) {
  if (!statusService.isMaintenanceMode()) return next();
  const info = statusService.getMaintenanceInfo();
  res.status(503).json({
    status:  'maintenance',
    message: info.reason || 'Service en maintenance.',
  });
}

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
    const status = cache.status();
    results.cache = { available: true, keyCount: status.count, totalSize: status.totalSize };
  } catch (err) {
    results.cache = { available: false, error: err.message };
  }

  // Trafic (disruptions_bulk)
  results.traffic = { reachable: false };
  try {
    const trafficResp = await axios.get(
      'https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2',
      {
        headers: { accept: 'application/json', apikey: process.env.PRIM_API_KEY },
        timeout: 5000,
      }
    );
    results.traffic = { reachable: trafficResp.status === 200 };
  } catch { /* source trafic indisponible */ }

  // Détail par source (registre passif — dernière tentative réelle connue de
  // chaque route ; `realtime`/`places` restent absents tant que personne n'a
  // encore appelé /next ou /search?q= depuis le démarrage)
  results.sources = statusService.formatSources(statusService.getSourcesSnapshot());

  // Mode maintenance manuel
  results.maintenance = statusService.getMaintenanceInfo();

  // Uptime
  const startedAt = require('./services/AdminService').STARTED_AT;
  results.uptime = Math.round((Date.now() - startedAt) / 1000);

  // Statut global : mode maintenance en premier, sinon le pire des 4 sources
  // (registre passif) ET du check GTFS local fait juste au-dessus (plus
  // strict/frais que la source "static" du registre, qui peut être `null`
  // tant que /next ou /timetable n'a jamais été appelé).
  const raw = statusService.getGlobalStatus();
  const globalStatus = raw === 'maintenance' ? 'maintenance'
    : (!results.gtfs.available || raw === 'down') ? 'down'
    : raw === 'degraded' ? 'degraded'
    : 'ok';

  res.json({
    service: 'horizn',
    version: require('../package.json').version,
    status:  globalStatus,
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
    const [next, trafficData, equipmentData] = await Promise.all([
      departures.getNextDepartures(stopId, { includeGTFS, horizon, useCache }),
      full ? traffic.getLineTraffic(null, stopArea) : Promise.resolve(null),
      full ? equipment.getEquipmentStatus(stopArea) : Promise.resolve(null),
    ]);

    const { httpStatus, status } = statusService.classify(next.sources);
    const stopMeta = stopsMap.find(s => s.zdaid === stopId) || {};

    const payload = {
      stopId,
      stopName:   stopMeta.arrname          || null,
      accessible: stopMeta.arraccessibility === 'true',
      geopoint:   stopMeta.arrgeopoint      || null,
      horizon,
      status,
      sources:    statusService.formatSources(next.sources),
      departures: next.departures,
    };

    if (full) {
      payload.traffic    = { count: trafficData.length,    messages: trafficData };
      payload.equipments = { count: equipmentData.length, equipments: equipmentData };
    }

    res.status(httpStatus).json(payload);
  } catch (err) {
    console.error(`[ERROR] /next stopId=${stopId}: ${err.message}`);
    res.status(500).json({ error: 'Erreur interne.' });
  }
};

app.get('/next',      rateLimitNext, requireFrontend, maintenanceGuard, nextTrainsHandler);
app.get('/nextTrains', rateLimitNext, requireFrontend, maintenanceGuard, nextTrainsHandler);

// --- GET /timetable ---
app.get('/timetable', rateLimitPublic, requireFrontend, maintenanceGuard, (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  let date = new Date();
  if (req.query.date) {
    const parsed = new Date(req.query.date);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Paramètre date invalide. Format attendu : YYYY-MM-DD' });
    }
    date = parsed;
  }

  let rows = [];
  let staticOk = false;
  if (gtfs.isAvailable()) {
    try {
      rows = gtfs.getDayTimetable(stopId, date);
      staticOk = true;
      statusService.reportSourceOk('static');
    } catch (err) {
      console.error(`[ERROR] /timetable stopId=${stopId}: ${err.message}`);
      statusService.reportSourceDown('static', err);
    }
  } else {
    statusService.reportSourceDown('static', new Error('GTFS DB indisponible'));
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

  const { httpStatus, status } = statusService.classify({ static: staticOk });

  res.status(httpStatus).json({
    stopId,
    arrname:    stopMeta.arrname          || null,
    accessible: stopMeta.arraccessibility || null,
    geopoint:   stopMeta.arrgeopoint      || null,
    date:       dateLabel,
    status,
    sources:    statusService.formatSources({ static: staticOk }),
    count:      departures.length,
    departures,
  });
});

// --- GET /traffic ---
app.get('/traffic', rateLimitPublic, requireFrontend, maintenanceGuard, async (req, res) => {
  const { lineRef, stopId } = req.query;

  if (!lineRef && !stopId) {
    return res.status(400).json({
      error: "Paramètre 'lineRef' ou 'stopId' requis.",
      hint:  "Ex: /traffic?lineRef=C01739 (Transilien J) ou /traffic?stopId=71135 (Gare d'Austerlitz)",
    });
  }

  try {
    const messages = await traffic.getLineTraffic(lineRef, stopId);
    const trafficOk = statusService.getSourcesSnapshot().traffic;
    const { httpStatus, status } = statusService.classify({ traffic: trafficOk });

    res.status(httpStatus).json({
      lineRef: lineRef || null,
      stopId:  stopId  || null,
      status,
      sources: statusService.formatSources({ traffic: trafficOk }),
      count:   messages.length,
      messages,
    });
  } catch (err) {
    console.error(`[ERROR] /traffic lineRef=${lineRef}: ${err.message}`);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// --- GET /search ---
app.get('/search', rateLimitSearch, requireFrontend, maintenanceGuard, async (req, res) => {
  const { lat, lon } = req.query;

  // Mode géographique : stations à proximité d'un point (recherche locale, sans PRIM)
  if (lat !== undefined || lon !== undefined) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)
      || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return res.status(400).json({ error: 'Paramètres "lat"/"lon" invalides (coordonnées WGS84 requises).' });
    }

    const count  = Math.min(parseInt(req.query.count  || '10',   10), 50);
    const radius = Math.min(parseInt(req.query.radius || '1000', 10), 5000);

    try {
      const results = await search.searchNearby(latNum, lonNum, { count, radius });
      return res.json({ lat: latNum, lon: lonNum, radius, count: results.length, results });
    } catch (err) {
      console.error(`[ERROR] /search lat=${lat} lon=${lon}: ${err.message}`);
      return res.status(500).json({ error: 'Erreur interne.' });
    }
  }

  // Mode texte : recherche par nom (PRIM + enrichissement zdaid local)
  const q     = req.query.q;
  const count = Math.min(parseInt(req.query.count || '10', 10), 50);

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Paramètre "q" requis (min 2 caractères), ou "lat"/"lon" pour une recherche géographique.' });
  }

  try {
    const results = await search.search(q, { count });
    const placesOk = statusService.getSourcesSnapshot().places;
    const { httpStatus, status } = statusService.classify({ places: placesOk });

    res.status(httpStatus).json({
      query: q,
      status,
      sources: statusService.formatSources({ places: placesOk }),
      count: results.length,
      results,
    });
  } catch (err) {
    console.error(`[ERROR] /search q=${q}: ${err.message}`);
    res.status(500).json({ error: 'Erreur interne.' });
  }
});

// --- GET /equipments ---
app.get('/equipments', rateLimitPublic, requireFrontend, maintenanceGuard, async (req, res) => {
  const { stopId } = req.query;

  try {
    const items = await equipment.getEquipmentStatus(stopId);
    const trafficOk = statusService.getSourcesSnapshot().traffic;
    const { httpStatus, status } = statusService.classify({ traffic: trafficOk });

    res.status(httpStatus).json({
      stopId:  stopId || null,
      status,
      sources: statusService.formatSources({ traffic: trafficOk }),
      count:   items.length,
      equipments: items,
    });
  } catch (err) {
    console.error(`[ERROR] /equipments stopId=${stopId}: ${err.message}`);
    res.status(500).json({ error: 'Erreur interne.' });
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
    health.sources = statusService.getSourcesDetail();
    health.sources.traffic = { ok: primOk, lastCheckedAt: new Date().toISOString(), lastError: null };
    health.maintenance = statusService.getMaintenanceInfo();

    res.json({
      stats:        admin.getTodaysStats(),
      cache:        admin.getCacheStatus(),
      health,
      keys:         await keyUsage.report(),
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
  const health = admin.getHealth();
  health.sources     = statusService.getSourcesDetail();
  health.maintenance = statusService.getMaintenanceInfo();
  res.json(health);
});

// ---------- GET/POST /admin/maintenance ----------
// Double sécurisation : clé admin (requireAdmin) + secret dédié distinct
// (X-Maintenance-Secret / MAINTENANCE_SECRET), pour qu'une clé admin seule ne
// suffise pas à couper le service pour tous les clients.
function requireMaintenanceSecret(req, res, next) {
  const configured = process.env.MAINTENANCE_SECRET;
  if (!configured) {
    return res.status(501).json({ error: 'MAINTENANCE_SECRET non configuré côté serveur.' });
  }
  if (req.headers['x-maintenance-secret'] !== configured) {
    return res.status(401).json({ error: 'Secret de maintenance invalide ou manquant.', hint: 'Header X-Maintenance-Secret requis.' });
  }
  next();
}

app.get('/admin/maintenance', rateLimitAdmin, requireAdmin, (req, res) => {
  res.json(statusService.getMaintenanceInfo());
});

app.post('/admin/maintenance', rateLimitAdmin, requireAdmin, requireMaintenanceSecret, express.json({ limit: '10kb' }), (req, res) => {
  const { enabled, reason } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Paramètre "enabled" (boolean) requis dans le corps JSON.' });
  }

  const actorKey = req.headers['x-api-key'] || null;
  const actor    = actorKey ? actorKey.slice(0, 12) + '…' : null;
  const state    = statusService.setMaintenanceMode({ enabled, reason, actor });

  res.json(state);
});

// GET /admin/keys — inventaire des clés API : rôle, nom, dernière utilisation,
// nombre d'utilisations, et consommation de quota en temps réel par classe de route.
app.get('/admin/keys', rateLimitAdmin, requireAdmin, async (req, res) => {
  try {
    res.json(await keyUsage.report());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================================================
// DÉMARRAGE + GRACEFUL SHUTDOWN
// ========================================================================

let server;

// Arrêt de référence pour la sonde de démarrage — La Défense (Grande Arche),
// déjà l'exemple canonique dans README/CLAUDE.md, toujours desservi.
const WARMUP_STOP_ID = 'DU496';
const WARMUP_QUERY    = 'la défense';

/**
 * Sonde chaque source une fois au démarrage (fire-and-forget, ne bloque pas
 * `listen`) pour que /status et /health reflètent un état réel dès le
 * premier appel, plutôt qu'un registre vide tant qu'aucune requête réelle
 * n'a sollicité chaque source. Réutilise directement les services existants
 * (aucune nouvelle logique de reporting) : `getNextDepartures` couvre à la
 * fois `realtime` et `static`.
 */
function _warmupSources() {
  departures.getNextDepartures(WARMUP_STOP_ID).catch(() => {});
  traffic.getLineTraffic(null, null).catch(() => {});
  search.search(WARMUP_QUERY, { count: 1 }).catch(() => {});
}

function start() {
  keyUsage.start();
  server = app.listen(PORT, () => {
    if (!QUIET_MODE) {
      console.log(`\n${HORIZN_ASCII}\n`);
      console.log(`✅ HORIZN v${require('../package.json').version} — http://localhost:${PORT}`);
      console.log(`   GTFS: ${fs.existsSync(DB_PATH) ? '✓' : '✗'}  |  Cache: ${fs.existsSync(cache.DB_PATH) ? '✓' : '✗'}`);
    }
    _warmupSources();
  });
}

function shutdown(signal) {
  return new Promise((resolve) => {
    if (!server) { process.exit(0); return; }

    console.log(`\n[SIGNAL] ${signal} reçu. Arrêt gracieux…`);

    // Stop d'accepter les nouvelles requêtes
    server.close(async () => {
      console.log('  ✔ Serveur HTTP arrêté');

      // Persister la dernière utilisation des clés
      try {
        keyUsage.stop();
        if (keyUsage.flush()) console.log('  ✔ Usage des clés persisté');
      } catch (err) {
        console.error('  ✗ Erreur flush usage clés:', err.message);
      }

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
      try { keyUsage.stop(); keyUsage.flush(); } catch { /* best effort */ }
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

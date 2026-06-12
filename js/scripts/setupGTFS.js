#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const unzipper = require('unzipper');
const csvParser = require('csv-parser');

const GTFS_URL = 'https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bca93433756d6a340d1/download/';
const ZIP_PATH = process.env.GTFS_ZIP_PATH || path.join(__dirname, '..', '..', 'data', 'gtfs.zip');
const DB_PATH  = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'infostation.db');
const SCHEMA   = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const HASH_FILE = path.join(path.dirname(DB_PATH), '.gtfs_hash');

const BATCH_SIZE = 50000;

function q(...a) {
  if (!['1','true','yes','on'].includes(String(process.env.QUIET_MODE || '').toLowerCase())) console.log(...a);
}

async function main() {
  q('🚆 HORIZN — GTFS hydrate');
  fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH),  { recursive: true });

  await downloadIfStale();

  const zipHash = sha256(ZIP_PATH);
  const prevHash = readHash();

  if (zipHash === prevHash && fs.existsSync(DB_PATH)) {
    q(`  └─ ZIP inchangé (${zipHash.slice(0,12)}…), skip`);
    return;
  }

  q(`  └─ Nouveau ZIP (${zipHash.slice(0,12)}…), import…`);
  rebuildDB();
  writeHash(zipHash);
  q(`  ✅ Terminé (${(fs.statSync(DB_PATH).size / 1e9).toFixed(1)} GB)`);
}

async function downloadIfStale() {
  if (fs.existsSync(ZIP_PATH)) {
    const age = (Date.now() - fs.statSync(ZIP_PATH).mtimeMs) / 3600000;
    if (age < 24) return;
  }
  q('  └─ Téléchargement…');
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(ZIP_PATH);
    https.get(GTFS_URL, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let dl = 0, pct = -1;
      res.on('data', c => {
        dl += c.length;
        if (total) { const n = Math.floor(dl/total*100); if (n !== pct && n % 10 === 0) { process.stdout.write(`\r    ${n}%`); pct = n; } }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
    }).on('error', err => { fs.unlink(ZIP_PATH, () => {}); reject(err); });
  });
}

function sha256(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }
function readHash() { try { return fs.readFileSync(HASH_FILE,'utf-8').trim(); } catch { return ''; } }
function writeHash(h) { fs.writeFileSync(HASH_FILE, h); }
function n(v) { return v != null && v !== '' ? Number(v) : null; }

async function rebuildDB() {
  const TMP_PATH = DB_PATH + '.tmp';
  if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);

  const db = new Database(TMP_PATH);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma('cache_size = -262144');
  db.pragma('temp_store = MEMORY');
  db.pragma('locking_mode = EXCLUSIVE');
  db.exec(fs.readFileSync(SCHEMA, 'utf-8'));

  // Inserters (transaction créée à chaque batch, comme l'original)
  const ins = {};

  const sStop = db.prepare(`INSERT OR REPLACE INTO stops (stop_id,stop_name,stop_lat,stop_lon,zone_id,location_type,parent_station) VALUES (?,?,?,?,?,?,?)`);
  ins.stops = rows => {
    const t = db.transaction(r => { for (const x of r) sStop.run(x.stop_id, x.stop_name||null, n(x.stop_lat), n(x.stop_lon), x.zone_id||null, n(x.location_type), x.parent_station||null); });
    t(rows);
  };

  const sRoute = db.prepare(`INSERT OR REPLACE INTO routes (route_id,route_short_name,route_type,route_color) VALUES (?,?,?,?)`);
  ins.routes = rows => {
    const t = db.transaction(r => { for (const x of r) sRoute.run(x.route_id, x.route_short_name||null, n(x.route_type), x.route_color||null); });
    t(rows);
  };

  const sTrip = db.prepare(`INSERT OR REPLACE INTO trips (trip_id,route_id,service_id,shape_id,trip_headsign) VALUES (?,?,?,?,?)`);
  ins.trips = rows => {
    const t = db.transaction(r => { for (const x of r) sTrip.run(x.trip_id, x.route_id, x.service_id, x.shape_id||null, x.trip_headsign||null); });
    t(rows);
  };

  const sST = db.prepare(`INSERT OR REPLACE INTO stop_times (trip_id,stop_id,arrival_time,departure_time,stop_sequence) VALUES (?,?,?,?,?)`);
  ins.stop_times = rows => {
    const t = db.transaction(r => { for (const x of r) sST.run(x.trip_id, x.stop_id, x.arrival_time||null, x.departure_time||null, n(x.stop_sequence)); });
    t(rows);
  };

  // Import chaque table (séquentiel — chaque await est nécessaire)
  await importCSV(ZIP_PATH, 'stops.txt',      db, ins.stops);
  await importCSV(ZIP_PATH, 'routes.txt',     db, ins.routes);
  await importCSV(ZIP_PATH, 'trips.txt',      db, ins.trips);
  await importCSV(ZIP_PATH, 'stop_times.txt', db, ins.stop_times);

  q('  └─ Création index…');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stop_times_trip_id ON stop_times(trip_id);
    CREATE INDEX IF NOT EXISTS idx_stop_times_stop_id ON stop_times(stop_id);
    CREATE INDEX IF NOT EXISTS idx_trips_route_id     ON trips(route_id);
    CREATE INDEX IF NOT EXISTS idx_trips_service_id   ON trips(service_id);
  `);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('locking_mode = NORMAL');
  db.close();

  // Swap atomique : le downtime est < 1ms
  fs.renameSync(TMP_PATH, DB_PATH);
}

function importCSV(zipPath, fileName, db, inserter) {
  let count = 0, batch = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.ParseOne(new RegExp(`^${fileName}$`, 'i')))
      .pipe(csvParser())
      .on('data', row => {
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          inserter(batch);
          count += batch.length;
          batch = [];
        }
      })
      .on('end', () => {
        if (batch.length) { inserter(batch); count += batch.length; }
        q(`    ${fileName}: ${count.toLocaleString()}`);
        resolve(count);
      })
      .on('error', err => resolve(count));
  });
}

main().catch(err => {
  if (err.code === 'MODULE_NOT_FOUND') throw err;
  console.error('\n❌ Erreur setup GTFS :', err.message);
  process.exit(1);
});

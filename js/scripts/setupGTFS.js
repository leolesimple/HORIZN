#!/usr/bin/env node
'use strict';

/**
 * Script de setup GTFS Île-de-France Mobilités
 * Usage : node js/scripts/setupGTFS.js
 *
 * 1. Télécharge le ZIP GTFS IDFM
 * 2. Extrait les CSV
 * 3. Charge les données en SQLite (better-sqlite3)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const stream  = require('stream');
const { promisify } = require('util');

const Database  = require('better-sqlite3');
const unzipper  = require('unzipper');
const csvParser = require('csv-parser');

const pipeline = promisify(stream.pipeline);

const GTFS_URL  = 'https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bca93433756d6a340d1/download/';
const ZIP_PATH  = process.env.GTFS_ZIP_PATH  || path.join(__dirname, '..', '..', 'data', 'gtfs.zip');
const DB_PATH   = process.env.DATABASE_PATH  || path.join(__dirname, '..', '..', 'data', 'infostation.db');
const SCHEMA    = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const QUIET_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.QUIET_MODE || '').toLowerCase());

const BATCH_SIZE = 5000;

// ---------- main ----------

async function main() {
  if (!QUIET_MODE) console.log('🚆 HORIZN setup GTFS...');

  fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH),  { recursive: true });

  // 1. Téléchargement
  await downloadGTFS();

  // 2. Init DB
  const db = initDB();

  // 3. Parsing + chargement
  await loadFromZip(db);

  db.close();
  if (!QUIET_MODE) console.log(`✅ Setup terminé (${DB_PATH})`);
}

// ---------- téléchargement ----------

async function downloadGTFS() {
  if (fs.existsSync(ZIP_PATH)) {
    const age = (Date.now() - fs.statSync(ZIP_PATH).mtimeMs) / 3600000;
    if (age < 24) {
      return;
    }
  }

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(ZIP_PATH);
    https.get(GTFS_URL, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastPct = -1;

      res.on('data', chunk => {
        downloaded += chunk.length;
        if (total) {
          const pct = Math.floor(downloaded / total * 100);
          if (!QUIET_MODE && pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r   ${pct}%`);
            lastPct = pct;
          }
        }
      });

      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(ZIP_PATH, () => {}); reject(err); });
  });
}

// ---------- init SQLite ----------

function initDB() {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -65536'); // 64 MB
  db.pragma('temp_store = MEMORY');

  const schema = fs.readFileSync(SCHEMA, 'utf-8');
  db.exec(schema);
  return db;
}

// ---------- chargement depuis ZIP ----------

async function loadFromZip(db) {
  const FILES = ['stops', 'routes', 'trips', 'stop_times', 'calendar', 'shapes'];

  // On lit le ZIP deux fois : une première passe pour tout sauf stop_times, puis stop_times
  // (stop_times étant très grand, il bénéficie d'une transaction dédiée)
  for (const name of FILES) {
    await loadCSVFromZip(db, name);
  }
}

async function loadCSVFromZip(db, tableName) {
  const fileName  = `${tableName}.txt`;
  const inserters = makeInserters(db);

  if (!inserters[tableName]) {
    return;
  }

  let batch   = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(ZIP_PATH)
      .pipe(unzipper.ParseOne(new RegExp(`^${fileName}$`, 'i')))
      .pipe(csvParser())
      .on('data', row => {
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          inserters[tableName](db, batch);
          batch = [];
        }
      })
      .on('end', () => {
        if (batch.length) {
          inserters[tableName](db, batch);
        }
        resolve();
      })
      .on('error', err => {
        // Si le fichier n'existe pas dans le ZIP, on skip silencieusement
        if (err.message?.includes('ENTRY_NOT_FOUND') || err.message?.includes('unexpected')) {
          resolve();
        } else {
          reject(err);
        }
      });
  });
}

// ---------- inserters par table ----------

function makeInserters(db) {
  return {
    stops(db, rows) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO stops
           (stop_id, stop_name, stop_lat, stop_lon, zone_id, location_type, parent_station)
         VALUES (?,?,?,?,?,?,?)`
      );
      const run = db.transaction(rows => {
        for (const r of rows) stmt.run(
          r.stop_id,
          r.stop_name      || null,
          r.stop_lat       ? Number(r.stop_lat)  : null,
          r.stop_lon       ? Number(r.stop_lon)  : null,
          r.zone_id        || null,
          r.location_type  != null ? Number(r.location_type) : null,
          r.parent_station || null
        );
      });
      run(rows);
    },

    routes(db, rows) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO routes (route_id, route_short_name, route_type, route_color) VALUES (?,?,?,?)'
      );
      const run = db.transaction(rows => {
        for (const r of rows) stmt.run(r.route_id, r.route_short_name || null, r.route_type != null ? Number(r.route_type) : null, r.route_color || null);
      });
      run(rows);
    },

    trips(db, rows) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, shape_id, trip_headsign) VALUES (?,?,?,?,?)'
      );
      const run = db.transaction(rows => {
        for (const r of rows) stmt.run(r.trip_id, r.route_id, r.service_id, r.shape_id || null, r.trip_headsign || null);
      });
      run(rows);
    },

    stop_times(db, rows) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO stop_times (trip_id, stop_id, arrival_time, departure_time, stop_sequence) VALUES (?,?,?,?,?)'
      );
      const run = db.transaction(rows => {
        for (const r of rows) stmt.run(r.trip_id, r.stop_id, r.arrival_time || null, r.departure_time || null, Number(r.stop_sequence));
      });
      run(rows);
    },

    calendar(db, rows) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO calendar (service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date) VALUES (?,?,?,?,?,?,?,?,?,?)'
      );
      const run = db.transaction(rows => {
        for (const r of rows) stmt.run(
          r.service_id,
          Number(r.monday), Number(r.tuesday), Number(r.wednesday),
          Number(r.thursday), Number(r.friday), Number(r.saturday), Number(r.sunday),
          r.start_date, r.end_date
        );
      });
      run(rows);
    },

    shapes(db, rows) {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO shapes (shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence) VALUES (?,?,?,?)'
      );
      const run = db.transaction(rows => {
        for (const r of rows) stmt.run(r.shape_id, Number(r.shape_pt_lat), Number(r.shape_pt_lon), Number(r.shape_pt_sequence));
      });
      run(rows);
    },
  };
}

// ---------- run ----------

main().catch(err => {
  console.error('\n❌ Erreur setup GTFS :', err.message);
  process.exit(1);
});

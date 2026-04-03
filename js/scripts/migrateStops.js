#!/usr/bin/env node
'use strict';

/**
 * Migration rapide : ajoute parent_station + location_type dans la table stops
 * et recharge stops.txt depuis le ZIP GTFS existant.
 * Ne touche pas aux autres tables (stop_times, trips, etc.).
 *
 * Usage : node js/scripts/migrateStops.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs        = require('fs');
const path      = require('path');
const Database  = require('better-sqlite3');
const unzipper  = require('unzipper');
const csvParser = require('csv-parser');

const ZIP_PATH = process.env.GTFS_ZIP_PATH || path.join(__dirname, '..', '..', 'data', 'gtfs.zip');
const DB_PATH  = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'infostation.db');
const QUIET_MODE = ['1', 'true', 'yes', 'on'].includes(String(process.env.QUIET_MODE || '').toLowerCase());

async function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    console.error(`❌ ZIP introuvable : ${ZIP_PATH}\n   Lancez d'abord : npm run setup-gtfs`);
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Base introuvable : ${DB_PATH}\n   Lancez d'abord : npm run setup-gtfs`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Ajout des colonnes si absentes
  const cols = db.prepare("PRAGMA table_info(stops)").all().map(c => c.name);
  if (!cols.includes('location_type')) {
    db.exec('ALTER TABLE stops ADD COLUMN location_type INTEGER');
  }
  if (!cols.includes('parent_station')) {
    db.exec('ALTER TABLE stops ADD COLUMN parent_station TEXT');
  }

  // Index sur parent_station
  db.exec('CREATE INDEX IF NOT EXISTS idx_stops_parent_station ON stops(parent_station)');

  // Rechargement de stops.txt
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO stops
       (stop_id, stop_name, stop_lat, stop_lon, zone_id, location_type, parent_station)
     VALUES (?,?,?,?,?,?,?)`
  );
  const run = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(
        r.stop_id,
        r.stop_name    || null,
        r.stop_lat     ? Number(r.stop_lat)  : null,
        r.stop_lon     ? Number(r.stop_lon)  : null,
        r.zone_id      || null,
        r.location_type != null ? Number(r.location_type) : null,
        r.parent_station || null
      );
    }
  });

  let count = 0;
  let batch = [];
  const BATCH = 5000;

  await new Promise((resolve, reject) => {
    fs.createReadStream(ZIP_PATH)
      .pipe(unzipper.ParseOne(/^stops\.txt$/i))
      .pipe(csvParser())
      .on('data', row => {
        batch.push(row);
        if (batch.length >= BATCH) {
          run(batch); count += batch.length; batch = [];
        }
      })
      .on('end', () => {
        if (batch.length) { run(batch); count += batch.length; }
        if (!QUIET_MODE) console.log(`✅ Migration stops terminée (${count.toLocaleString()} arrêts)`);
        resolve();
      })
      .on('error', reject);
  });

  db.close();

  // Vérification silencieuse: ouverture/fermeture lecture seule.
  const db2 = new Database(DB_PATH, { readonly: true });
  db2.close();
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});

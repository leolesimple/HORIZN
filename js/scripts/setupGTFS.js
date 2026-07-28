#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const unzipper = require('unzipper');

const GTFS_URL = 'https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/files/a925e164271e4bca93433756d6a340d1/download/';
const ZIP_PATH = process.env.GTFS_ZIP_PATH || path.join(__dirname, '..', '..', 'data', 'gtfs.zip');
const DB_PATH  = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'infostation.db');
const SCHEMA   = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const HASH_FILE = path.join(path.dirname(DB_PATH), '.gtfs_hash');

// Commit intermédiaire : borne les pages sales du cache SQLite sans
// payer un BEGIN/COMMIT par lot de 50k comme avant.
const COMMIT_EVERY = 500000;

// Cache SQLite volontairement modeste (64 Mo) : le NUC partage sa RAM avec
// d'autres conteneurs. Le tri des index passe sur disque (temp_store=FILE)
// plutôt que de gonfler la RSS de plusieurs Go.
const CACHE_KIB = 65536;

function q(...a) {
  if (!['1','true','yes','on'].includes(String(process.env.QUIET_MODE || '').toLowerCase())) console.log(...a);
}

async function main() {
  q('🚆 HORIZN — GTFS hydrate');
  fs.mkdirSync(path.dirname(ZIP_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH),  { recursive: true });

  await downloadIfStale();

  const zipHash = await sha256(ZIP_PATH);
  const prevHash = readHash();

  if (zipHash === prevHash && fs.existsSync(DB_PATH)) {
    q(`  └─ ZIP inchangé (${zipHash.slice(0,12)}…), skip`);
    return;
  }

  q(`  └─ Nouveau ZIP (${zipHash.slice(0,12)}…), import…`);
  await rebuildDB();
  // Le hash n'est écrit qu'une fois l'import réellement terminé : un run
  // interrompu (OOM kill, timeout) sera rejoué au lieu d'être considéré OK.
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
      res.on('error', reject);
      res.pipe(file);
      file.on('error', reject);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
    }).on('error', err => { fs.unlink(ZIP_PATH, () => {}); reject(err); });
  });
}

/** Hash en streaming : évite de charger le ZIP entier (~1 Go) en Buffer. */
function sha256(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f)
      .on('data', c => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function readHash() { try { return fs.readFileSync(HASH_FILE,'utf-8').trim(); } catch { return ''; } }
function writeHash(h) { fs.writeFileSync(HASH_FILE, h); }

// Casts colonne par colonne, résolus une fois depuis l'en-tête CSV.
const TEXT = v => (v !== '' ? v : null);
const NUM  = v => (v !== '' ? Number(v) : null);

const TABLES = [
  { file: 'stops.txt',  table: 'stops',
    cols: ['stop_id','stop_name','stop_lat','stop_lon','zone_id','location_type','parent_station'],
    cast: [TEXT, TEXT, NUM, NUM, TEXT, NUM, TEXT] },
  { file: 'routes.txt', table: 'routes',
    cols: ['route_id','route_short_name','route_type','route_color'],
    cast: [TEXT, TEXT, NUM, TEXT] },
  { file: 'trips.txt',  table: 'trips',
    cols: ['trip_id','route_id','service_id','shape_id','trip_headsign'],
    cast: [TEXT, TEXT, TEXT, TEXT, TEXT] },
  { file: 'stop_times.txt', table: 'stop_times',
    cols: ['trip_id','stop_id','arrival_time','departure_time','stop_sequence'],
    cast: [TEXT, TEXT, TEXT, TEXT, NUM] },
];

async function rebuildDB() {
  const TMP_PATH = DB_PATH + '.tmp';
  if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH);

  // Fichiers temporaires du tri d'index à côté de la DB (volume ./data),
  // pas sur l'overlayfs du conteneur.
  process.env.SQLITE_TMPDIR = process.env.SQLITE_TMPDIR || path.dirname(DB_PATH);

  const db = new Database(TMP_PATH);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.pragma(`cache_size = -${CACHE_KIB}`);
  db.pragma('temp_store = FILE');
  db.pragma('locking_mode = EXCLUSIVE');
  db.exec(fs.readFileSync(SCHEMA, 'utf-8'));

  try {
    for (const spec of TABLES) {
      const count = await importCSV(ZIP_PATH, spec, db);
      q(`    ${spec.file}: ${count.toLocaleString()}`);
    }

    q('  └─ Création index…');
    createIndexes(db);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('locking_mode = NORMAL');
  } finally {
    db.close();
  }

  // Swap atomique : le downtime est < 1ms
  fs.renameSync(TMP_PATH, DB_PATH);
}

/** Index construits une seule fois, après le chargement (tri en masse). */
function createIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id);
    CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id);
    CREATE INDEX IF NOT EXISTS idx_trips_route_id  ON trips(route_id);
    CREATE INDEX IF NOT EXISTS idx_trips_service_id ON trips(service_id);
    CREATE INDEX IF NOT EXISTS idx_shapes_id       ON shapes(shape_id);
  `);
}

/**
 * Découpe une ligne CSV. Chemin rapide sans guillemet (cas de stop_times.txt,
 * 10,4M lignes) ; chemin complet sinon (stop_name, trip_headsign contiennent
 * des virgules chez IDFM).
 */
function splitCSV(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Lit une entrée du ZIP et insère au fil de l'eau.
 *
 * Deux différences avec l'ancienne version : on n'accumule plus 50 000 objets
 * JS par lot (csv-parser allouait un objet par ligne, soit 10,4M objets et
 * autant de pression GC), et la transaction reste ouverte entre les commits.
 * better-sqlite3 étant synchrone, le handler 'data' bloque le flux : la
 * contre-pression est naturelle, rien ne s'accumule en mémoire.
 */
function importCSV(zipPath, spec, db) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${spec.table} (${spec.cols.join(',')}) VALUES (${spec.cols.map(() => '?').join(',')})`
  );

  return new Promise((resolve, reject) => {
    let idx = null;                       // position de chaque colonne dans le CSV
    const params = new Array(spec.cols.length); // réutilisé : better-sqlite3 copie les valeurs
    let count = 0, open = false, tail = '', done = false, pending = '';

    const begin  = () => { db.exec('BEGIN'); open = true; };
    const commit = () => { if (open) { db.exec('COMMIT'); open = false; } };

    const stream = fs.createReadStream(zipPath)
      .pipe(unzipper.ParseOne(new RegExp(`^${spec.file}$`, 'i')));
    stream.setEncoding('utf8');

    const fail = err => {
      if (done) return;
      done = true;
      try { if (open) { db.exec('ROLLBACK'); open = false; } } catch { /* déjà fermée */ }
      stream.destroy();
      reject(err);
    };

    // Un champ entre guillemets peut contenir un saut de ligne : on rassemble
    // les morceaux tant que les guillemets ne sont pas équilibrés. Le test ne
    // coûte rien sur stop_times.txt, qui n'a aucun guillemet.
    const feed = line => {
      if (pending) line = `${pending}\n${line}`;
      if (line.indexOf('"') !== -1) {
        let quotes = 0;
        for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 34) quotes++;
        if (quotes & 1) { pending = line; return; }
      }
      pending = '';
      handleLine(line);
    };

    const handleLine = line => {
      if (idx === null) {
        const header = splitCSV(line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line)
          .map(h => h.trim());
        idx = spec.cols.map(c => header.indexOf(c));
        const missing = spec.cols.filter((c, i) => idx[i] === -1);
        if (missing.length) throw new Error(`${spec.file}: colonnes absentes ${missing.join(', ')}`);
        begin();
        return;
      }
      const f = splitCSV(line);
      for (let i = 0; i < idx.length; i++) params[i] = spec.cast[i](f[idx[i]] ?? '');
      stmt.run(params);
      if (++count % COMMIT_EVERY === 0) { commit(); begin(); }
    };

    stream.on('data', chunk => {
      if (done) return;
      tail += chunk;
      let start = 0, nl;
      try {
        while ((nl = tail.indexOf('\n', start)) !== -1) {
          let line = tail.slice(start, nl);
          start = nl + 1;
          if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
          if (line || pending) feed(line);
        }
        tail = tail.slice(start);
      } catch (err) { fail(err); }
    });

    stream.on('end', () => {
      if (done) return;
      try {
        if (tail.trim()) feed(tail.trim());
        if (pending) handleLine(pending);   // guillemet non refermé en fin de fichier
        commit();
        done = true;
        resolve(count);
      } catch (err) { fail(err); }
    });

    stream.on('error', fail);
  });
}

main().catch(err => {
  if (err.code === 'MODULE_NOT_FOUND') throw err;
  console.error('\n❌ Erreur setup GTFS :', err.message);
  process.exit(1);
});

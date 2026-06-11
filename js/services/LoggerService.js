'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'data', 'logs');

// S'assurer que le dossier logs existe
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Fichier du jour
let _today     = null;
let _stream    = null;

function _getStream() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD

  if (day !== _today) {
    if (_stream) _stream.end();
    _today  = day;
    const p = path.join(LOG_DIR, `${day}.jsonl`);
    _stream = fs.createWriteStream(p, { flags: 'a' });
  }
  return _stream;
}

/**
 * Écrit une ligne JSON dans le log du jour.
 * Format : { ts, method, path, query, status, duration, ip, ua }
 */
function log(entry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    _getStream().write(line);
  } catch (err) {
    console.error(`[Logger] Écriture impossible : ${err.message}`);
  }
}

module.exports = { log };

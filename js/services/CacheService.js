'use strict';

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');

const CACHE_DB_PATH = process.env.CACHE_DB_PATH || path.join(__dirname, '..', '..', 'data', 'cache.db');

fs.mkdirSync(path.dirname(CACHE_DB_PATH), { recursive: true });

const db = new Database(CACHE_DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const stmtGet = db.prepare('SELECT value, created_at FROM cache WHERE key = ?');
const stmtSet = db.prepare(`
  INSERT INTO cache (key, value, created_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at
`);
const stmtDel = db.prepare('DELETE FROM cache WHERE key = ?');
const stmtAll = db.prepare('SELECT key, length(value) AS size, created_at FROM cache ORDER BY created_at DESC');

class CacheService {
  /**
   * Récupère une entrée du cache si elle existe et n'est pas expirée.
   * @param {string} key    - Clé de cache (ex: "IDFM:43082")
   * @param {number} maxAge - Âge maximum en secondes (défaut: 60)
   * @returns {any|null}
   */
  get(key, maxAge = 60) {
    try {
      const row = stmtGet.get(key);
      if (!row) return null;
      const age = (Date.now() - row.created_at) / 1000;
      if (age > maxAge) return null;
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  /**
   * Écrit une entrée dans le cache.
   * @param {string} key  - Clé de cache
   * @param {any}    data - Données à stocker (sérialisables en JSON)
   */
  set(key, data) {
    try {
      stmtSet.run(key, JSON.stringify(data), Date.now());
    } catch (err) {
      console.error(`[Cache] Écriture impossible pour ${key}: ${err.message}`);
    }
  }

  /**
   * Supprime une entrée du cache.
   * @param {string} key
   */
  del(key) {
    try {
      stmtDel.run(key);
    } catch { /* ignore */ }
  }

  /**
   * État du cache (pour l'admin) : entrées, tailles, âges.
   */
  status() {
    const now = Date.now();
    const entries = stmtAll.all().map(r => ({
      key:        r.key,
      size:       r.size,
      ageSeconds: Math.round((now - r.created_at) / 1000),
      modifiedAt: new Date(r.created_at).toISOString(),
    }));

    return {
      entries,
      totalSize: entries.reduce((s, r) => s + r.size, 0),
      count:     entries.length,
    };
  }
}

const service = new CacheService();
service.DB_PATH = CACHE_DB_PATH;

module.exports = service;

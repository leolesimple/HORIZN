'use strict';

const fs   = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

class CacheService {
  /**
   * Récupère une entrée du cache si elle existe et n'est pas expirée.
   * @param {string} key    - Clé de cache (ex: "IDFM:43082")
   * @param {number} maxAge - Âge maximum en secondes (défaut: 60)
   * @returns {any|null}
   */
  get(key, maxAge = 60) {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    try {
      if (!fs.existsSync(filePath)) return null;
      const age = (Date.now() - fs.statSync(filePath).mtimeMs) / 1000;
      if (age > maxAge) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data));
    } catch (err) {
      console.error(`[Cache] Écriture impossible pour ${key}: ${err.message}`);
    }
  }

  /**
   * Supprime une entrée du cache.
   * @param {string} key
   */
  del(key) {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }
}

module.exports = new CacheService();

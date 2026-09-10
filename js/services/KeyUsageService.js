'use strict';

/**
 * KeyUsageService — suivi de la dernière utilisation des clés API.
 *
 * À chaque requête authentifiée, le middleware auth appelle `record(key)`.
 * L'usage est accumulé en mémoire (O(1)) puis reversé périodiquement dans
 * `data/api_keys.json` :
 *   - flush toutes les 30 s (timer `unref()` — ne maintient pas le process en vie)
 *   - flush à l'arrêt (graceful shutdown / crash), déclenché par js/index.js
 *
 * Champs ajoutés à chaque entrée de api_keys.json :
 *   - lastUsedAt : ISO 8601 de la dernière requête acceptée avec cette clé
 *   - usageCount : nombre cumulé de requêtes acceptées avec cette clé
 *
 * Les clés issues de .env (FRONTEND_API_KEY / ADMIN_API_KEY) n'ont pas d'entrée
 * fichier : leur usage est suivi en mémoire uniquement (visible via report(),
 * perdu au redémarrage).
 */

const fs   = require('fs');
const path = require('path');

const KEYS_FILE = process.env.API_KEYS_FILE
  || path.join(__dirname, '..', '..', 'data', 'api_keys.json');

const FLUSH_INTERVAL_MS = 30_000;

const ENV_KEYS = [
  ['FRONTEND_API_KEY', 'frontend'],
  ['ADMIN_API_KEY',    'admin'],
];

// Delta d'usage depuis le dernier flush : Map<key, { lastUsedAt, usageCount }>.
// `flush()` retire les clés fichier persistées via `_pending.delete()` — jamais
// de ré-affectation, donc `const`.
const _pending = new Map();
let _dirty = false;
let _timer = null;

/**
 * Enregistre une utilisation de clé. Appelé par le middleware auth pour chaque
 * requête acceptée. Ne fait aucune I/O — la persistance est différée.
 */
function record(key) {
  if (!key) return;
  const cur = _pending.get(key) || { lastUsedAt: null, usageCount: 0 };
  cur.lastUsedAt = new Date().toISOString();
  cur.usageCount += 1;
  _pending.set(key, cur);
  _dirty = true;
}

/**
 * Démarre le flush périodique. Idempotent. Appelé par js/index.js au boot.
 * Le timer est `unref()` : il n'empêche pas Node de sortir.
 */
function start() {
  if (_timer) return;
  _timer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
}

/** Arrête le flush périodique. */
function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

/**
 * Reverse le delta d'usage en mémoire dans data/api_keys.json.
 *
 * - Lecture atomique (fd + fstat) puis merge puis écriture `tmp` + `rename`.
 * - Le mode du fichier existant est préservé (un `api_keys.json` en 0600 le reste).
 * - Garde anti-course : si `js/scripts/keys.js` a réécrit le fichier entre notre
 *   lecture et le rename (mtime différente), on abandonne ce flush et on retente
 *   au cycle suivant plutôt que d'écraser une génération/révocation.
 * - Sur erreur de lecture/écriture, `_dirty` est conservé (retry au prochain flush).
 * - Seules les clés fichier réécrites sont retirées du delta ; les clés `.env`
 *   restent en mémoire et s'y accumulent.
 *
 * 100 % synchrone : sûr à appeler pendant l'arrêt.
 *
 * @returns {boolean} true si le fichier a été réécrit.
 */
function flush() {
  if (!_dirty) return false;

  let snapshot;
  try {
    snapshot = _loadKeyFile();
  } catch (err) {
    console.error(`[KeyUsage] lecture de ${path.basename(KEYS_FILE)} impossible, flush reporté : ${err.message}`);
    return false; // _dirty conservé → retry
  }

  const { entries, stat } = snapshot;
  if (entries.length === 0) {
    _dirty = false; // aucune clé fichier à mettre à jour (fichier absent ou vide)
    return false;
  }

  let changed = false;
  for (const entry of entries) {
    const d = _pending.get(entry.key);
    if (!d) continue;
    if (!entry.lastUsedAt || d.lastUsedAt > entry.lastUsedAt) {
      entry.lastUsedAt = d.lastUsedAt;
    }
    entry.usageCount = _int(entry.usageCount) + d.usageCount;
    changed = true;
  }

  if (!changed) { _dirty = false; return false; }

  const tmp = `${KEYS_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n');
    fs.chmodSync(tmp, stat.mode & 0o777);

    if (fs.statSync(KEYS_FILE).mtimeMs !== stat.mtimeMs) {
      fs.unlinkSync(tmp);
      _dirty = true;
      console.warn('[KeyUsage] api_keys.json modifié pendant le flush — report au prochain cycle');
      return false;
    }

    fs.renameSync(tmp, KEYS_FILE);
    for (const entry of entries) _pending.delete(entry.key);
    _dirty = false;
    return true;
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* déjà absent */ }
    console.error(`[KeyUsage] flush impossible : ${err.message}`);
    _dirty = true;
    return false;
  }
}

/**
 * Inventaire des clés (fichier + fallback .env), enrichi de la dernière
 * utilisation et de la consommation de quota en temps réel. Les clés brutes
 * ne sont jamais renvoyées (aperçu masqué uniquement).
 *
 * @returns {Promise<{ generatedAt, count, keys: Array }>}
 */
async function report() {
  const rateLimit = require('../middleware/rateLimit');

  const fileEntries = _readEntriesSafe();
  const seen = new Set();
  const rows = [];

  for (const e of fileEntries) {
    seen.add(e.key);
    const d = _pending.get(e.key);
    rows.push(await _shape({
      key:        e.key,
      role:       e.role,
      name:       e.name || null,
      source:     'file',
      createdAt:  e.createdAt || null,
      lastUsedAt: _maxIso(e.lastUsedAt, d && d.lastUsedAt),
      usageCount: _int(e.usageCount) + (d ? d.usageCount : 0),
    }, rateLimit));
  }

  for (const [envVar, role] of ENV_KEYS) {
    const key = process.env[envVar];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const d = _pending.get(key);
    rows.push(await _shape({
      key,
      role,
      name:       `(${envVar})`,
      source:     'env',
      createdAt:  null,
      lastUsedAt: d ? d.lastUsedAt : null,
      usageCount: d ? d.usageCount : 0,
    }, rateLimit));
  }

  rows.sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));

  return { generatedAt: new Date().toISOString(), count: rows.length, keys: rows };
}

/** Formatte "il y a 3 min" / "jamais" à partir d'un ISO. Exporté pour la CLI. */
function relativeTime(iso) {
  if (!iso) return 'jamais';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return 'jamais';
  const s = Math.round(diff / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

// ---------- helpers ----------

async function _shape(row, rateLimit) {
  const { key, ...rest } = row;
  return {
    ...rest,
    keyPreview:       key.slice(0, 12) + '…' + key.slice(-4),
    lastUsedRelative: relativeTime(rest.lastUsedAt),
    quota:            await rateLimit.getUsage(key),
  };
}

/**
 * Lit le fichier de clés de façon atomique (fd + fstat, pour que le mtime
 * corresponde exactement au contenu lu).
 *   - fichier absent → { entries: [], stat: null }
 *   - toute autre erreur (permissions, I/O, JSON invalide) → lève
 *
 * @returns {{ entries: Array, stat: import('fs').Stats | null }}
 */
function _loadKeyFile() {
  let fd;
  try {
    fd = fs.openSync(KEYS_FILE, 'r');
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], stat: null };
    throw err;
  }
  try {
    const stat = fs.fstatSync(fd);
    const arr = JSON.parse(fs.readFileSync(fd, 'utf-8'));
    return { entries: Array.isArray(arr) ? arr : [], stat };
  } finally {
    fs.closeSync(fd);
  }
}

/** Comme _loadKeyFile mais renvoie [] au lieu de lever (pour report()). */
function _readEntriesSafe() {
  try {
    return _loadKeyFile().entries;
  } catch {
    return [];
  }
}

function _int(v) {
  return Number.isFinite(v) ? v : 0;
}

function _maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a > b ? a : b;
}

module.exports = { record, start, stop, flush, report, relativeTime };

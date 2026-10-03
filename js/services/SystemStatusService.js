'use strict';

/**
 * SystemStatusService — registre passif de l'état des sources externes +
 * mode maintenance persisté.
 *
 * Ne fait AUCUN appel réseau propre : `reportSourceOk`/`reportSourceDown`
 * sont appelés par les services existants (DeparturesService, TrafficService,
 * SearchService) juste après chaque tentative réelle vers une source externe
 * (pas les hits de cache). Une source jamais sollicitée reste `null`
 * (inconnue), jamais `false` — sinon /health marquerait "places" en panne
 * juste parce que personne n'a encore fait de recherche texte.
 *
 * Vocabulaire de sources exposé aux clients de l'API (jamais prim/gtfs/
 * navitia, pour ne pas fuiter l'architecture interne) :
 *   realtime → SIRI StopMonitoring (PRIM)
 *   static   → GTFS SQLite
 *   traffic  → disruptions_bulk (PRIM)
 *   places   → Navitia places (PRIM), mode texte de /search uniquement
 */

const fs   = require('fs');
const path = require('path');

const MAINTENANCE_FILE = process.env.MAINTENANCE_FILE
  || path.join(__dirname, '..', '..', 'data', 'maintenance.json');

const STAT_TTL_MS = 1000; // comme getFileKeys() dans middleware/auth.js
const SOURCE_LABELS = ['realtime', 'static', 'traffic', 'places'];
const DEFAULT_STATE = { enabled: false, reason: null, setAt: null, setBy: null };

// ---------- Registre passif des sources (mémoire, jamais persisté) ----------

const _sources = {}; // label -> { ok, lastCheckedAt, lastError }

function reportSourceOk(label) {
  _sources[label] = { ok: true, lastCheckedAt: new Date().toISOString(), lastError: null };
}

function reportSourceDown(label, err) {
  _sources[label] = {
    ok: false,
    lastCheckedAt: new Date().toISOString(),
    lastError: err ? String(err.message || err) : null,
  };
}

/** { realtime, static, traffic, places } → true/false/null (jamais sollicité) */
function getSourcesSnapshot() {
  const out = {};
  for (const label of SOURCE_LABELS) out[label] = _sources[label] ? _sources[label].ok : null;
  return out;
}

/** Comme getSourcesSnapshot mais avec lastCheckedAt/lastError (admin only). */
function getSourcesDetail() {
  const out = {};
  for (const label of SOURCE_LABELS) {
    out[label] = _sources[label] || { ok: null, lastCheckedAt: null, lastError: null };
  }
  return out;
}

// ---------- Mode maintenance (persisté, data/maintenance.json) ----------

let _cached       = null;
let _cachedMtime  = 0;
let _checkedAt    = 0;

/** Recharge le fichier uniquement si modifié (stat throttlé à 1 s). */
function _load() {
  const now = Date.now();
  if (_cached !== null && now - _checkedAt < STAT_TTL_MS) return _cached;
  _checkedAt = now;
  try {
    const st = fs.statSync(MAINTENANCE_FILE);
    if (st.mtimeMs !== _cachedMtime) {
      _cached = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf-8'));
      _cachedMtime = st.mtimeMs;
    }
  } catch {
    _cached = DEFAULT_STATE;
    _cachedMtime = 0;
  }
  return _cached || DEFAULT_STATE;
}

function isMaintenanceMode() {
  return !!_load().enabled;
}

function getMaintenanceInfo() {
  return { ..._load() };
}

/**
 * Active/désactive le mode maintenance. Écriture atomique (tmp + rename),
 * mode du fichier existant préservé — sur le modèle simplifié de
 * KeyUsageService.flush() (pas de merge/delta ici, juste un overwrite complet).
 *
 * @param {{ enabled: boolean, reason?: string|null, actor?: string|null }} opts
 * @returns {object} le nouvel état persisté
 */
function setMaintenanceMode({ enabled, reason = null, actor = null }) {
  const state = {
    enabled: !!enabled,
    reason:  enabled ? (reason || null) : null,
    setAt:   new Date().toISOString(),
    setBy:   actor || null,
  };

  fs.mkdirSync(path.dirname(MAINTENANCE_FILE), { recursive: true });
  const tmp = `${MAINTENANCE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');

  try {
    const existingMode = fs.statSync(MAINTENANCE_FILE).mode & 0o777;
    fs.chmodSync(tmp, existingMode);
  } catch { /* pas encore de fichier existant : mode par défaut */ }

  fs.renameSync(tmp, MAINTENANCE_FILE);

  _cached      = state;
  _cachedMtime = fs.statSync(MAINTENANCE_FILE).mtimeMs;
  _checkedAt   = Date.now();

  return state;
}

// ---------- Statut global ----------

/** 'maintenance' | 'down' | 'degraded' | 'healthy' */
function getGlobalStatus() {
  if (isMaintenanceMode()) return 'maintenance';

  const known = SOURCE_LABELS.map(l => _sources[l]?.ok).filter(v => v !== undefined && v !== null);
  if (known.length === 0) return 'healthy'; // rien encore sollicité depuis le boot

  if (known.every(v => v === false)) return 'down';
  if (known.some(v => v === false))  return 'degraded';
  return 'healthy';
}

/**
 * Classe les sources sollicitées par UNE requête en code HTTP + statut.
 * Les labels non pertinents pour la route doivent être omis (pas `null`
 * ambigu avec "sollicité mais jamais vu" — ici `null` = "non applicable à
 * cette requête", filtré avant classification).
 *
 * @param {Object<string, boolean|null>} sources
 * @returns {{ httpStatus: number, status: 'ok'|'degraded'|'down' }}
 */
function classify(sources) {
  const values = Object.values(sources).filter(v => v !== null);
  if (values.length === 0 || values.every(Boolean)) return { httpStatus: 200, status: 'ok' };
  if (values.every(v => v === false))                return { httpStatus: 503, status: 'down' };
  return { httpStatus: 206, status: 'degraded' };
}

/**
 * Convertit un objet de sources (booléen ou `null` = non sollicitée) en
 * tableau `[{ source, status }]` pour l'affichage front (un badge par
 * source, sans connaître les clés à l'avance). Les sources non sollicitées
 * (`null`) sont omises — pas de badge pour une source hors de la requête.
 *
 * @param {Object<string, boolean|null>} sources
 * @returns {Array<{ source: string, status: 'up'|'down' }>}
 */
function formatSources(sources) {
  return Object.entries(sources)
    .filter(([, ok]) => ok !== null)
    .map(([source, ok]) => ({ source, status: ok ? 'up' : 'down' }));
}

module.exports = {
  reportSourceOk,
  reportSourceDown,
  getSourcesSnapshot,
  getSourcesDetail,
  isMaintenanceMode,
  getMaintenanceInfo,
  setMaintenanceMode,
  getGlobalStatus,
  classify,
  formatSources,
};

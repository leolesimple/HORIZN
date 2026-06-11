'use strict';

const fs   = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const LOG_DIR   = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'data', 'logs');
const STARTED_AT = Date.now();

/**
 * Chiffres-clés du jour.
 */
function getTodaysStats() {
  const logs = _loadTodayLogs();

  const total     = logs.length;
  const errors    = logs.filter(l => l.status >= 400).length;
  const durations = logs.map(l => l.duration);

  // Regrouper par path
  const byPath = {};
  for (const l of logs) {
    byPath[l.path] = byPath[l.path] || { count: 0, totalDuration: 0, errors: 0 };
    byPath[l.path].count++;
    byPath[l.path].totalDuration += l.duration;
    if (l.status >= 400) byPath[l.path].errors++;
  }

  return {
    total,
    errors,
    errorRate:    total ? ((errors / total) * 100).toFixed(1) + '%' : '0%',
    avgDuration:  total ? Math.round(durations.reduce((a, b) => a + b, 0) / total) : 0,
    maxDuration:  total ? Math.max(...durations) : 0,
    minDuration:  total ? Math.min(...durations) : 0,
    byPath,
  };
}

/**
 * Dernières N entrées de logs (tous jours confondus).
 */
function getRecentLogs(limit = 50, since = null) {
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  const entries = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8').trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (since && new Date(entry.ts) < new Date(since)) continue;
        entries.push(entry);
      } catch { /* ligne invalide, skip */ }
    }
    if (entries.length >= limit) break;
  }

  return entries.slice(0, limit);
}

/**
 * Filtre les logs par endpoint, statut, ou durée min.
 */
function queryLogs({ path: filterPath, statusMin, statusMax, durationMin, limit = 50 } = {}) {
  const logs = _loadTodayLogs();

  return logs.filter(l => {
    if (filterPath && !l.path?.startsWith(filterPath)) return false;
    if (statusMin != null && (l.status || 0) < statusMin) return false;
    if (statusMax != null && (l.status || 0) > statusMax) return false;
    if (durationMin != null && (l.duration || 0) < durationMin) return false;
    return true;
  }).slice(-limit);
}

/**
 * État des fichiers de cache.
 */
function getCacheStatus() {
  if (!fs.existsSync(CACHE_DIR)) return { files: [], totalSize: 0 };
  const files = fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const p  = path.join(CACHE_DIR, f);
      const st = fs.statSync(p);
      return {
        file: f,
        size: st.size,
        ageSeconds: Math.round((Date.now() - st.mtimeMs) / 1000),
        modifiedAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.ageSeconds - b.ageSeconds);

  return {
    files,
    totalSize: files.reduce((s, f) => s + f.size, 0),
    count: files.length,
  };
}

/**
 * Santé du service.
 */
function getHealth() {
  const uptime = Math.round((Date.now() - STARTED_AT) / 1000);
  return {
    status: 'ok',
    uptime,
    uptimeHuman: _fmtDuration(uptime),
    startedAt: new Date(STARTED_AT).toISOString(),
    gtfsDb: _checkGTFS(),
    primReachable: null, // rempli à l'appel
  };
}

// ---------- helpers ----------

function _loadTodayLogs() {
  const today = new Date().toISOString().slice(0, 10);
  const p     = path.join(LOG_DIR, `${today}.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').trim().split('\n')
    .filter(Boolean)
    .map(l => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function _checkGTFS() {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'infostation.db');
  try {
    if (!fs.existsSync(dbPath)) return { available: false, reason: 'Fichier introuvable' };
    const st = fs.statSync(dbPath);
    return {
      available: true,
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

function _fmtDuration(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

module.exports = { getTodaysStats, getRecentLogs, queryLogs, getCacheStatus, getHealth };

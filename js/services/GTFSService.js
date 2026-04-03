'use strict';

const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'infostation.db');

class GTFSService {
  constructor() {
    this._db = null;
  }

  /** Ouvre la connexion SQLite (lazy init). */
  get db() {
    if (!this._db) {
      if (!fs.existsSync(DB_PATH)) {
        throw new Error(`Base SQLite introuvable : ${DB_PATH}. Lancez d'abord : npm run setup-gtfs`);
      }
      const Database = require('better-sqlite3');
      this._db = new Database(DB_PATH, { readonly: true });
      this._db.pragma('journal_mode = WAL');
      this._db.pragma('cache_size = -32000'); // 32 MB
    }
    return this._db;
  }

  /** Vérifie si la base GTFS est disponible. */
  isAvailable() {
    try {
      void this.db;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retourne les infos d'un arrêt + ses lignes.
   * @param {string} stopId
   */
  getStop(stopId) {
    const stop = this.db.prepare('SELECT * FROM stops WHERE stop_id = ?').get(stopId);
    if (!stop) return null;

    const routes = this.db.prepare(`
      SELECT DISTINCT r.route_id, r.route_short_name, r.route_type, r.route_color
      FROM stop_times st
      JOIN trips t ON st.trip_id = t.trip_id
      JOIN routes r ON t.route_id = r.route_id
      WHERE st.stop_id = ?
    `).all(stopId);

    return { ...stop, routes };
  }

  /**
   * Prochains départs GTFS statiques depuis un arrêt, dans une fenêtre horaire.
   * @param {string} stopId
   * @param {object} opts
   * @param {number} [opts.horizon=5]  - Fenêtre en heures (ex: 5 = H+5)
   * @param {number} [opts.limit=500]  - Garde-fou sur le nombre de résultats
   * @returns {Array}
   */
  getScheduledDepartures(stopId, { horizon = 5, limit = 500 } = {}) {
    const { dayCol, nowStr, todayStr } = _todayParams();
    const endStr = _horizonStr(horizon);

    const areaId = _resolveAreaId(stopId);

    const rows = this.db.prepare(`
      SELECT
        st.departure_time,
        st.arrival_time,
        st.stop_sequence,
        t.trip_id,
        t.trip_headsign,
        t.route_id,
        t.shape_id,
        r.route_short_name,
        r.route_type,
        r.route_color
      FROM stop_times st
      JOIN trips t     ON st.trip_id   = t.trip_id
      JOIN routes r    ON t.route_id   = r.route_id
      JOIN calendar c  ON t.service_id = c.service_id
      WHERE st.stop_id IN (
              SELECT stop_id FROM stops
              WHERE parent_station = ? OR stop_id = ?
            )
        AND st.departure_time >= ?
        AND st.departure_time <= ?
        AND c.${dayCol}       = 1
        AND c.start_date      <= ?
        AND c.end_date        >= ?
      ORDER BY st.departure_time
      LIMIT ?
    `).all(areaId, areaId, nowStr, endStr, todayStr, todayStr, limit);

    return rows.map(r => ({
      tripId:        r.trip_id,
      routeId:       r.route_id,
      line:          r.route_short_name,
      direction:     r.trip_headsign,
      destination:   r.trip_headsign,
      departure:     r.departure_time,
      arrival:       r.arrival_time,
      routeType:     r.route_type,
      routeColor:    r.route_color,
      source:        'scheduled',
    }));
  }

  /**
   * Tous les horaires d'un arrêt pour un jour donné.
   * @param {string} stopId
   * @param {Date}   date   - Défaut : aujourd'hui
   */
  getDayTimetable(stopId, date = new Date()) {
    const dayCol  = _dayColumn(date);
    const dateStr = _formatDate(date);
    const areaId  = _resolveAreaId(stopId);

    return this.db.prepare(`
      SELECT
        st.departure_time,
        st.arrival_time,
        t.trip_id,
        t.trip_headsign,
        r.route_short_name,
        r.route_type,
        r.route_color
      FROM stop_times st
      JOIN trips t    ON st.trip_id   = t.trip_id
      JOIN routes r   ON t.route_id   = r.route_id
      JOIN calendar c ON t.service_id = c.service_id
      WHERE st.stop_id IN (
              SELECT stop_id FROM stops
              WHERE parent_station = ? OR stop_id = ?
            )
        AND c.${dayCol}  = 1
        AND c.start_date <= ?
        AND c.end_date   >= ?
      ORDER BY st.departure_time
    `).all(areaId, areaId, dateStr, dateStr);
  }

  /**
   * Recherche d'arrêts par nom.
   * @param {string} query
   * @param {number} limit
   */
  searchStops(query, limit = 10) {
    return this.db.prepare(`
      SELECT stop_id, stop_name, stop_lat, stop_lon
      FROM stops
      WHERE stop_name LIKE ?
      LIMIT ?
    `).all(`%${query}%`, limit);
  }

  /**
   * Forme GeoJSON LineString d'un itinéraire.
   * @param {string} routeId
   */
  getRouteShape(routeId) {
    const trip = this.db.prepare(
      'SELECT shape_id FROM trips WHERE route_id = ? AND shape_id IS NOT NULL LIMIT 1'
    ).get(routeId);
    if (!trip) return null;

    const pts = this.db.prepare(`
      SELECT shape_pt_lon AS lng, shape_pt_lat AS lat
      FROM shapes
      WHERE shape_id = ?
      ORDER BY shape_pt_sequence
    `).all(trip.shape_id);

    if (!pts.length) return null;

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: pts.map(p => [p.lng, p.lat]),
      },
      properties: { routeId },
    };
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

// ---------- helpers ----------

function _todayParams() {
  const now    = new Date();
  const dayCol = _dayColumn(now);
  const h      = String(now.getHours()).padStart(2, '0');
  const m      = String(now.getMinutes()).padStart(2, '0');
  const s      = String(now.getSeconds()).padStart(2, '0');
  return {
    dayCol,
    nowStr:   `${h}:${m}:${s}`,
    todayStr: _formatDate(now),
  };
}

/**
 * Convertit un stopId PRIM (ex: "43082") en stop_id GTFS zone parente
 * (ex: "IDFM:monomodalStopPlace:43082").
 * Si l'ID contient déjà "IDFM:", on le retourne tel quel.
 */
function _resolveAreaId(stopId) {
  if (stopId.startsWith('IDFM:')) return stopId;
  return `IDFM:monomodalStopPlace:${stopId}`;
}

/** Calcule l'heure de fin GTFS (peut dépasser 24:00:00 pour services nuit). */
function _horizonStr(horizonHours) {
  const now          = new Date();
  const totalSec     = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const horizonSec   = totalSec + horizonHours * 3600;
  const h            = Math.floor(horizonSec / 3600);
  const m            = Math.floor((horizonSec % 3600) / 60);
  const s            = horizonSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function _dayColumn(date) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[date.getDay()];
}

function _formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

module.exports = new GTFSService();

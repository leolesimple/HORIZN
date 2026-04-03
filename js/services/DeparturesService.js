'use strict';

const axios   = require('axios');
const gtfs    = require('./GTFSService');
const cache   = require('./CacheService');
const { DEPARTURE_STATUS } = require('../constants');

const API_KEY  = process.env.PRIM_API_KEY  || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const PRIM_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring';
const DELAY_THRESHOLD_SECONDS = 300; // 5 min

class DeparturesService {
  /**
   * Retourne les prochains départs fusionnés GTFS + PRIM.
   *
   * @param {string}  stopId
   * @param {object}  opts
   * @param {boolean} [opts.includeGTFS=true]
   * @param {number}  [opts.limit=20]
   * @param {boolean} [opts.useCache=true]
   * @returns {Promise<Array>}
   */
  async getNextDepartures(stopId, opts = {}) {
    const { includeGTFS = true, horizon = 5, useCache = true } = opts;

    // --- 1. PRIM (temps réel) ---
    let primVisits = [];
    let primOk     = false;

    if (useCache) {
      const cached = cache.get(`IDFM:${stopId}`, 60);
      if (cached) {
        primVisits = _extractVisits(cached);
        primOk     = true;
      }
    }

    if (!primOk) {
      try {
        const resp = await axios.get(PRIM_URL, {
          params:  { MonitoringRef: `STIF:StopArea:SP:${stopId}:` },
          headers: { Accept: 'application/json', apikey: API_KEY },
          timeout: 5000,
        });
        cache.set(`IDFM:${stopId}`, resp.data);
        primVisits = _extractVisits(resp.data);
        primOk     = true;
      } catch (err) {
        // Silence volontaire: l'endpoint gère le fallback GTFS ou l'erreur globale.
      }
    }

    // --- 2. GTFS (statique) ---
    let gtfsRows  = [];
    let gtfsOk    = false;

    if (includeGTFS) {
      if (gtfs.isAvailable()) {
        try {
          gtfsRows = gtfs.getScheduledDepartures(stopId, { horizon });
          gtfsOk   = true;
        } catch (err) {
          // Silence volontaire: erreur propagée via le comportement global de l'API.
        }
      }
    }

    // --- 3. Fusion ---
    if (!primOk && !gtfsOk) return null;

    return _mergeAndNormalize(primVisits, gtfsRows, primOk, gtfsOk);
  }
}

// ---------- Parsing PRIM ----------

function _extractVisits(raw) {
  return raw?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
}

/** Convertit un passage PRIM en objet normalisé. */
function _normalizePrim(visit) {
  const mvj = visit.MonitoredVehicleJourney;
  const mc  = mvj.MonitoredCall;

  const aimed    = mc?.AimedDepartureTime    || mc?.AimedArrivalTime    || null;
  const expected = mc?.ExpectedDepartureTime || mc?.ExpectedArrivalTime || null;

  const delayMs = aimed && expected
    ? (new Date(expected).getTime() - new Date(aimed).getTime())
    : 0;
  const delaySec = Math.round(delayMs / 1000);

  const primStatus = mc?.DepartureStatus || '';
  const atStop     = mc?.VehicleAtStop?.value || mc?.VehicleAtStop || false;

  let status;
  if (primStatus === 'cancelled' || primStatus === 'noService') {
    status = DEPARTURE_STATUS.CANCELLED;
  } else if (atStop) {
    status = DEPARTURE_STATUS.ARRIVED;
  } else if (primStatus === 'departed') {
    status = DEPARTURE_STATUS.DEPARTED;
  } else if (delaySec > DELAY_THRESHOLD_SECONDS) {
    status = DEPARTURE_STATUS.DELAYED;
  } else {
    status = DEPARTURE_STATUS.EXPECTED;
  }

  return {
    line:        mvj.LineRef?.value        || null,
    direction:   mvj.DirectionRef?.value   || null,
    destination: mvj.DestinationName?.[0]?.value || null,
    mission:     mvj.JourneyNote?.map(n => n.value).join(', ') || '',
    trainNum:    mvj.TrainNumbers?.[0]?.value || null,
    vehicleFeatures: mvj.VehicleFeatureRef?.[0] || null,
    journeyRef:  mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || null,
    quai:        mc?.ArrivalPlatformName?.value || null,
    times: {
      st: { arrival: expected, departure: expected }, // compatible existant (Expected → st)
      rt: { arrival: aimed,    departure: aimed    }, // compatible existant (Aimed → rt)
    },
    aQuai:        atStop,
    status,
    delaySeconds: delaySec,
    source:       'realtime',
    hasRealtime:  true,
  };
}

/** Convertit un passage GTFS en objet normalisé. */
function _normalizeGTFS(row) {
  return {
    line:        row.line        || null,
    direction:   row.direction   || null,
    destination: row.destination || null,
    mission:     '',
    trainNum:    null,
    vehicleFeatures: null,
    journeyRef:  row.tripId      || null,
    quai:        null,
    times: {
      st: { arrival: row.arrival,   departure: row.departure },
      rt: { arrival: null,          departure: null          },
    },
    aQuai:        false,
    status:       DEPARTURE_STATUS.SCHEDULED,
    delaySeconds: 0,
    source:       'scheduled',
    hasRealtime:  false,
  };
}

/**
 * Fusionne données PRIM et GTFS.
 * Stratégie : on garde tous les passages PRIM, puis on complète avec GTFS
 * pour les horaires sans correspondance RT (match par heure de départ ± 3 min).
 */
function _mergeAndNormalize(primVisits, gtfsRows, primOk, gtfsOk) {
  const result = [];

  // Map PRIM par heure aimed (pour déduplication GTFS)
  const primTimes = new Set();

  for (const visit of primVisits) {
    const normalized = _normalizePrim(visit);
    result.push(normalized);

    const mc   = visit.MonitoredVehicleJourney?.MonitoredCall;
    const ref  = mc?.AimedDepartureTime || mc?.AimedArrivalTime;
    if (ref) {
      // Bucket de 3 min autour de l'horaire aimed
      const base = new Date(ref).getTime();
      for (let offset = -180000; offset <= 180000; offset += 60000) {
        primTimes.add(Math.floor((base + offset) / 60000));
      }
    }
  }

  // Compléter avec GTFS non couvert par PRIM
  for (const row of gtfsRows) {
    const depTime = _gtfsTimeToDate(row.departure);
    if (!depTime) {
      result.push(_normalizeGTFS(row));
      continue;
    }
    const bucket = Math.floor(depTime.getTime() / 60000);
    if (!primTimes.has(bucket)) {
      result.push(_normalizeGTFS(row));
    }
  }

  // Tri chronologique
  result.sort((a, b) => {
    const ta = _parseTime(a.times.st?.departure || a.times.rt?.departure);
    const tb = _parseTime(b.times.st?.departure || b.times.rt?.departure);
    return ta - tb;
  });

  return result;
}

/** Convertit "HH:MM:SS" (GTFS) en objet Date du jour. */
function _gtfsTimeToDate(timeStr) {
  if (!timeStr) return null;
  const [h, m, s] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h % 24, m, s || 0, 0);
  return d;
}

/** Retourne un timestamp pour tri. Accepte ISO string ou "HH:MM:SS". */
function _parseTime(val) {
  if (!val) return Infinity;
  if (val.includes('T') || val.includes('-')) return new Date(val).getTime();
  // Format GTFS HH:MM:SS
  const [h, m, s] = val.split(':').map(Number);
  const d = new Date();
  d.setHours(h % 24, m, s || 0, 0);
  return d.getTime();
}

module.exports = new DeparturesService();

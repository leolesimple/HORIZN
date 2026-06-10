'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const API_KEY    = process.env.PRIM_API_KEY || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const PRIM_BASE  = 'https://prim.iledefrance-mobilites.fr/marketplace';
const TIMEOUT_MS = 8000;
const CACHE_TTL  = 30; // secondes

const STOPS_MAP_PATH = process.env.STOPS_MAP_PATH
  || path.join(__dirname, '..', '..', 'json', 'arrets-stopPoint.json');

let stopsMap = [];
try {
  if (fs.existsSync(STOPS_MAP_PATH)) {
    stopsMap = JSON.parse(fs.readFileSync(STOPS_MAP_PATH, 'utf-8'));
    console.log(`[NextService] ${stopsMap.length} arrêts chargés`);
  }
} catch (err) {
  console.error(`[NextService] Impossible de charger ${STOPS_MAP_PATH}: ${err.message}`);
}

// Cache en mémoire { stopId: { data, ts } }
const cache = {};

/**
 * Récupère les prochains passages pour un arrêt.
 *
 * @param {string} stopId  – ID d'arrêt (zdaid, ex: "DU496" pour La Défense)
 * @returns {Promise<Object>}
 */
async function getNext(stopId) {
  const now = Date.now();

  // Cache chaud ?
  const cached = cache[stopId];
  if (cached && (now - cached.ts) < CACHE_TTL * 1000) {
    return cached.data;
  }

  // Appel PRIM StopMonitoring
  const url = `${PRIM_BASE}/stop-monitoring`;
  const resp = await axios.get(url, {
    params: {
      MonitoringRef: `STIF:StopArea:SP:${stopId}:`,
    },
    headers: {
      accept: 'application/json',
      apikey: API_KEY,
    },
    timeout: TIMEOUT_MS,
  });

  const raw = resp.data;
  const visits = raw?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];

  const next = visits.map(visit => {
    const mvj = visit.MonitoredVehicleJourney;
    const mc  = mvj.MonitoredCall;
    return {
      line:        mvj.LineRef?.value || null,
      direction:   mvj.DirectionRef?.value || null,
      destination: mvj.DestinationName?.[0]?.value || null,
      mission:     (mvj.JourneyNote || []).map(n => n.value).join(', ') || null,
      trainNum:    mvj.TrainNumbers?.[0]?.value || null,
      quai:        mc?.ArrivalPlatformName?.value || null,
      times: {
        scheduled: {
          arrival:   mc?.AimedArrivalTime   || null,
          departure: mc?.AimedDepartureTime || null,
        },
        realtime: {
          arrival:   mc?.ExpectedArrivalTime   || null,
          departure: mc?.ExpectedDepartureTime || null,
        },
      },
      aQuai:  mc?.VehicleAtStop?.value === 'true',
      status: mc?.DepartureStatus || null,
    };
  });

  // Infos de l'arrêt depuis le fichier
  const stopInfo = stopsMap.find(s => s.zdaid === stopId);

  const payload = {
    stopId,
    stopName:  stopInfo?.arrname          || null,
    town:      stopInfo?.arrtown          || null,
    accessible: stopInfo?.arraccessibility === 'true',
    geopoint:  stopInfo?.arrgeopoint      || null,
    departures: next,
  };

  // Mettre en cache
  cache[stopId] = { data: payload, ts: now };

  return payload;
}

module.exports = { getNext };

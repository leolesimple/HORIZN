'use strict';

const traffic = require('./TrafficService');

/**
 * Motifs pour identifier les perturbations d'équipements.
 */
const EQUIPMENT_KEYWORDS = [
  'ascenseur', 'escalator', 'escalier mécanique', 'escalier roulant',
];

/**
 * Récupère les pannes d'équipements (ascenseurs, escalators) pour un arrêt donné.
 *
 * Les données proviennent du cache disruptions_bulk déjà maintenu par TrafficService.
 *
 * @param {string} [stopId]  – Optionnel : filtrer par arrêt (ex: "stop_area:IDFM:71135")
 * @returns {Promise<Array>}
 */
async function getEquipmentStatus(stopId) {
  // On récupère TOUTES les disruptions (en force-refresh si nécessaire)
  // getLineTraffic(null, null, { forceRefresh }) — mais on peut pas...
  // On utilise le cache partagé via TrafficService
  const allDis = await _fetchAll();

  // Filtrer : équipements uniquement
  let eq = allDis.filter(d => {
    const title   = (d.title || '').toLowerCase();
    const message = (d.message || '').toLowerCase();
    const combined = title + ' ' + message;

    return EQUIPMENT_KEYWORDS.some(kw => combined.includes(kw));
  });

  // Filtrer par arrêt si demandé
  if (stopId) {
    const normalized = stopId.includes(':') ? stopId : `stop_area:IDFM:${stopId}`;
    eq = eq.filter(d => {
      const sections = d.impactedSections || [];
      return sections.some(s =>
        s.fromId === normalized ||
        s.toId   === normalized
      );
    });
  }

  return _normalize(eq);
}

/**
 * Récupère toutes les disruptions via le cache de TrafficService (90s).
 * Évite un appel PRIM dédié = économie de quota.
 */
async function _fetchAll() {
  const all = await traffic.getLineTraffic(null, null);
  return all;
}

function _normalize(rawList) {
  return rawList.map(d => {
    const sections = (d.impactedSections || []).map(s => ({
      lineId:   s.lineId   || null,
      fromId:   s.fromId   || null,
      fromName: s.fromName || null,
      toId:     s.toId     || null,
      toName:   s.toName   || null,
    }));

    const periods = (d.applicationPeriods || []).map(p => ({
      begin: p.begin || null,
      end:   p.end   || null,
    }));

    return {
      id:              d.id || null,
      title:           d.title || null,
      message:         _stripHtml(d.message || ''),
      cause:           d.cause || null,
      severity:        d.severity || null,
      lastUpdate:      d.lastUpdate || null,
      applicationPeriods: periods,
      impactedSections:   sections,
    };
  });
}

function _stripHtml(html) {
  return html
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#233;/g, 'é').replace(/&#200;/g, 'È')
    .replace(/&#224;/g, 'à').replace(/&#231;/g, 'ç')
    .replace(/&#8217;/g, "'").replace(/&#8221;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

module.exports = { getEquipmentStatus };

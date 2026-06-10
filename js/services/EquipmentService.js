'use strict';

const traffic = require('./TrafficService');

/**
 * Motifs pour identifier les perturbations d'équipements.
 */
const EQUIPMENT_KEYWORDS = [
  'ascenseur', 'escalator', 'escalier mécanique', 'escalier roulant',
  'ascenseur', 'escalator', 'escalator', 'escalator mécanique',
  'ascenseur', 'escalier mécanique', 'escalier roulant',
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
        (s.from?.id || '') === normalized ||
        (s.to?.id   || '') === normalized
      );
    });
  }

  return _normalize(eq);
}

/**
 * Récupère toutes les disruptions depuis le cache partagé.
 * On appelle TrafficService en interne.
 */
async function _fetchAll() {
  // Réimplémentation légère pour éviter la dépendance circulaire
  const axios  = require('axios');
  const API_KEY      = process.env.PRIM_API_KEY || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
  const url = 'https://prim.iledefrance-mobilites.fr/marketplace/disruptions_bulk/disruptions/v2';

  const resp = await axios.get(url, {
    headers: { accept: 'application/json', apikey: API_KEY },
    timeout: 15000,
  });

  return resp.data?.disruptions || [];
}

function _normalize(rawList) {
  return rawList.map(d => {
    const sections = (d.impactedSections || []).map(s => ({
      lineId:   s.lineId     || null,
      fromId:   s.from?.id   || null,
      fromName: s.from?.name || null,
      toId:     s.to?.id     || null,
      toName:   s.to?.name   || null,
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

'use strict';

const axios = require('axios');

const API_KEY      = process.env.PRIM_API_KEY || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const PRIM_BASE    = 'https://prim.iledefrance-mobilites.fr/marketplace';
const TIMEOUT_MS   = 15000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache en mémoire
let cache = {
  data:     null,
  fetchedAt: 0,
};

/**
 * Récupère les perturbations trafic pour une ligne et/ou un arrêt.
 *
 * L'API disruptions_bulk couvre l'INTÉGRALITÉ des lignes
 * (RATP + SNCF/Transilien + Bus), contrairement à general-message
 * qui ne couvre que le RATP.
 *
 * @param {string}  [lineRef] – ID technique IDFM (ex: "C01371" / "C01739")
 * @param {string}  [stopId]  – ID d'arrêt IDFM (ex: "stop_area:IDFM:71135" ou "71135")
 * @param {object}  [opts]
 * @param {boolean} [opts.forceRefresh]  – Ignorer le cache
 * @returns {Promise<Array>}  Liste des perturbations formatées
 */
async function getLineTraffic(lineRef, stopId, opts = {}) {
  // Recharger si le cache est expiré ou forcé
  const now = Date.now();
  if (!cache.data || opts.forceRefresh || (now - cache.fetchedAt) > CACHE_TTL_MS) {
    await _fetchAllDisruptions();
  }

  let matched = cache.data;

  // Filtre par ligne
  if (lineRef) {
    const targetId = `line:IDFM:${lineRef}`;
    matched = matched.filter(d => {
      const sections = d.impactedSections || [];
      return sections.some(s => (s.lineId || '') === targetId);
    });
  }

  // Filtre par arrêt (gare/station)
  if (stopId) {
    // Normaliser l'ID d'arrêt : accepter "71135" ou "stop_area:IDFM:71135"
    const normalized = stopId.includes(':')
      ? stopId
      : `stop_area:IDFM:${stopId}`;

    matched = matched.filter(d => {
      const sections = d.impactedSections || [];
      return sections.some(s => {
        const fromId = s.from?.id || '';
        const toId   = s.to?.id   || '';
        return fromId === normalized || toId === normalized;
      });
    });
  }

  return _normalize(matched);
}

/**
 * Récupère TOUTES les perturbations depuis PRIM.
 */
async function _fetchAllDisruptions() {
  const url = `${PRIM_BASE}/disruptions_bulk/disruptions/v2`;

  const resp = await axios.get(url, {
    headers: {
      accept: 'application/json',
      apikey: API_KEY,
    },
    timeout: TIMEOUT_MS,
  });

  const disruptions = resp.data?.disruptions || [];

  cache.data     = disruptions;
  cache.fetchedAt = Date.now();

  return disruptions;
}

/**
 * Normalise les disruptions bulk en objets simples.
 */
function _normalize(rawList) {
  return rawList.map(d => {
    const sections = (d.impactedSections || []).map(s => ({
      lineId:   s.lineId     || null,
      fromId:   s.from?.id   || null,
      fromName: s.from?.name || null,
      toId:     s.to?.id     || null,
      toName:   s.to?.name   || null,
    }));

    // Périodes
    const periods = (d.applicationPeriods || []).map(p => ({
      begin: p.begin || null,
      end:   p.end   || null,
    }));

    return {
      id:              d.id || null,
      title:           d.title || null,
      message:         _stripHtml(d.message || ''),
      shortMessage:    d.shortMessage || null,
      cause:           d.cause || null,
      severity:        d.severity || null,
      lastUpdate:      d.lastUpdate || null,
      applicationPeriods: periods,
      impactedSections:   sections,
      tags:            d.tags || [],
    };
  });
}

/**
 * Nettoie les balises HTML brutes.
 */
function _stripHtml(html) {
  return html
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#233;/g, 'é')
    .replace(/&#200;/g, 'È')
    .replace(/&#224;/g, 'à')
    .replace(/&#226;/g, 'â')
    .replace(/&#238;/g, 'î')
    .replace(/&#244;/g, 'ô')
    .replace(/&#251;/g, 'û')
    .replace(/&#231;/g, 'ç')
    .replace(/&#8221;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&#8230;/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { getLineTraffic };

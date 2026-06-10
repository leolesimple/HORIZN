'use strict';

const axios = require('axios');

const API_KEY  = process.env.PRIM_API_KEY || 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const PRIM_BASE    = 'https://prim.iledefrance-mobilites.fr/marketplace';
const TIMEOUT_MS   = 8000;

/**
 * Récupère les messages d'info trafic PRIM pour une ligne.
 *
 * @param {string} lineRef  – ID technique IDFM (ex: "C01371" pour Métro 1)
 * @param {object} [opts]
 * @param {string} [opts.channel]  – Filtre: "Perturbation" (défaut) | "Information" | "Commercial"
 * @returns {Promise<Array>}  Liste des messages d'info trafic
 */
async function getLineTraffic(lineRef, opts = {}) {
  const channel = opts.channel || 'Perturbation';
  const url = `${PRIM_BASE}/general-message`;

  const resp = await axios.get(url, {
    params: {
      InfoChannelRef: channel,
      LineRef:        `STIF:Line::${lineRef}:`,
    },
    headers: {
      accept:  'application/json',
      apikey:  API_KEY,
    },
    timeout: TIMEOUT_MS,
  });

  const delivery = resp.data?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0];
  if (!delivery || delivery.Status !== 'true') {
    return [];
  }

  // Si l'API retourne une erreur (LineRef invalide, etc.)
  if (delivery.ErrorCondition) {
    const errDesc = delivery.ErrorCondition.ErrorInformation?.ErrorDescription
      || delivery.ErrorCondition.ErrorInformation?.ErrorText
      || 'Erreur inconnue';
    throw new Error(`PRIM GeneralMessage: ${errDesc}`);
  }

  return _normalizeMessages(delivery.InfoMessage || []);
}

/**
 * Normalise les messages SIRI en objets simples.
 */
function _normalizeMessages(rawMessages) {
  return rawMessages.map(msg => {
    const content = msg.Content || {};
    const titleArr   = content.Title       || [];
    const descArr    = content.Description || [];

    // Les champs peuvent être des tableaux d'objets {value: '...'} ou des chaînes
    const extract = arr => {
      if (!Array.isArray(arr)) return String(arr || '');
      return arr.map(v => (typeof v === 'object' ? (v.value || v._text || '') : v))
                .filter(Boolean).join(' ');
    };

    return {
      id:        msg.InfoMessageRef || null,
      channel:   msg.InfoChannelRef || null,
      title:     extract(titleArr),
      description: extract(descArr),
      period:    msg.ValidityPeriod || null,
      priority:  msg.Priority || null,
      raw:       msg,
    };
  });
}

module.exports = { getLineTraffic };

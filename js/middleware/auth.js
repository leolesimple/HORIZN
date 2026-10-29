'use strict';

/**
 * Auth middleware — API Keys à deux niveaux + JWT.
 *
 * Niveaux :
 *   FRONTEND → accès aux routes publiques (/next, /traffic, …)
 *   ADMIN    → accès aux routes admin (/admin/*) + routes publiques
 *
 * Sources des clés (cumulatives) :
 *   1. Variables d'env FRONTEND_API_KEY / ADMIN_API_KEY
 *   2. Fichier data/api_keys.json (géré par js/scripts/keys.js)
 *
 * Configuration (.env) :
 *   FRONTEND_API_KEY — clé pour les apps frontend (fallback si fichier absent)
 *   ADMIN_API_KEY    — clé pour l'admin (fallback)
 *   JWT_SECRET       — secret JWT (optionnel)
 */

const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');

const KEYS_FILE = path.join(__dirname, '..', '..', 'data', 'api_keys.json');

// Cache des clés depuis le fichier
let _fileKeys = null;
let _fileKeysMtime = 0;

/**
 * Recharge les clés du fichier uniquement si modifié.
 */
function getFileKeys() {
  try {
    const st = fs.statSync(KEYS_FILE);
    if (st.mtimeMs !== _fileKeysMtime) {
      const raw = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
      _fileKeys = raw.map(k => ({ key: k.key, role: k.role }));
      _fileKeysMtime = st.mtimeMs;
    }
  } catch {
    _fileKeys = [];
  }
  return _fileKeys || [];
}

/**
 * Rassemble toutes les clés (env + fichier).
 */
function getAllKeys() {
  const keys = [];

  // Depuis les variables d'env
  if (process.env.FRONTEND_API_KEY) keys.push({ key: process.env.FRONTEND_API_KEY, role: 'frontend' });
  if (process.env.ADMIN_API_KEY)    keys.push({ key: process.env.ADMIN_API_KEY,    role: 'admin' });

  // Depuis le fichier managé
  keys.push(...getFileKeys());

  return keys;
}

/**
 * Vérifie une API key et retourne son rôle ('admin', 'frontend') ou null.
 */
function checkApiKey(req) {
  const key = req.headers['x-api-key'];
  if (!key) return null;

  const all = getAllKeys();
  for (const k of all) {
    if (k.key === key) return k.role;
  }
  return null;
}

/**
 * Vérifie un JWT.
 * Retourne 'user' si valide, null sinon.
 * Attache le payload dans req.user.
 */
function checkJwt(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  try {
    req.user = jwt.verify(auth.slice(7), secret);
    return 'user';
  } catch {
    return null;
  }
}

/**
 * Retourne le plus haut niveau d'auth pour la requête.
 */
function getAuthLevel(req) {
  const apiLevel = checkApiKey(req);
  if (apiLevel === 'admin') return 'admin';
  if (apiLevel === 'frontend') return 'frontend';

  const jwtLevel = checkJwt(req);
  if (jwtLevel) return jwtLevel;

  return null;
}

// ---------- Middlewares ----------

function requireAdmin(req, res, next) {
  if (getAuthLevel(req) === 'admin') return next();
  return res.status(401).json({ error: 'Accès admin requis.', hint: 'Fournissez une clé admin via X-API-Key.' });
}

function requireFrontend(req, res, next) {
  const level = getAuthLevel(req);
  if (level === 'admin' || level === 'frontend') return next();
  return res.status(401).json({ error: 'Authentification requise.', hint: 'Fournissez une clé API via X-API-Key.' });
}

function optionalAuth(req, res, next) {
  checkJwt(req);
  next();
}

module.exports = { requireAdmin, requireFrontend, optionalAuth };

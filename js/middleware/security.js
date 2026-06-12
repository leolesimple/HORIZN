'use strict';

/**
 * Middleware de sécurité — HORIZN
 *
 * Bloque les fuites de fichiers sensibles et ajoute les headers de sécurité.
 * S'exécute AVANT toutes les routes.
 *
 * Patterns bloqués :
 *   - Fichiers cachés (.env, .git, etc.)
 *   - Fichiers de config/data sensibles par nom exact
 *   - Path traversal (..)
 */

const SENSITIVE_FILES = new Set([
  'api_keys.json',
  '.env',
  '.env.example',
  '.gitignore',
  '.gitmessage',
  'package.json',
  'package-lock.json',
  'docker-compose.yml',
  'Dockerfile',
  'compose.yaml',
]);

/**
 * Bloque les requêtes vers des fichiers sensibles.
 */
function denySensitivePaths(req, res, next) {
  const pathname = req.path;  // Express 5 : req.path normalisé

  // Path traversal
  if (pathname.includes('..')) {
    return res.status(403).json({ error: 'Path non autorisé.' });
  }

  // Fichiers cachés (commençant par un point)
  const segments = pathname.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith('.')) {
      return res.status(403).json({ error: 'Fichier système non autorisé.' });
    }
  }

  // Fichiers sensibles par nom exact (à la racine)
  if (segments.length <= 2) {
    const last = segments[segments.length - 1] || '';
    if (SENSITIVE_FILES.has(last)) {
      return res.status(403).json({ error: 'Fichier système non autorisé.' });
    }
  }

  next();
}

/**
 * Ajoute les headers de sécurité standard.
 */
function securityHeaders(req, res, next) {
  // Protection MIME (empêche le reniflage de type)
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Empêche le chargement dans un iframe (clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');

  // Cache explicite pour les réponses API
  res.setHeader('Cache-Control', 'no-store');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
}

module.exports = { denySensitivePaths, securityHeaders };

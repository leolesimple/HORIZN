#!/usr/bin/env node
'use strict';

/**
 * Gestionnaire de clés API — HORIZN
 *
 * Usage :
 *   node js/scripts/keys.js generate --role <frontend|admin> --name "<description>"
 *   node js/scripts/keys.js list
 *   node js/scripts/keys.js revoke --name "<description>"
 *   node js/scripts/keys.js revoke --key "<la clé>"
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_FILE = process.env.API_KEYS_FILE
  || path.join(__dirname, '..', '..', 'data', 'api_keys.json');

// ---------- Stockage ----------

function loadKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Erreur lecture', KEYS_FILE, ':', err.message);
  }
  return [];
}

function saveKeys(keys) {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2) + '\n');
  console.log(`✓ ${keys.length} clé(s) enregistrée(s) dans ${KEYS_FILE}`);
}

function generateKey() {
  return 'hzn_' + crypto.randomBytes(20).toString('hex');
}

/** "il y a 3 min" / "jamais" à partir d'un ISO 8601. */
function relTime(iso) {
  if (!iso) return 'jamais';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return 'jamais';
  const s = Math.round(diff / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

// ---------- Commandes ----------

function cmdList() {
  const keys = loadKeys();
  if (keys.length === 0) {
    console.log('Aucune clé enregistrée.');
    return;
  }

  console.log(`\n${keys.length} clé(s) API :\n`);
  console.log('  RÔLE      DESCRIPTION                        CLÉ                     DERNIÈRE UTIL.        UTIL.');
  console.log('  ─────     ───────────                        ───                     ──────────────        ─────');
  for (const k of keys) {
    const role  = k.role.padEnd(10);
    const name  = (k.name || '').padEnd(35);
    const key   = (k.key.slice(0, 12) + '…' + k.key.slice(-4)).padEnd(24);
    const last  = relTime(k.lastUsedAt).padEnd(21);
    const count = String(k.usageCount || 0);
    console.log(`  ${role} ${name} ${key} ${last} ${count}`);
  }
  console.log('\n  Quota temps réel par clé : GET /admin/keys\n');
}

function cmdGenerate(role, name) {
  if (!['frontend', 'admin'].includes(role)) {
    console.error('Erreur : role doit être "frontend" ou "admin"');
    process.exit(1);
  }

  const keys = loadKeys();

  // Éviter les doublons de nom
  if (name && keys.some(k => k.name === name)) {
    console.error(`Erreur : une clé nommée "${name}" existe déjà.`);
    process.exit(1);
  }

  const key = generateKey();
  keys.push({ key, role, name: name || null, createdAt: new Date().toISOString() });
  saveKeys(keys);

  console.log(`\n  Rôle      : ${role}`);
  console.log(`  Nom       : ${name || '(non nommée)'}`);
  console.log(`  Clé       : ${key}`);
  console.log(`  Fichier   : ${KEYS_FILE}\n`);
  console.log('  Utilisez cette clé dans le header X-API-Key.\n');
}

function cmdRevoke(name, key) {
  let keys = loadKeys();
  const before = keys.length;

  if (name) {
    keys = keys.filter(k => k.name !== name);
  } else if (key) {
    keys = keys.filter(k => k.key !== key);
  } else {
    console.error('Erreur : précisez --name ou --key');
    process.exit(1);
  }

  if (keys.length === before) {
    console.error('Aucune clé trouvée.');
    process.exit(1);
  }

  saveKeys(keys);
  console.log(`✓ Clé révoquée. Il reste ${keys.length} clé(s).`);
}

// ---------- Main ----------

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`
  Usage:
    node js/scripts/keys.js generate --role <frontend|admin> [--name "<desc>"]
    node js/scripts/keys.js list
    node js/scripts/keys.js revoke --name "<desc>"
    node js/scripts/keys.js revoke --key "<key>"

  Exemples:
    node js/scripts/keys.js generate --role frontend --name "infostation prod"
    node js/scripts/keys.js generate --role admin --name "admin leo"
    node js/scripts/keys.js list
    node js/scripts/keys.js revoke --name "admin leo"
`);
  process.exit(0);
}

function getFlag(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

switch (cmd) {
  case 'list':
    cmdList();
    break;
  case 'generate':
    cmdGenerate(getFlag('--role'), getFlag('--name'));
    break;
  case 'revoke':
    cmdRevoke(getFlag('--name'), getFlag('--key'));
    break;
  default:
    console.error('Commande inconnue :', cmd);
    console.log('Utilisez --help pour les commandes disponibles.');
    process.exit(1);
}

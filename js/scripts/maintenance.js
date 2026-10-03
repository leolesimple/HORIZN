#!/usr/bin/env node
'use strict';

/**
 * Mode maintenance — HORIZN
 *
 * Bascule le service en mode maintenance (503 sur toutes les routes de
 * données) sans redémarrer le serveur : lit/écrit directement
 * data/maintenance.json via SystemStatusService, rechargé à chaud par le
 * serveur (stat throttlé à 1s, comme data/api_keys.json).
 *
 * Usage :
 *   node js/scripts/maintenance.js on [--reason "texte"]
 *   node js/scripts/maintenance.js off
 *   node js/scripts/maintenance.js status
 */

const path = require('path');

// Charger .env comme keys.js/setupGTFS.js : sinon MAINTENANCE_FILE défini
// dans .env est ignoré par la CLI, qui opérerait sur un fichier différent
// de celui du serveur.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const os = require('os');
const statusService = require('../services/SystemStatusService');

const args = process.argv.slice(2);
const cmd  = args[0];

function getFlag(name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function printState(state) {
  console.log(`\n  Maintenance : ${state.enabled ? 'ACTIVÉE' : 'désactivée'}`);
  if (state.enabled) {
    console.log(`  Raison      : ${state.reason || '(non précisée)'}`);
  }
  console.log(`  Depuis      : ${state.setAt || '—'}`);
  console.log(`  Par         : ${state.setBy || '—'}\n`);
}

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`
  Usage:
    node js/scripts/maintenance.js on [--reason "<texte>"]
    node js/scripts/maintenance.js off
    node js/scripts/maintenance.js status

  Effet : bascule data/maintenance.json, relu à chaud par le serveur en
  moins d'1s (pas besoin de redémarrer). Toutes les routes de données
  (/next, /timetable, /traffic, /equipments, /search) répondent alors
  503 { status: "maintenance" } tant que le flag est actif.
`);
  process.exit(0);
}

switch (cmd) {
  case 'status':
    printState(statusService.getMaintenanceInfo());
    break;

  case 'on': {
    const reason = getFlag('--reason');
    const actor  = `cli:${os.userInfo().username}`;
    const state  = statusService.setMaintenanceMode({ enabled: true, reason, actor });
    console.log('✓ Mode maintenance activé.');
    printState(state);
    break;
  }

  case 'off': {
    const actor = `cli:${os.userInfo().username}`;
    const state = statusService.setMaintenanceMode({ enabled: false, actor });
    console.log('✓ Mode maintenance désactivé.');
    printState(state);
    break;
  }

  default:
    console.error('Commande inconnue :', cmd);
    console.log('Utilisez --help pour les commandes disponibles.');
    process.exit(1);
}

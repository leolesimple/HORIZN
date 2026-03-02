/*
 * Copyright (c) 2025 Léo Lesimple.
 *  Tous droits réservés.
 *
 *  Ce code source est la propriété exclusive de Léo Lesimple.
 *  Toute reproduction, distribution, modification ou utilisation de ce code,
 *  en tout ou en partie, sans autorisation écrite préalable est strictement interdite.
 *
 *  Créé le : 7/2/25, 10:24 PM.
 */

const https = require('https');

const endpoint = 'https://isa.infostation.fr/nextTrains?stopId=43082';
const discordWebhookUrl = 'https://discord.com/api/webhooks/1390065279668588754/kmTf29ifDs4ZlB43gn66Id_QWrDY_nAXi7f64U6SVJYORV0curWqdk7B2SbkKCf8rQoV';

function sendDiscordAlert(message) {
    const payload = JSON.stringify({
        username: 'InfoStation Monitor',
        avatar_url: 'https://infostation.fr/img/isa-favicon.png',
        content: `🚨 InfoStation Alert: ${message}`
    });

    const req = https.request(discordWebhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, res => {
        console.log(`[Discord] Status: ${res.statusCode}`);
    });

    req.on('error', error => {
        console.error('[Discord] Erreur :', error);
    });

    req.write(payload);
    req.end();
}

https.get(endpoint, res => {
    if (res.statusCode !== 200) {
        sendDiscordAlert(`HTTP ${res.statusCode} sur ${endpoint}`);
    } else {
        console.log(`[${new Date().toISOString()}] ✅ InfoStation OK`);
    }
}).on('error', err => {
    sendDiscordAlert(`ÉCHEC : ${err.message}`);
});

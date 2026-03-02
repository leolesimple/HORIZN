const https = require('https');

const webhookUrl = 'https://discord.com/api/webhooks/1390065279668588754/kmTf29ifDs4ZlB43gn66Id_QWrDY_nAXi7f64U6SVJYORV0curWqdk7B2SbkKCf8rQoV';

const payload = JSON.stringify({
    username: 'InfoStation Monitor',
    content: '✅ Message test depuis Node.js (version fixée)'
});

const req = https.request(webhookUrl, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
}, res => {
    console.log(`Status Discord: ${res.statusCode}`);

    res.on('data', d => process.stdout.write(d));
});

req.on('error', error => {
    console.error('Erreur Discord:', error);
});

req.write(payload);
req.end();

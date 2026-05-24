const { Client, LocalAuth } = require('whatsapp-web.js');
const { dbRun } = require('../api/db-helpers');

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './data/wwebjs-auth'
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', async (qr) => {
    console.log('QR RECEIVED');
    await dbRun("UPDATE scraper_status SET status = 'qr_ready', qr_code = ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1", [qr]);
});

client.on('ready', async () => {
    console.log('Client is ready!');
    await dbRun("UPDATE scraper_status SET status = 'authenticated', qr_code = NULL, last_updated = CURRENT_TIMESTAMP WHERE id = 1", []);
});

client.on('authenticated', async () => {
    console.log('AUTHENTICATED');
});

client.on('auth_failure', async msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    await dbRun("UPDATE scraper_status SET status = 'disconnected', qr_code = NULL, last_updated = CURRENT_TIMESTAMP WHERE id = 1", []);
});

client.on('disconnected', async (reason) => {
    console.log('Client was logged out', reason);
    await dbRun("UPDATE scraper_status SET status = 'disconnected', qr_code = NULL, last_updated = CURRENT_TIMESTAMP WHERE id = 1", []);
});

module.exports = client;

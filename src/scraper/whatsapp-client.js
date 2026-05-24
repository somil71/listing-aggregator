const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './data/wwebjs-auth'
    }),
    // Increase protocol timeout to 120s (default is 30s) — needed for accounts with many chats
    authTimeoutMs: 120000,
    takeoverOnConflict: true,
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        protocolTimeout: 120000,  // 2 minutes instead of default 30s
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',   // prevents crashes on low memory
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('authenticated', () => {
    console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
});

module.exports = client;

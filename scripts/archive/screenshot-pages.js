const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Users/Somil/.cache/puppeteer/chrome/win64-148.0.7778.97/chrome-win64/chrome.exe';
const OUT = path.join(__dirname, 'screenshots-out');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: '01-landing', url: 'http://localhost:3000/' },
  { name: '02-about',   url: 'http://localhost:3000/about' },
  { name: '03-contact', url: 'http://localhost:3000/contact' },
  { name: '04-privacy', url: 'http://localhost:3000/privacy' },
  { name: '05-terms',   url: 'http://localhost:3000/terms' },
  { name: '06-login',   url: 'http://localhost:3000/login' },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  for (const { name, url } of PAGES) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      await new Promise(r => setTimeout(r, 2000));
      const file = path.join(OUT, name + '.jpg');
      await page.screenshot({ path: file, type: 'jpeg', quality: 88, fullPage: false });
      console.log('OK ' + name);
    } catch(e) {
      console.log('FAIL ' + name + ': ' + e.message);
    }
  }
  await browser.close();
  console.log('Done - ' + OUT);
})();

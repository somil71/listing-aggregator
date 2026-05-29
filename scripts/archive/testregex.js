require('dotenv').config();
// Import message-parser directly (no LLM needed)
const { MessageParser } = require('../src/scraper/message-parser');
const parser = new MessageParser();

const tests = [
  "Alpha 2 \nIndependent \nFully furnished \n2rk \nRent 21k only",
  "Alpha 2\n2rk \nFurnished \nRent 20 k \nIndependent",
  "Alpha 2\nSingle-story \nRent 16k\nFull independent \n2rk separate entry",
  "2 BHK flat in Bandra West, rent 55k",
  "Studio in Marina, AED 5500/month",
  "3 BHK villa for sale, 2.5 Cr",
];

for (const msg of tests) {
  const r = parser.parse(msg, 'Test');
  console.log(`[${r.currency}] price=${r.price} beds=${r.bedrooms} loc="${r.location}" | "${msg.split('\n')[0]}"`);
}

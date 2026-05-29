require('dotenv').config();
const { MessageParser } = require('../src/scraper/message-parser');
const parser = new MessageParser();

const extra = [
  "Beta2, independent, furnished, 21k",
  "Beta 2, independent, furnished, 21k",
  "JLT studio, 50k/yr, chiller free, parking, fully furnished",
  "2 bedroom in Jumeirah, 120k AED",
  "Flat available, 15k, call now",
];
for (const msg of extra) {
  const r = parser.parse(msg, 'Test');
  console.log(`[${r.currency||'null'}] price=${r.price} beds=${r.bedrooms} loc="${r.location}" | "${msg.slice(0,60)}"`);
}

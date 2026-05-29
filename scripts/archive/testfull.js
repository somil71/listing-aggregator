require('dotenv').config();
const { MessageParser } = require('../src/scraper/message-parser');
const p = new MessageParser();

const tests = [
  // Indian — should be INR
  ["Alpha 2\n2rk\nFurnished\nRent 20k\nIndependent",               "INR"],
  ["Beta2, independent, furnished, 21k",                            "INR"],
  ["2 BHK flat in Bandra West, rent 55k",                          "INR"],
  ["3 BHK villa for sale, 2.5 Cr",                                 "INR"],
  ["1rk 12k Ac ke saath",                                          "INR"],
  ["Flat in Koramangala 2BR 25000pm",                              "INR"],
  // Dubai — should be AED
  ["Dubai Marina, 2BR sea view, AED 95,000 yearly",                "AED"],
  ["JLT studio, 50k/yr, chiller free, parking",                    "AED"],
  ["Business Bay 1BR, 75000 AED",                                  "AED"],
  ["Apartment in JVC 3br 65k",                                     "AED"],
  ["Dubai Hills 4BR villa, 220k",                                   "AED"],
  // London — should be GBP
  ["2 bed flat in Canary Wharf, £2800/month",                      "GBP"],
  ["Studio in Brixton, 1500 per month",                            "GBP"],
  // US — should be USD
  ["1BR in Manhattan, $3500/month",                                "USD"],
  // Ambiguous — should be null
  ["Flat available, 15k, call now",                                "null"],
];

let passed = 0;
for (const [msg, expected] of tests) {
  const r = p.parse(msg, "Test");
  const got = r.currency || "null";
  const ok = got === expected;
  if (ok) passed++;
  console.log(`${ok ? "?" : "?"} [${got.padEnd(4)}] expected=${expected.padEnd(4)} loc="${r.location||''}" | "${msg.replace(/\n/g," ").slice(0,55)}"`);
}
console.log(`\n${passed}/${tests.length} passed`);

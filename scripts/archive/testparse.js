require('dotenv').config();
const { LlmParser } = require('../src/scraper/llm-parser');
const parser = new LlmParser();

const testMsg = `Alpha 2 
Independent 
Fully furnished 
2rk 
Rent 21k only`;

async function main() {
  console.log('Testing message:', testMsg);
  console.log('---');
  const result = await parser.parse(testMsg, 'TestSender');
  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });

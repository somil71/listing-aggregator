require('dotenv').config();
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const apiKey = process.env.GROQ_API_KEY;
console.log('API key present:', !!apiKey, '| starts with:', apiKey ? apiKey.slice(0,8)+'...' : 'N/A');

fetch(GROQ_URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: 'say hi' }],
    max_tokens: 5,
  }),
}).then(async r => {
  const body = await r.text();
  console.log('Status:', r.status);
  console.log('Body:', body.slice(0, 500));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });

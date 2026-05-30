// Convenience entry point for IDE launch configs (Claude Preview, VS Code
// debug configs, etc.).  Some launchers run from an unexpected CWD, so we
// resolve .env both from the script directory and walk upward as a safety
// net — production runs use NODE_ENV-aware env injection and don't rely on
// the dotenv file at all.

const path = require('path');
const fs   = require('fs');

const candidates = [
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env'),
];

for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    require('dotenv').config({ path: candidate });
    break;
  }
}

require('./src/api/server.js');

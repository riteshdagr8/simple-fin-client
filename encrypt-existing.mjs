// One-time migration: encrypt any existing plaintext secrets in the database.
// Run with: node encrypt-existing.mjs
import 'dotenv/config';
import { getDb } from './server/db.js';
import { encrypt } from './server/crypto.js';

const db = getDb();
let llmCount = 0;
let connCount = 0;

// Encrypt LLM API keys
const llmRows = db.prepare("SELECT user_id, api_key FROM user_llm_config WHERE api_key IS NOT NULL AND api_key != '' AND api_key NOT LIKE 'enc:%'").all();
for (const row of llmRows) {
  db.prepare('UPDATE user_llm_config SET api_key = ? WHERE user_id = ?').run(encrypt(row.api_key), row.user_id);
  llmCount++;
  console.log(`Encrypted LLM key for user ${row.user_id}`);
}

// Encrypt connection access URLs
const connRows = db.prepare("SELECT id, access_url FROM connections WHERE access_url IS NOT NULL AND access_url != '' AND access_url NOT LIKE 'enc:%'").all();
for (const row of connRows) {
  db.prepare('UPDATE connections SET access_url = ? WHERE id = ?').run(encrypt(row.access_url), row.id);
  connCount++;
  console.log(`Encrypted access_url for connection ${row.id}`);
}

console.log(`\nDone. Encrypted ${llmCount} LLM key(s) and ${connCount} connection access URL(s).`);

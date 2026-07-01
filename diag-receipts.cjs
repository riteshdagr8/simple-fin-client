const http = require('http');

// Test if receipt files are accessible from the server's perspective
const BASE = 'http://localhost:4200';

function request(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function main() {
  // Register a temporary user to check receipt accessibility
  const email = 'diag-' + Date.now() + '@test.com';
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'StrongPass1', name: 'Diag' })
  });
  const { token } = await regRes.json();

  // Try fetching receipt id=33 (user 2's JPG) - should fail (not our user)
  console.log('Receipt 33 (user 2):');
  let res = await fetch(`${BASE}/api/receipts/33/file`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`  HTTP ${res.status}: ${await res.text().then(t => t.substring(0, 100))}`);

  // Try receipt 29 (PDF)
  console.log('Receipt 29 (user 2):');
  res = await fetch(`${BASE}/api/receipts/29/file`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`  HTTP ${res.status}: ${await res.text().then(t => t.substring(0, 100))}`);

  // The issue is likely that when logged in as user 2, the file path resolves wrong.
  // Let me check if the files exist from the Node process
  const fs = require('fs');
  const path = require('path');
  const files = [
    'W:/omp/SimpleFinClient/data/receipts/2/1782620478911-xcyqll.pdf',
    'W:/omp/SimpleFinClient/data/receipts/2/1782658102337-aj8sml.jpg',
    'W:/omp/SimpleFinClient/data/receipts/2/1782661458381-mv4qd.jpg',
  ];
  for (const f of files) {
    console.log(`\n${f}:`);
    console.log(`  exists: ${fs.existsSync(f)}`);
    if (fs.existsSync(f)) {
      const stat = fs.statSync(f);
      console.log(`  size: ${stat.size} bytes`);
    }
  }

  // Also check via server.js RECEIPTS_DIR resolution
  const serverDir = path.dirname(require('url').fileURLToPath(require('url').pathToFileURL(__filename).href));
  const receiptsDir = path.resolve('W:/omp/SimpleFinClient/server/routes', '../../data/receipts');
  console.log(`\nResolved RECEIPTS_DIR: ${receiptsDir}`);
  console.log(`  exists: ${fs.existsSync(receiptsDir)}`);
  if (fs.existsSync(receiptsDir)) {
    const users = fs.readdirSync(receiptsDir);
    console.log(`  users: ${users.join(', ')}`);
  }
}

main().catch(console.error);

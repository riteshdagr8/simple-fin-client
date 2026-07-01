const Database = require('better-sqlite3');
const db = new Database('W:/omp/SimpleFinClient/finapp.db');

console.log('=== USERS ===');
const users = db.prepare('SELECT id, email, name FROM users ORDER BY id').all();
for (const u of users) {
  console.log(`  id=${u.id} email=${u.email} name=${u.name || '(no name)'}`);
}

console.log('\n=== RECEIPTS ===');
const receipts = db.prepare('SELECT COUNT(*) as cnt FROM receipts').get();
console.log('Total:', receipts.cnt);

const ru = db.prepare('SELECT DISTINCT user_id FROM receipts ORDER BY user_id').all();
console.log('Users with receipts:', ru.map(x => x.user_id));

const recs = db.prepare('SELECT id, user_id, filename, file_type FROM receipts').all();
for (const rec of recs) {
  console.log(`  id=${rec.id} user=${rec.user_id} file=${rec.filename} type=${rec.file_type}`);
}

console.log('\n=== FILES ON DISK ===');
const fs = require('fs');
const path = require('path');
const dir = 'W:/omp/SimpleFinClient/data/receipts';
if (fs.existsSync(dir)) {
  const users = fs.readdirSync(dir);
  for (const uid of users) {
    const userDir = path.join(dir, uid);
    if (fs.statSync(userDir).isDirectory()) {
      const files = fs.readdirSync(userDir);
      console.log(`  user ${uid}: ${files.length} files`);
    }
  }
} else {
  console.log('  data/receipts/ directory not found!');
}

db.close();

console.log('\n=== USER 2 FILES ===');
const recs2 = db.prepare('SELECT id, filename, file_type FROM receipts WHERE user_id=2').all();
for (const r of recs2) {
  const p = 'W:/omp/SimpleFinClient/data/receipts/2/' + r.filename;
  console.log(`  id=${r.id} file=${r.filename} type=${r.file_type} exists=${require('fs').existsSync(p)}`);
}

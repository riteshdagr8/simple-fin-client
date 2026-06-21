const Database = require('better-sqlite3');
const db = new Database('./finapp.db');

// Find duplicates (case-insensitive on name within same user)
const dups = db.prepare(`
  SELECT user_id, LOWER(TRIM(name)) as norm,
         GROUP_CONCAT(id) as ids,
         MIN(id) as keep_id
  FROM categories
  GROUP BY user_id, LOWER(TRIM(name))
  HAVING COUNT(*) > 1
`).all();

if (dups.length === 0) {
  console.log('No duplicates found.');
  process.exit(0);
}

let totalDeleted = 0;
const cleanup = db.transaction(() => {
  for (const dup of dups) {
    const ids = dup.ids.split(',').map(Number);
    const keepId = dup.keep_id;
    const removeIds = ids.filter(id => id !== keepId);
    if (removeIds.length === 0) continue;

    // Re-point any transactions to the kept category
    for (const removeId of removeIds) {
      const reattached = db.prepare(`
        UPDATE OR IGNORE transaction_categories
        SET category_id = ? WHERE category_id = ?
      `).run(keepId, removeId);

      // If the kept category already has a row for that transaction, the
      // OR IGNORE leaves the duplicate row in place. Delete those.
      db.prepare(`
        DELETE FROM transaction_categories
        WHERE category_id = ? AND transaction_id IN (
          SELECT transaction_id FROM transaction_categories WHERE category_id = ?
        )
      `).run(removeId, keepId);

      // Delete the duplicate category
      db.prepare('DELETE FROM categories WHERE id = ?').run(removeId);
      totalDeleted++;
    }
    console.log(`Kept #${keepId} (${dup.norm}), removed: ${removeIds.join(', ')}`);
  }
});
cleanup();

const after = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
console.log(`\nDeleted ${totalDeleted} duplicate categories.`);
console.log(`Total categories now: ${after.cnt}`);

const final = db.prepare('SELECT id, name, icon FROM categories ORDER BY id').all();
console.log('\nFinal categories:');
final.forEach(c => console.log(`  #${c.id} ${c.icon} ${c.name}`));

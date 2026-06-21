import Database from 'better-sqlite3';

const db = new Database('./finapp.db');

// Update bank names based on account name patterns
const updates = [
  // TD Bank patterns
  { pattern: 'TD ', bankName: 'TD Bank' },
  { pattern: 'BUSINESS_CHEQUING', bankName: 'TD Bank' },
  { pattern: 'COMMERCIAL TERM LOAN', bankName: 'TD Bank' },
  { pattern: 'US $ DAILY INTEREST', bankName: 'TD Bank' },
  { pattern: 'Chequing', bankName: 'TD Bank' },
  { pattern: 'Line of Credit', bankName: 'TD Bank' },
  { pattern: 'Personal Loan', bankName: 'TD Bank' },
  { pattern: 'Credit Line', bankName: 'TD Bank' },
  { pattern: 'Conventional Residential Mortgage', bankName: 'TD Bank' },
  { pattern: 'LINE OF CREDIT', bankName: 'TD Bank' },

  // Investment/Brokerage patterns
  { pattern: 'TFSA', bankName: 'Wealthsimple' },
  { pattern: 'SDRSP', bankName: 'Wealthsimple' },
  { pattern: 'SELF_DIRECTED', bankName: 'Wealthsimple' },
];

let totalUpdated = 0;

for (const update of updates) {
  const result = db.prepare(
    "UPDATE accounts SET bank_name = ? WHERE name LIKE ? AND bank_name IS NULL"
  ).run(update.bankName, `%${update.pattern}%`);
  if (result.changes > 0) {
    totalUpdated += result.changes;
    console.log(`Updated ${result.changes} accounts to "${update.bankName}"`);
  }
}

console.log(`\nTotal updated: ${totalUpdated} accounts`);

// Show remaining accounts without bank names
const remaining = db.prepare('SELECT id, name FROM accounts WHERE bank_name IS NULL').all();
if (remaining.length > 0) {
  console.log(`\nRemaining ${remaining.length} accounts without bank names:`);
  remaining.forEach(a => console.log(`  ID ${a.id}: ${a.name}`));
}

db.close();

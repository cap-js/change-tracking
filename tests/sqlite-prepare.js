const Database = require('better-sqlite3');
const db = new Database(':memory:');
// Try to PREPARE a view referencing a non-existent table
try {
  db.prepare('CREATE VIEW v1 AS SELECT id FROM foo');
  console.log('PREPARE VIEW: succeeded (table does not exist yet)');
} catch(e) {
  console.log('PREPARE VIEW failed:', e.message);
}
// Try same for trigger
try {
  db.prepare('CREATE TRIGGER t1 AFTER INSERT ON foo BEGIN SELECT 1; END');
  console.log('PREPARE TRIGGER: succeeded');
} catch(e) {
  console.log('PREPARE TRIGGER failed:', e.message);
}

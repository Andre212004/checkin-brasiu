const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH = path.join(__dirname, '../database/checkins.db');
const db      = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Criar tabela se não existir
  db.run(`CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL UNIQUE,
    total        REAL NOT NULL,
    total_invest REAL NOT NULL,
    total_bank   REAL NOT NULL,
    brokers      TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Ler cache do portfolio
  db.get(
    "SELECT data FROM eb_cache WHERE cache_key = 'portfolio_summary' AND expires_at > CURRENT_TIMESTAMP",
    (err, row) => {
      if (err || !row) {
        console.log('[Snapshot] Sem cache válida — a saltar');
        db.close(); return;
      }

      try {
        const summary = JSON.parse(row.data);
        const today   = new Date().toISOString().substring(0, 10);

        db.run(`
          INSERT INTO portfolio_snapshots (date, total, total_invest, total_bank, brokers)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            total=excluded.total, total_invest=excluded.total_invest,
            total_bank=excluded.total_bank, brokers=excluded.brokers
        `, [
          today,
          summary.total        || 0,
          summary.total_invest || 0,
          summary.total_bank   || 0,
          JSON.stringify((summary.brokers || []).map(b => ({ broker: b.broker, total: b.total })))
        ], (err2) => {
          if (err2) console.error('[Snapshot] Erro ao guardar:', err2.message);
          else      console.log(`[Snapshot] ${today} — total: ${summary.total}`);
          db.close();
        });
      } catch (e) {
        console.error('[Snapshot] Erro:', e.message);
        db.close();
      }
    }
  );
});

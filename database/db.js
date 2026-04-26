// ============================================
// DATABASE/DB.JS - Configuração SQLite
// ============================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'diary.db');
const schemaPath = path.join(__dirname, '../schema.sql');

// ============================================
// INICIALIZAR BASE DE DADOS
// ============================================

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Erro ao conectar à base de dados:', err);
    process.exit(1);
  }
  console.log('✅ Conectado à base de dados SQLite');
});

// Ativar foreign keys
db.run('PRAGMA foreign_keys = ON');

// ============================================
// CRIAR TABELAS SE NÃO EXISTIREM
// ============================================

const initDatabase = () => {
  return new Promise((resolve, reject) => {
    // Verificar se schema.sql existe
    if (!fs.existsSync(schemaPath)) {
      console.log('⚠️  schema.sql não encontrado, a criar tabelas manualmente...');
      
      // Criar tabelas manualmente se schema.sql não existir
      const createTables = `
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            avatar_color TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS weekly_checkins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            week_number INTEGER NOT NULL,
            year INTEGER NOT NULL,
            best_moment TEXT,
            strange_thing TEXT,
            learned TEXT,
            image_filename TEXT,
            is_locked BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, week_number, year)
        );

        CREATE INDEX IF NOT EXISTS idx_checkins_user_week 
            ON weekly_checkins(user_id, week_number, year);

        CREATE INDEX IF NOT EXISTS idx_checkins_week 
            ON weekly_checkins(week_number, year);

        INSERT OR IGNORE INTO users (id, name, avatar_color) VALUES 
            (1, 'João', '#3B82F6'),
            (2, 'Bruna', '#EC4899'),
            (3, 'Ema', '#10B981'),
            (4, 'André', '#F59E0B');

        CREATE TRIGGER IF NOT EXISTS update_checkin_timestamp 
        AFTER UPDATE ON weekly_checkins
        FOR EACH ROW
        BEGIN
            UPDATE weekly_checkins 
            SET updated_at = CURRENT_TIMESTAMP 
            WHERE id = NEW.id;
        END;
      `;
      
      db.exec(createTables, (err) => {
        if (err) {
          console.error('❌ Erro ao criar tabelas:', err);
          reject(err);
        } else {
          console.log('✅ Tabelas da base de dados verificadas/criadas');
          resolve();
        }
      });
      
    } else {
      // Ler schema SQL do ficheiro
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Executar schema
      db.exec(schema, (err) => {
        if (err) {
          console.error('❌ Erro ao criar tabelas:', err);
          reject(err);
        } else {
          console.log('✅ Tabelas da base de dados verificadas/criadas');
          resolve();
        }
      });
    }
  });
};

// Inicializar na importação
initDatabase().catch(console.error);

// ============================================
// FUNÇÕES HELPER
// ============================================

// Wrapper para promisify queries
const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const getQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const allQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// ============================================
// BACKUP AUTOMÁTICO
// ============================================

const backupDatabase = () => {
  const backupDir = path.join(__dirname, 'backups');
  
  // Criar pasta de backups
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `checkins_backup_${timestamp}.db`);
  
  // Copiar ficheiro
  fs.copyFile(dbPath, backupPath, (err) => {
    if (err) {
      console.error('❌ Erro ao criar backup:', err);
    } else {
      console.log(`✅ Backup criado: ${backupPath}`);
      
      // Manter apenas últimos 7 backups
      cleanOldBackups(backupDir);
    }
  });
};

const cleanOldBackups = (backupDir) => {
  fs.readdir(backupDir, (err, files) => {
    if (err) return;
    
    const backups = files
      .filter(f => f.startsWith('checkins_backup_'))
      .sort()
      .reverse();
    
    // Apagar backups antigos (manter só 7)
    if (backups.length > 7) {
      backups.slice(7).forEach(file => {
        fs.unlink(path.join(backupDir, file), (err) => {
          if (!err) console.log(`🗑️  Backup antigo removido: ${file}`);
        });
      });
    }
  });
};

// Backup diário às 3h da manhã
const scheduleBackups = () => {
  const now = new Date();
  const night = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 0, 0);
  const msToMidnight = night.getTime() - now.getTime();
  
  setTimeout(() => {
    backupDatabase();
    setInterval(backupDatabase, 24 * 60 * 60 * 1000); // A cada 24h
  }, msToMidnight);
  
  console.log('⏰ Backup automático agendado para as 3h');
};

scheduleBackups();

// ============================================
// EXPORTS
// ============================================

module.exports = {
  db,
  runQuery,
  getQuery,
  allQuery,
  backupDatabase
};

-- ============================================
-- SCHEMA DA BASE DE DADOS - CHECKIN APP
-- ============================================

-- Tabela de utilizadores (4 fixos)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    avatar_color TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de check-ins semanais
CREATE TABLE IF NOT EXISTS weekly_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    
    -- As 3 perguntas
    best_moment TEXT,
    strange_thing TEXT,
    learned TEXT,
    
    -- Imagem pessoal da semana (cada utilizador pode ter a sua)
    image_filename TEXT,
    
    -- Controlo
    is_locked BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, week_number, year)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_checkins_user_week 
    ON weekly_checkins(user_id, week_number, year);

CREATE INDEX IF NOT EXISTS idx_checkins_week 
    ON weekly_checkins(week_number, year);

-- ============================================
-- DADOS INICIAIS
-- ============================================

-- Inserir os 4 utilizadores fixos
INSERT OR IGNORE INTO users (id, name, avatar_color) VALUES 
    (1, 'João', '#3B82F6'),
    (2, 'Bruna', '#EC4899'),
    (3, 'Ema', '#10B981'),
    (4, 'André', '#F59E0B');

-- ============================================
-- TRIGGERS PARA AUTO-UPDATE
-- ============================================

-- Atualizar updated_at automaticamente
CREATE TRIGGER IF NOT EXISTS update_checkin_timestamp 
AFTER UPDATE ON weekly_checkins
FOR EACH ROW
BEGIN
    UPDATE weekly_checkins 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE id = NEW.id;
END;

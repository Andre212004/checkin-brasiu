// ============================================
// ROUTES/USERS.JS - Endpoints de Utilizadores
// ============================================

const express = require('express');
const router = express.Router();
const { allQuery, getQuery } = require('../database/db');

// ============================================
// GET /api/users - Listar todos os utilizadores
// ============================================

router.get('/', async (req, res, next) => {
  try {
    const users = await allQuery('SELECT * FROM users ORDER BY id');
    
    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/users/:id - Obter utilizador específico
// ============================================

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Validar ID
    if (id < 1 || id > 4) {
      return res.status(400).json({
        success: false,
        error: 'ID de utilizador inválido (deve ser 1-4)'
      });
    }
    
    const user = await getQuery('SELECT * FROM users WHERE id = ?', [id]);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilizador não encontrado'
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/users/:id/stats - Estatísticas do utilizador
// ============================================

router.get('/:id/stats', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Total de check-ins
    const totalResult = await getQuery(
      'SELECT COUNT(*) as total FROM weekly_checkins WHERE user_id = ?',
      [id]
    );
    
    // Check-ins com imagem
    const withImageResult = await getQuery(
      'SELECT COUNT(*) as count FROM weekly_checkins WHERE user_id = ? AND image_filename IS NOT NULL',
      [id]
    );
    
    // Último check-in
    const lastCheckin = await getQuery(
      'SELECT week_number, year, created_at FROM weekly_checkins WHERE user_id = ? ORDER BY year DESC, week_number DESC LIMIT 1',
      [id]
    );
    
    res.json({
      success: true,
      stats: {
        total_checkins: totalResult.total,
        checkins_with_image: withImageResult.count,
        last_checkin: lastCheckin || null
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

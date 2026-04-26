// ============================================
// ROUTES/UTILS.JS - Endpoints Utilitários
// ============================================

const express = require('express');
const router = express.Router();
const { runQuery, allQuery } = require('../database/db');
const { getCurrentWeekAndYear, getWeekStartEnd } = require('../utils/dateHelpers');

// ============================================
// GET /api/utils/current-week - Semana e ano atuais
// ============================================

router.get('/current-week', (req, res) => {
  const { week, year } = getCurrentWeekAndYear();
  const { start, end } = getWeekStartEnd(week, year);
  
  res.json({
    success: true,
    current_week: week,
    current_year: year,
    week_start: start,
    week_end: end,
    iso_format: `${year}-W${week.toString().padStart(2, '0')}`
  });
});

// ============================================
// POST /api/utils/lock-old-weeks - Bloquear semanas antigas
// ============================================

router.post('/lock-old-weeks', async (req, res, next) => {
  try {
    const { week, year } = getCurrentWeekAndYear();
    
    // Bloquear todas as semanas anteriores à atual
    const result = await runQuery(
      `UPDATE weekly_checkins 
       SET is_locked = 1 
       WHERE is_locked = 0 
       AND (year < ? OR (year = ? AND week_number < ?))`,
      [year, year, week]
    );
    
    res.json({
      success: true,
      message: `${result.changes} check-ins bloqueados`,
      locked_count: result.changes
    });
    
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/utils/stats - Estatísticas globais
// ============================================

router.get('/stats', async (req, res, next) => {
  try {
    // Total de check-ins
    const totalCheckins = await allQuery(
      'SELECT COUNT(*) as count FROM weekly_checkins'
    );
    
    // Check-ins com imagem
    const withImages = await allQuery(
      'SELECT COUNT(*) as count FROM weekly_checkins WHERE image_filename IS NOT NULL'
    );
    
    // Semanas únicas
    const uniqueWeeks = await allQuery(
      'SELECT COUNT(DISTINCT week_number || "-" || year) as count FROM weekly_checkins'
    );
    
    // Check-ins por utilizador
    const byUser = await allQuery(
      `SELECT u.name, COUNT(c.id) as checkin_count, 
              COUNT(c.image_filename) as images_count
       FROM users u
       LEFT JOIN weekly_checkins c ON u.id = c.user_id
       GROUP BY u.id, u.name
       ORDER BY u.id`
    );
    
    res.json({
      success: true,
      stats: {
        total_checkins: totalCheckins[0].count,
        checkins_with_images: withImages[0].count,
        unique_weeks: uniqueWeeks[0].count,
        by_user: byUser
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/utils/health - Health check
// ============================================

router.get('/health', async (req, res, next) => {
  try {
    // Testar conexão à BD
    const testQuery = await allQuery('SELECT 1 as test');
    
    res.json({
      success: true,
      status: 'healthy',
      database: testQuery.length > 0 ? 'connected' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;

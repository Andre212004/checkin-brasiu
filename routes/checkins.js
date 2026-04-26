const express = require('express');
const router = express.Router();
const { runQuery, getQuery, allQuery } = require('../database/db');
const { getCurrentWeekAndYear, isWeekLocked } = require('../utils/dateHelpers');

router.post('/', async (req, res, next) => {
  try {
    const { user_id, week_number, year, best_moment, strange_thing, learned } = req.body;
    if (!user_id || user_id < 1 || user_id > 4) return res.status(400).json({ success: false, error: 'user_id invalido (deve ser 1-4)' });
    if (!week_number || !year) return res.status(400).json({ success: false, error: 'week_number e year sao obrigatorios' });
    if (isWeekLocked(week_number, year)) return res.status(403).json({ success: false, error: 'Esta semana ja esta bloqueada.' });
    const existing = await getQuery('SELECT id, is_locked FROM weekly_checkins WHERE user_id = ? AND week_number = ? AND year = ?', [user_id, week_number, year]);
    if (existing) return res.status(409).json({ success: false, error: 'Ja existe um check-in para esta semana. Use PUT para editar.', checkin_id: existing.id });
    const result = await runQuery('INSERT INTO weekly_checkins (user_id, week_number, year, best_moment, strange_thing, learned) VALUES (?, ?, ?, ?, ?, ?)', [user_id, week_number, year, best_moment, strange_thing, learned]);
    const newCheckin = await getQuery('SELECT * FROM weekly_checkins WHERE id = ?', [result.id]);
    res.status(201).json({ success: true, message: 'Check-in criado com sucesso', checkin: newCheckin });
  } catch (error) { next(error); }
});

router.get('/history', async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const weeks = await allQuery('SELECT DISTINCT week_number, year, COUNT(*) as checkin_count, MIN(created_at) as first_checkin FROM weekly_checkins GROUP BY week_number, year ORDER BY year DESC, week_number DESC LIMIT ? OFFSET ?', [parseInt(limit), parseInt(offset)]);
    const timeline = await Promise.all(weeks.map(async (week) => {
      const checkins = await allQuery('SELECT c.*, u.name, u.avatar_color FROM weekly_checkins c JOIN users u ON c.user_id = u.id WHERE c.week_number = ? AND c.year = ? ORDER BY u.id', [week.week_number, week.year]);
      return { week_number: week.week_number, year: week.year, checkin_count: week.checkin_count, first_checkin: week.first_checkin, checkins };
    }));
    res.json({ success: true, count: timeline.length, timeline });
  } catch (error) { next(error); }
});

router.get('/week/:week/:year', async (req, res, next) => {
  try {
    const { week, year } = req.params;
    const checkins = await allQuery('SELECT c.*, u.name, u.avatar_color FROM weekly_checkins c JOIN users u ON c.user_id = u.id WHERE c.week_number = ? AND c.year = ? ORDER BY u.id', [week, year]);
    res.json({ success: true, week: parseInt(week), year: parseInt(year), count: checkins.length, checkins });
  } catch (error) { next(error); }
});

router.get('/:userId/:week/:year', async (req, res, next) => {
  try {
    const { userId, week, year } = req.params;
    const checkin = await getQuery('SELECT c.*, u.name, u.avatar_color FROM weekly_checkins c JOIN users u ON c.user_id = u.id WHERE c.user_id = ? AND c.week_number = ? AND c.year = ?', [userId, week, year]);
    if (!checkin) return res.status(404).json({ success: false, error: 'Check-in nao encontrado' });
    res.json({ success: true, checkin });
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { best_moment, strange_thing, learned } = req.body;
    const checkin = await getQuery('SELECT * FROM weekly_checkins WHERE id = ?', [id]);
    if (!checkin) return res.status(404).json({ success: false, error: 'Check-in nao encontrado' });
    if (checkin.is_locked || isWeekLocked(checkin.week_number, checkin.year)) return res.status(403).json({ success: false, error: 'Este check-in esta bloqueado' });
    await runQuery('UPDATE weekly_checkins SET best_moment = ?, strange_thing = ?, learned = ? WHERE id = ?', [best_moment, strange_thing, learned, id]);
    const updated = await getQuery('SELECT * FROM weekly_checkins WHERE id = ?', [id]);
    res.json({ success: true, message: 'Check-in atualizado com sucesso', checkin: updated });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const checkin = await getQuery('SELECT * FROM weekly_checkins WHERE id = ?', [id]);
    if (!checkin) return res.status(404).json({ success: false, error: 'Check-in nao encontrado' });
    if (checkin.image_filename) {
      const fs = require('fs');
      const path = require('path');
      const imagePath = path.join(__dirname, '../uploads', checkin.image_filename);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
    await runQuery('DELETE FROM weekly_checkins WHERE id = ?', [id]);
    res.json({ success: true, message: 'Check-in apagado com sucesso' });
  } catch (error) { next(error); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { runQuery, getQuery, allQuery } = require('../database/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const { checkin_id } = req.body;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `checkin${checkin_id}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de ficheiro nao permitido'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// POST /api/images/upload
router.post('/upload', upload.single('image'), async (req, res, next) => {
  try {
    const { checkin_id } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhuma imagem enviada' });
    }
    if (!checkin_id) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'checkin_id obrigatorio' });
    }
    const checkin = await getQuery('SELECT id FROM weekly_checkins WHERE id = ?', [checkin_id]);
    if (!checkin) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, error: 'Check-in nao encontrado' });
    }
    const imageCount = await getQuery('SELECT COUNT(*) as count FROM checkin_images WHERE checkin_id = ?', [checkin_id]);
    if (imageCount.count >= 5) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Maximo de 5 fotos por check-in' });
    }
    const result = await runQuery('INSERT INTO checkin_images (checkin_id, filename) VALUES (?, ?)', [checkin_id, req.file.filename]);
    res.json({ success: true, message: 'Imagem carregada com sucesso', image: { id: result.id, filename: req.file.filename, url: `/uploads/${req.file.filename}` } });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    next(error);
  }
});

// GET /api/images/checkin/:checkinId
router.get('/checkin/:checkinId', async (req, res, next) => {
  try {
    const { checkinId } = req.params;
    const images = await allQuery('SELECT id, filename, created_at FROM checkin_images WHERE checkin_id = ? ORDER BY created_at', [checkinId]);
    const imageList = images.map(img => ({ id: img.id, filename: img.filename, url: `/uploads/${img.filename}`, created_at: img.created_at }));
    res.json({ success: true, count: imageList.length, images: imageList });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/images/:imageId
router.delete('/:imageId', async (req, res, next) => {
  try {
    const { imageId } = req.params;
    const image = await getQuery('SELECT filename FROM checkin_images WHERE id = ?', [imageId]);
    if (!image) {
      return res.status(404).json({ success: false, error: 'Imagem nao encontrada' });
    }
    const imagePath = path.join(__dirname, '../uploads', image.filename);
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    await runQuery('DELETE FROM checkin_images WHERE id = ?', [imageId]);
    res.json({ success: true, message: 'Imagem apagada com sucesso' });
  } catch (error) {
    next(error);
  }
});

// COMPATIBILIDADE: GET /api/images/:userId/:week/:year (antigo)
router.get('/:userId/:week/:year', async (req, res, next) => {
  try {
    const { userId, week, year } = req.params;
    const checkin = await getQuery('SELECT id FROM weekly_checkins WHERE user_id = ? AND week_number = ? AND year = ?', [userId, week, year]);
    if (!checkin) {
      return res.status(404).json({ success: false, error: 'Check-in nao encontrado' });
    }
    const images = await allQuery('SELECT id, filename FROM checkin_images WHERE checkin_id = ? ORDER BY created_at LIMIT 1', [checkin.id]);
    if (images.length === 0) {
      return res.status(404).json({ success: false, error: 'Imagem nao encontrada' });
    }
    res.json({ success: true, image: { filename: images[0].filename, url: `/uploads/${images[0].filename}` } });
  } catch (error) {
    next(error);
  }
});

// GET /api/images/week/:week/:year
router.get('/week/:week/:year', async (req, res, next) => {
  try {
    const { week, year } = req.params;
    const checkins = await allQuery('SELECT c.id, c.user_id, u.name FROM weekly_checkins c JOIN users u ON c.user_id = u.id WHERE c.week_number = ? AND c.year = ? ORDER BY u.id', [week, year]);
    const result = await Promise.all(checkins.map(async (c) => {
      const images = await allQuery('SELECT filename FROM checkin_images WHERE checkin_id = ?', [c.id]);
      return { user_id: c.user_id, user_name: c.name, images: images.map(i => ({ filename: i.filename, url: `/uploads/${i.filename}` })) };
    }));
    res.json({ success: true, week: parseInt(week), year: parseInt(year), data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

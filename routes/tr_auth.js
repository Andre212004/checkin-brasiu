// routes/tr_auth.js — proxy para tr_proxy.py :3001
// O processo Python mantém o WebSocket vivo entre initiate e confirm.

const express = require('express');
const router  = express.Router();
const TR      = 'http://127.0.0.1:3001';

async function proxyPost(path, body) {
  const res  = await fetch(`${TR}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(35000),
  });
  const data = await res.json();
  return { status: res.status, data };
}

// POST /api/tr/initiate
router.post('/initiate', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!phone || !pin) return res.status(400).json({ error: 'phone e pin obrigatórios' });
    const { status, data } = await proxyPost('/login/initiate', { phone, pin });
    res.status(status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tr/confirm
router.post('/confirm', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'code obrigatório' });
    const { status, data } = await proxyPost('/login/confirm', { code });
    res.status(status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tr/status
router.get('/status', async (req, res) => {
  try {
    const r    = await fetch(`${TR}/login/status`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

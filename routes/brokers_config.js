const express = require('express');
const router  = express.Router();
const { runQuery, getQuery } = require('../database/db');

async function setConfig(key, value) {
  await runQuery(`INSERT INTO eb_config (key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`, [key, String(value)]);
}
async function getConfig(key) {
  const row = await getQuery('SELECT value FROM eb_config WHERE key=?', [key]);
  return row ? row.value : null;
}

router.post('/t212', async (req, res) => {
  const { api_key, api_secret } = req.body;
  if (!api_key) return res.status(400).json({ error: 'api_key obrigatória' });
  try {
    const auth = api_secret
      ? `Basic ${Buffer.from(`${api_key}:${api_secret}`).toString('base64')}`
      : api_key;
    const testRes = await fetch('https://live.trading212.com/api/v0/equity/account/cash',
      { headers: { Authorization: auth }, signal: AbortSignal.timeout(10000) });
    if (testRes.status === 401 || testRes.status === 403)
      return res.status(400).json({ error: 'Credenciais T212 inválidas' });
    await setConfig('t212_key', api_key);
    await setConfig('t212_secret', api_secret || '');
    await runQuery(`DELETE FROM eb_cache WHERE cache_key='portfolio_summary'`).catch(()=>{});
    res.json({ ok: true, message: 'Trading 212 configurado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ibkr', async (req, res) => {
  const { flex_token, query_id } = req.body;
  if (!flex_token || !query_id) return res.status(400).json({ error: 'flex_token e query_id obrigatórios' });
  try {
    await setConfig('ibkr_flex_token', flex_token);
    await setConfig('ibkr_flex_query_id', query_id);
    await runQuery(`DELETE FROM eb_cache WHERE cache_key='portfolio_summary'`).catch(()=>{});
    res.json({ ok: true, message: 'IBKR configurado!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/status', async (req, res) => {
  const t212Key   = await getConfig('t212_key');
  const ibkrToken = await getConfig('ibkr_flex_token');
  const ibkrQuery = await getConfig('ibkr_flex_query_id');
  res.json({
    t212: { configured: !!t212Key, key_hint: t212Key ? t212Key.substring(0,8)+'...' : null },
    ibkr: { configured: !!(ibkrToken && ibkrQuery), query_id: ibkrQuery || null },
  });
});

module.exports = router;

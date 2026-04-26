// ─────────────────────────────────────────────────────────────
//  routes/banking.js  —  Enable Banking (enablebanking.com)
// ─────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const { db, runQuery, getQuery, allQuery } = require('../database/db');

const EB_BASE = 'https://api.enablebanking.com';

// ── Tabelas SQLite ────────────────────────────────────────────
async function ensureTables() {
  await runQuery(`CREATE TABLE IF NOT EXISTS eb_config (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS eb_sessions (
    id TEXT PRIMARY KEY, bank_name TEXT NOT NULL,
    bank_country TEXT DEFAULT 'PT', authorization_id TEXT,
    session_id TEXT, status TEXT DEFAULT 'pending',
    accounts TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await runQuery(`CREATE TABLE IF NOT EXISTS eb_cache (
    cache_key TEXT PRIMARY KEY, data TEXT NOT NULL,
    expires_at DATETIME NOT NULL
  )`);
}

async function getConfig(key) {
  try {
    const row = await getQuery('SELECT value FROM eb_config WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch { return null; }
}

async function setConfig(key, value) {
  await runQuery(`
    INSERT INTO eb_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `, [key, String(value)]);
}

async function getCached(key) {
  try {
    const row = await getQuery(
      `SELECT data FROM eb_cache WHERE cache_key = ? AND expires_at > CURRENT_TIMESTAMP`,
      [key]
    );
    return row ? JSON.parse(row.data) : null;
  } catch { return null; }
}

async function setCache(key, data, ttlSeconds = 300) {
  try {
    await runQuery(`
      INSERT INTO eb_cache (cache_key, data, expires_at)
      VALUES (?, ?, datetime('now', '+${ttlSeconds} seconds'))
      ON CONFLICT(cache_key) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at
    `, [key, JSON.stringify(data)]);
  } catch {}
}

// ── JWT RS256 ─────────────────────────────────────────────────
async function generateJWT() {
  const appId   = await getConfig('eb_app_id');
  const keyPath = await getConfig('eb_private_key_path');

  if (!appId || !keyPath) throw new Error('Enable Banking não configurado.');
  if (!fs.existsSync(keyPath)) throw new Error(`Chave privada não encontrada: ${keyPath}`);

  const privateKey = fs.readFileSync(keyPath, 'utf8');
  const now        = Math.floor(Date.now() / 1000);
  const b64url     = obj => Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  const header  = b64url({ alg: 'RS256', typ: 'JWT', kid: appId });
  const payload = b64url({ iss: appId, aud: 'api.enablebanking.com', iat: now, exp: now + 3600 });
  const sig     = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`)
    .sign(privateKey, 'base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');

  return `${header}.${payload}.${sig}`;
}

async function ebFetch(urlPath, options = {}) {
  const jwt = await generateJWT();
  const res = await fetch(`${EB_BASE}${urlPath}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enable Banking ${urlPath} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ── Last Known Good cache (persistente na DB) ────────────────
async function getLastKnown(accountId) {
  try {
    const row = await getQuery(
      'SELECT data FROM eb_cache WHERE cache_key = ?', [`lkg_${accountId}`]
    );
    return row ? JSON.parse(row.data) : null;
  } catch { return null; }
}

async function setLastKnown(accountId, data) {
  try {
    await runQuery(`
      INSERT INTO eb_cache (cache_key, data, expires_at)
      VALUES (?, ?, datetime('now', '+365 days'))
      ON CONFLICT(cache_key) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at
    `, [`lkg_${accountId}`, JSON.stringify(data)]);
  } catch {}
}

// ── Extrai o account uid de um objeto de conta ────────────────
function extractAccountUid(accountObj) {
  if (typeof accountObj === 'string') return accountObj;
  return accountObj?.uid || accountObj?.account_id?.iban || accountObj?.account_id?.other?.identification || null;
}

function extractIBAN(accountObj) {
  if (typeof accountObj === 'string') return null;
  return accountObj?.account_id?.iban || null;
}

function extractAccountName(accountObj) {
  if (typeof accountObj === 'string') return null;
  return accountObj?.name || null;
}

// ─────────────────────────────────────────────────────────────
//  ROTAS
// ─────────────────────────────────────────────────────────────

// POST /api/banking/setup
router.post('/setup', async (req, res) => {
  try {
    await ensureTables();
    const { app_id, private_key_path } = req.body;
    if (!app_id || !private_key_path)
      return res.status(400).json({ error: 'app_id e private_key_path são obrigatórios' });
    if (!fs.existsSync(private_key_path))
      return res.status(400).json({ error: `Ficheiro não encontrado: ${private_key_path}` });
    await setConfig('eb_app_id', app_id);
    await setConfig('eb_private_key_path', private_key_path);
    res.json({ ok: true, message: 'Enable Banking configurado com sucesso.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/generate-keys
router.get('/generate-keys', async (req, res) => {
  try {
    await ensureTables();
    const keysDir = path.join(process.cwd(), 'keys');
    if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const privPath = path.join(keysDir, 'private.pem');
    const pubPath  = path.join(keysDir, 'public.pem');
    fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(pubPath,  publicKey);

    res.json({
      ok: true,
      private_key_path: privPath,
      public_key_path:  pubPath,
      public_key: publicKey
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/banks
router.get('/banks', async (req, res) => {
  try {
    await ensureTables();
    const country = req.query.country || 'PT';
    const cached  = await getCached(`banks_${country}`);
    if (cached) return res.json(cached);
    const data  = await ebFetch(`/aspsps?country=${country}`);
    const banks = (data.aspsps || []).map(b => ({ id: b.name, name: b.name, country: b.country }));
    await setCache(`banks_${country}`, banks, 3600);
    res.json(banks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/banking/connect
router.post('/connect', async (req, res) => {
  try {
    await ensureTables();
    const { bank_name, bank_country = 'PT', redirect_url } = req.body;
    if (!bank_name) return res.status(400).json({ error: 'bank_name é obrigatório' });

    const redirectUrl = redirect_url || `${process.env.NGROK_URL || req.protocol + '://' + req.get('host')}/api/banking/callback`;
    const validUntil  = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const data = await ebFetch('/auth', {
      method: 'POST',
      body: JSON.stringify({
        access: { balances: true, transactions: true, valid_until: validUntil },
        aspsp:  { name: bank_name, country: bank_country },
        state:  `portfolio_${bank_name}_${Date.now()}`,
        redirect_url: redirectUrl,
        psu_type: 'personal'
      })
    });

    const sessionId = data.authorization_id || `eb_${Date.now()}`;
    await runQuery(`
      INSERT INTO eb_sessions (id, bank_name, bank_country, authorization_id, status)
      VALUES (?, ?, ?, ?, 'pending')
      ON CONFLICT(id) DO UPDATE SET authorization_id=excluded.authorization_id, status='pending'
    `, [sessionId, bank_name, bank_country, data.authorization_id]);

    res.json({
      session_id:       sessionId,
      authorization_id: data.authorization_id,
      auth_url:         data.url,
      bank_name,
      message: `Abre o auth_url no browser para autorizares o ${bank_name}`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/callback
router.get('/callback', async (req, res) => {
  console.log('=== CALLBACK RECEBIDO ===');
  console.log('Query params:', JSON.stringify(req.query));
  try {
    const { code, error } = req.query;
    if (error) return res.redirect('/?banking_error=' + error);

    if (code) {
      console.log('CODE recebido:', code);
      const data = await ebFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      console.log('Resposta /sessions:', JSON.stringify(data));

      if (data.session_id) {
        // Guarda os objetos completos das contas
        const accounts = JSON.stringify(data.accounts || []);
        await runQuery(
          `UPDATE eb_sessions SET status='active', accounts=?, session_id=?
           WHERE id=(SELECT id FROM eb_sessions WHERE status='pending' ORDER BY created_at DESC LIMIT 1)`,
          [accounts, data.session_id]
        );
        console.log('[CALLBACK] Sessão atualizada:', data.session_id, 'active');
      }
    }
  } catch (e) {
    console.error('Erro no callback:', e.message);
  }
  // Redirecionar para URL que a app iOS deteta via ASWebAuthenticationSession
  // O scheme 'invst' é registado na app como URL scheme custom
  const successURL = process.env.BANKING_CALLBACK_APP_URL || '/?banking_connected=true';
  res.redirect(successURL);
});

// GET /api/banking/status
router.get('/status', async (req, res) => {
  try {
    await ensureTables();
    const sessions = await allQuery('SELECT * FROM eb_sessions ORDER BY created_at DESC', []);
    res.json(sessions.map(s => ({ ...s, accounts: s.accounts ? JSON.parse(s.accounts) : [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/accounts
router.get('/accounts', async (req, res) => {
  try {
    await ensureTables();
    const cached = await getCached('eb_all_accounts');
    if (cached && !req.query.refresh) return res.json(cached);
    // Guardar cache actual para fallback
    const staleCache = cached;

    const sessions = await allQuery(
      "SELECT * FROM eb_sessions WHERE status = 'active' AND session_id IS NOT NULL", []
    );
    const accounts = [];

    for (const session of sessions) {
      const rawAccounts = JSON.parse(session.accounts || '[]');

      for (const accObj of rawAccounts) {
        const uid  = extractAccountUid(accObj);
        const iban = extractIBAN(accObj);
        const name = extractAccountName(accObj);

        if (!uid) continue;

        // Delay entre contas para não bater rate limit dos bancos (1s)
        if (accounts.length > 0) {
          await new Promise(r => setTimeout(r, 1000));
        }

        try {
          const balancesData = await ebFetch(`/accounts/${uid}/balances`);
          const balance = (balancesData.balances || []).find(x =>
            ['ITAV', 'ITBD', 'CLBD'].includes(x.balance_type?.code)
          ) || (balancesData.balances || [])[0];

          const accountData = {
            id:        uid,
            bank_name: session.bank_name,
            iban:      iban,
            name:      name || session.bank_name,
            currency:  accObj?.currency || 'EUR',
            balance:   parseFloat(balance?.balance_amount?.amount || 0),
            status:    'live'
          };
          await setLastKnown(uid, accountData);
          accounts.push(accountData);
        } catch (e) {
          const msg = e.message || '';
          // Tentar usar last known good
          const lkg = await getLastKnown(uid);
          if (lkg) {
            console.log(`[Banking] ${session.bank_name} com erro — a usar último valor conhecido`);
            accounts.push({ ...lkg, status: 'stale', stale: true, error: msg });
          } else if (msg.includes('NOT_ACCESSIBLE') || msg.includes('not found')) {
            console.log(`[Banking] Conta ${uid} não acessível — sem dados anteriores`);
          } else {
            console.log(`[Banking] Conta ${uid} de ${session.bank_name} com erro: ${e.message}`);
          }
        }
      }
    }

    if (accounts.length === 0 && staleCache && staleCache.length > 0) {
      console.log('[Banking] Sem contas novas, a servir cache stale');
      return res.json(staleCache);
    }
    await setCache('eb_all_accounts', accounts, 82800);  // 23 horas — respeitar rate limit dos bancos
    res.json(accounts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/transactions
router.get('/transactions', async (req, res) => {
  try {
    await ensureTables();
    const { date_from, date_to, account_id } = req.query;
    const cacheKey = `eb_txns_${account_id || 'all'}_${date_from || ''}_${date_to || ''}`;
    const cached   = await getCached(cacheKey);
    if (cached) return res.json(cached);

    const sessions = await allQuery(
      "SELECT * FROM eb_sessions WHERE status = 'active' AND session_id IS NOT NULL", []
    );

    const allTransactions = [];

    for (const session of sessions) {
      const rawAccounts = JSON.parse(session.accounts || '[]');

      for (const accObj of rawAccounts) {
        const uid = extractAccountUid(accObj);
        if (!uid) continue;
        if (account_id && uid !== account_id) continue;

        try {
          let url = `/accounts/${uid}/transactions`;
          const params = [];
          if (date_from) params.push(`date_from=${date_from}`);
          if (date_to)   params.push(`date_to=${date_to}`);
          if (params.length) url += '?' + params.join('&');

          const data = await ebFetch(url);

          (data.transactions || []).forEach(t => {
            allTransactions.push({
              id:           t.entry_reference || `${uid}_${Math.random()}`,
              account_id:   uid,
              bank_name:    session.bank_name,
              booking_date: t.booking_date,
              value_date:   t.value_date,
              amount:       t.transaction_amount?.amount,
              currency:     t.transaction_amount?.currency || 'EUR',
              creditor_name: t.creditor?.name,
              debtor_name:   t.debtor?.name,
              description:  (t.remittance_information || []).join(' '),
              status:       t.status === 'BOOK' ? 'booked' : 'pending'
            });
          });
        } catch {}
      }
    }

    allTransactions.sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));
    await setCache(cacheKey, allTransactions, 21600);  // 6 horas
    res.json(allTransactions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/summary
router.get('/summary', async (req, res) => {
  try {
    await ensureTables();
    const port = process.env.PORT || 3000;
    const [accountsResult, txnsResult] = await Promise.allSettled([
      fetch(`http://localhost:${port}/api/banking/accounts`, { headers: { "X-API-Key": process.env.API_KEY } }).then(r => r.json()),
      fetch(`http://localhost:${port}/api/banking/transactions`, { headers: { "X-API-Key": process.env.API_KEY } }).then(r => r.json()),
    ]);
    const accounts     = accountsResult.status === 'fulfilled' ? accountsResult.value : [];
    const transactions = txnsResult.status    === 'fulfilled' ? txnsResult.value     : [];
    res.json({
      total_balance:       accounts.reduce((s, a) => s + (a.balance || 0), 0),
      accounts,
      recent_transactions: transactions.slice(0, 50),
      last_updated:        new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/health
router.get('/health', async (req, res) => {
  try {
    await ensureTables();
    const appId    = await getConfig('eb_app_id');
    const keyPath  = await getConfig('eb_private_key_path');
    const sessions = await allQuery('SELECT bank_name, status FROM eb_sessions', []);
    res.json({
      configured:       !!(appId && keyPath),
      app_id:           appId ? `${appId.slice(0, 8)}...` : null,
      key_file_exists:  keyPath ? fs.existsSync(keyPath) : false,
      bank_connections: sessions
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/banking/raw?path=/qualquer-coisa  —  debug
router.get('/raw', async (req, res) => {
  try {
    const data = await ebFetch(req.query.path || '/');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Init
ensureTables().catch(console.error);

module.exports = router;

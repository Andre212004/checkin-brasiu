// ─────────────────────────────────────────────────────────────
//  routes/portfolio.js  —  Agrega corretoras + banca
// ─────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { runQuery, getQuery, allQuery } = require('../database/db');

const PORT      = process.env.PORT || 3000;
const TR_PROXY  = 'http://127.0.0.1:3001';
const IBKR_PROXY = 'http://127.0.0.1:3002';

// ── Cache ─────────────────────────────────────────────────────
async function getCached(key) {
  try {
    const row = await getQuery(
      `SELECT data FROM eb_cache WHERE cache_key = ? AND expires_at > CURRENT_TIMESTAMP`, [key]
    );
    return row ? JSON.parse(row.data) : null;
  } catch { return null; }
}

async function setCache(key, data, ttlSeconds = 180) {
  try {
    await runQuery(`
      INSERT INTO eb_cache (cache_key, data, expires_at)
      VALUES (?, ?, datetime('now', '+${ttlSeconds} seconds'))
      ON CONFLICT(cache_key) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at
    `, [key, JSON.stringify(data)]);
  } catch {}
}

async function getConfig(key) {
  try {
    const row = await getQuery('SELECT value FROM eb_config WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch { return null; }
}

// ── Proxy fetch helper ────────────────────────────────────────
async function fetchProxy(url, brokerName, brokerKey, brokerColor) {
  try {
    const res  = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const data = await res.json();
    return data;
  } catch (e) {
    return {
      status:    'error',
      broker:    brokerKey,
      name:      brokerName,
      color:     brokerColor,
      total:     0,
      positions: [],
      error:     e.message
    };
  }
}

// ── Trading 212 ───────────────────────────────────────────────
async function fetchTrading212(apiKey, apiSecret) {
  if (!apiKey) return { status: 'disconnected', broker: 't212', name: 'Trading 212', color: '#3ec878', total: 0, positions: [] };
  try {
    const auth    = apiSecret
      ? `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
      : apiKey;
    const headers = { Authorization: auth };

    const [portfolioRes, cashRes] = await Promise.allSettled([
      fetch('https://live.trading212.com/api/v0/equity/portfolio', { headers }).then(r => r.json()),
      fetch('https://live.trading212.com/api/v0/equity/account/cash', { headers }).then(r => r.json()),
    ]);

    const rawPositions = portfolioRes.status === 'fulfilled' && Array.isArray(portfolioRes.value) ? portfolioRes.value : [];
    const cash         = cashRes.status === 'fulfilled' && cashRes.value?.free != null ? cashRes.value : {};

    if (rawPositions.length === 0 && !cash.free) {
      return { status: 'auth_error', broker: 't212', name: 'Trading 212', color: '#3ec878', total: 0, positions: [], error: 'API key inválida ou sem permissões' };
    }

    const positions = rawPositions.map(p => ({
      ticker:        p.ticker,
      name:          p.ticker,
      broker:        't212',
      quantity:      p.quantity,
      value:         p.currentPrice * p.quantity,
      avg_price:     p.averagePrice,
      current_price: p.currentPrice,
      pnl:           p.ppl,
      pnl_pct:       ((p.currentPrice - p.averagePrice) / p.averagePrice) * 100
    }));

    const total = positions.reduce((s, p) => s + p.value, 0) + (cash.free || 0);

    return {
      status:    'live',
      broker:    't212',
      name:      'Trading 212',
      color:     '#3ec878',
      total,
      cash:      cash.free || 0,
      positions,
      last_updated: new Date().toISOString()
    };
  } catch (e) {
    return { status: 'error', broker: 't212', name: 'Trading 212', color: '#3ec878', total: 0, positions: [], error: e.message };
  }
}

// ── Trading 212 Transactions ─────────────────────────────────
async function fetchT212Transactions(apiKey, apiSecret) {
  if (!apiKey) return [];
  try {
    const auth = apiSecret
      ? `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`
      : apiKey;
    const res  = await fetch('https://live.trading212.com/api/v0/history/transactions?limit=50', {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(tx => ({
      id:            tx.reference || `t212_${Math.random()}`,
      account_id:    't212_cash',
      bank_name:     'Trading 212',
      booking_date:  tx.dateTime ? tx.dateTime.substring(0, 10) : null,
      amount:        String(tx.amount || 0),
      currency:      tx.currency || 'EUR',
      description:   tx.type || 'T212',
      creditor_name: parseFloat(tx.amount || 0) < 0 ? (tx.type || 'Trading 212') : null,
      debtor_name:   parseFloat(tx.amount || 0) > 0 ? (tx.type || 'Trading 212') : null,
      status:        'booked',
      event_type:    tx.type,
    }));
  } catch (e) {
    console.error('[T212 Transactions]', e.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  ROTAS
// ─────────────────────────────────────────────────────────────


// GET /api/portfolio/summary
router.get('/summary', async (req, res) => {
  try {
    const cached = await getCached('portfolio_summary');
    if (cached && !req.query.refresh) return res.json(cached);

    // Credenciais enviadas pela app em cada pedido — nunca guardadas no servidor
    const t212Key    = req.headers['x-t212-key']     || '';
    const t212Secret = req.headers['x-t212-secret']  || '';
    const ibkrToken  = req.headers['x-ibkr-token']   || '';
    const ibkrQuery  = req.headers['x-ibkr-query-id'] || '';

    const [t212, tr, ibkr, bankSummary, trTxResult, t212TxResult] = await Promise.allSettled([
      fetchTrading212(t212Key, t212Secret),
      fetchProxy(`${TR_PROXY}/portfolio`,   'Trade Republic',      'tr',   '#c7f24a'),
      fetchProxy(`${IBKR_PROXY}/portfolio?token=${ibkrToken}&query_id=${ibkrQuery}`, 'Interactive Brokers', 'ibkr', '#f0a500'),
      fetch(`http://127.0.0.1:${PORT}/api/banking/summary`, { headers: { "X-API-Key": process.env.API_KEY } }).then(r => r.json()).catch(() => null),
      fetch(`${TR_PROXY}/transactions`, { signal: AbortSignal.timeout(30000) }).then(r => r.json()).catch(() => ({ items: [] })),
      fetchT212Transactions(t212Key, t212Secret),
    ]);

    const brokers = [
      t212.status === 'fulfilled' ? t212.value : { status: 'error', broker: 't212',  name: 'Trading 212',        color: '#3ec878', total: 0, positions: [] },
      tr.status   === 'fulfilled' ? tr.value   : { status: 'error', broker: 'tr',    name: 'Trade Republic',      color: '#c7f24a', total: 0, positions: [] },
      ibkr.status === 'fulfilled' ? ibkr.value : { status: 'error', broker: 'ibkr',  name: 'Interactive Brokers', color: '#f0a500', total: 0, positions: [] },
    ];

    // Transações TR normalizadas para formato banking
    const trTxItems = trTxResult.status === 'fulfilled' ? (trTxResult.value?.items || []) : [];
    const trTransactions = trTxItems.map(tx => ({
      id:            tx.id,
      account_id:    'tr_card',
      bank_name:     'Trade Republic',
      booking_date:  tx.timestamp ? tx.timestamp.substring(0, 10) : null,
      amount:        tx.amount,
      currency:      tx.currency || 'EUR',
      description:   tx.title,
      creditor_name: parseFloat(tx.amount) < 0 ? tx.title : null,
      debtor_name:   parseFloat(tx.amount) > 0 ? tx.title : null,
      status:        tx.status || 'EXECUTED',
    }));

    // Conta TR Card & Cash (separada do investido)
    const trData    = tr.status === 'fulfilled' ? tr.value : null;
    const trAccount = trData ? {
      id:        'tr_card',
      bank_name: 'Trade Republic',
      iban:      null,
      name:      'TR Card & Cash',
      currency:  'EUR',
      balance:   trData.cash || 0,
      status:    trData.status || 'live',
    } : null;

    // Conta T212 cash (dinheiro parado, separado do investido)
    const t212Data    = t212.status === 'fulfilled' ? t212.value : null;
    const t212Account = (t212Data && (t212Data.cash || 0) > 0) ? {
      id:        't212_cash',
      bank_name: 'Trading 212',
      iban:      null,
      name:      'Cash Trading 212',
      currency:  'EUR',
      balance:   t212Data.cash || 0,
      status:    t212Data.status || 'live',
    } : null;

    const banking      = bankSummary.status === 'fulfilled' ? bankSummary.value : null;
    const totalInvest  = brokers.reduce((s, b) => s + ((b.depot_value ?? b.total) || 0), 0);
    const trCash       = trAccount?.balance || 0;
    const t212Cash     = t212Account?.balance || 0;
    const totalBank    = (banking?.total_balance || 0) + trCash + t212Cash;
    const allPositions = brokers.flatMap(b => b.positions || []);

    const allAccounts = [
      ...(banking?.accounts || []),
      ...(trAccount   ? [trAccount]   : []),
      ...(t212Account ? [t212Account] : []),
    ];
    const t212Transactions = t212TxResult.status === 'fulfilled' ? (t212TxResult.value || []) : [];
    const allTransactions = [
      ...(banking?.recentTransactions || []),
      ...trTransactions,
      ...t212Transactions,
    ].sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || ''));

    const summary = {
      total:         totalInvest + totalBank,
      total_invest:  totalInvest,
      total_bank:    totalBank,
      brokers,
      banking: {
        total_balance:       totalBank,
        accounts:            allAccounts,
        recent_transactions: allTransactions,
        last_updated:        new Date().toISOString(),
      },
      all_positions: allPositions,
      last_updated:  new Date().toISOString()
    };

    // Só guardar em cache se pelo menos um broker estiver live
    // Evita guardar resultados sem credenciais (T212 disconnected)
    const hasLiveBroker = brokers.some(b => b.status === 'live');
    if (hasLiveBroker) {
      await setCache('portfolio_summary', summary, 300);  // 5 min
    } else {
      console.log('[Portfolio] Sem brokers live — a não guardar em cache');
    }
    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/portfolio/health
router.get('/health', async (req, res) => {
  try {
    // T212 configurado se a app enviar o header (credenciais não guardadas no servidor)

    const checkProxy = async (url) => {
      try {
        const d = await fetch(url, { signal: AbortSignal.timeout(10000) }).then(r => r.json());
        return d.status === 'online' ? 'online' : 'error';
      } catch { return 'offline'; }
    };

    const [trStatus, ibkrStatus] = await Promise.all([
      checkProxy(`${TR_PROXY}/health`),
      checkProxy(`${IBKR_PROXY}/health`),
    ]);

    let bankReqs = [];
    try { bankReqs = await allQuery('SELECT bank_name, status FROM eb_sessions WHERE status="active"', []); } catch {}

    res.json({
      trading212:          { configured: true, note: 'credenciais enviadas pela app' },
      trade_republic:      { status: trStatus },
      interactive_brokers: { status: ibkrStatus },
      bank_connections:    bankReqs,
      server_time:         new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/portfolio/history?period=1M
router.get('/history', async (req, res) => {
  try {
    const period = req.query.period || '1M';
    const days = { '1D': 1, '1S': 7, '1M': 30, '6M': 180, '1A': 365, 'YTD': null, 'MAX': 3650 };
    
    let whereClause = '';
    if (period === 'YTD') {
      whereClause = `WHERE date >= '${new Date().getFullYear()}-01-01'`;
    } else if (days[period]) {
      whereClause = `WHERE date >= date('now', '-${days[period]} days')`;
    }

    const snapshots = await allQuery(
      `SELECT date, total, total_invest, total_bank FROM portfolio_snapshots ${whereClause} ORDER BY date ASC`,
      []
    );

    res.json({ period, snapshots });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;


// ============================================
// SERVER.JS - Servidor Express Principal
// ============================================
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');
require('dotenv').config();

// Importar rotas existentes
const usersRouter    = require('./routes/users');
const checkinsRouter = require('./routes/checkins');
const imagesRouter   = require('./routes/images');
const utilsRouter    = require('./routes/utils');

// Importar rotas de portfolio
const bankingRouter   = require('./routes/banking');
const portfolioRouter = require('./routes/portfolio');

const app  = express();
const PORT = process.env.PORT || 3000;

const trAuthRouter      = require('./routes/tr_auth');
const brokersRouter     = require('./routes/brokers_config');

// ============================================
// API KEY
// ============================================
const API_KEY       = process.env.API_KEY;
const DIARY_API_KEY = process.env.DIARY_API_KEY;

// Rotas acessíveis com a DIARY_API_KEY (só diário)
const DIARY_ONLY_PATHS = ['/api/checkins', '/api/users', '/api/images', '/api/utils'];
if (!API_KEY) {
  console.error('❌ API_KEY não definida no .env — a sair');
  process.exit(1);
}

// ============================================
// LOG DE REJEIÇÕES
// ============================================
const REJECT_LOG = path.join(__dirname, 'logs', 'rejected.log');

function logRejected(req, reason) {
  const ip        = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const timestamp = new Date().toISOString();
  const line      = `${timestamp} | ${ip} | ${req.method} ${req.originalUrl} | ${reason}\n`;
  fs.appendFile(REJECT_LOG, line, () => {});
  console.warn(`⛔ REJEITADO: ${line.trim()}`);
}

// ============================================
// MIDDLEWARES GLOBAIS
// ============================================

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'X-API-Key']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ── Rate limiting geral ───────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: { error: 'Demasiados pedidos, tenta novamente em 15 minutos' },
  handler: (req, res, next, options) => {
    logRejected(req, 'RATE_LIMIT_GERAL');
    res.status(429).json(options.message);
  }
});
app.use('/api/', generalLimiter);

// ── Rate limiting apertado para portfolio (dados sensíveis) ───
const portfolioLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20,
  message: { error: 'Demasiados pedidos ao portfolio, tenta novamente em 1 minuto' },
  handler: (req, res, next, options) => {
    logRejected(req, 'RATE_LIMIT_PORTFOLIO');
    res.status(429).json(options.message);
  }
});

// ── Validação de API Key ──────────────────────────────────────
function requireApiKey(req, res, next) {
  const publicPaths = ['/', '/health', '/banking/callback'];
  if (publicPaths.includes(req.path)) return next();

  const key = req.headers['x-api-key'];
  if (!key) {
    logRejected(req, 'API_KEY_AUSENTE');
    return res.status(401).json({ error: 'API key obrigatória' });
  }
  // DIARY_API_KEY — acesso apenas às rotas do diário
  if (DIARY_API_KEY && key === DIARY_API_KEY) {
    const fullPath = '/api' + req.path;
    const isDiaryPath = DIARY_ONLY_PATHS.some(p => fullPath.startsWith(p));
    if (!isDiaryPath) {
      logRejected(req, 'DIARY_KEY_SEM_ACESSO');
      return res.status(403).json({ error: 'Esta API key só permite acesso ao diário' });
    }
    return next();
  }
  // API_KEY principal — acesso total
  if (key !== API_KEY) {
    logRejected(req, 'API_KEY_INVALIDA');
    return res.status(401).json({ error: 'API key inválida' });
  }
  next();
}

// Aplica validação a todas as rotas /api/
app.use('/api/', requireApiKey);

// ── Logging de pedidos normais ────────────────────────────────
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Servir imagens e PWA
app.use('/uploads',   express.static(path.join(__dirname, 'uploads')));
app.use('/portfolio', express.static(path.join(__dirname, 'public')));

// ============================================
// ROTAS
// ============================================

app.get('/', (req, res) => {
  res.json({ status: 'online', message: 'Checkin API Server', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// Rotas existentes (protegidas pela API key acima)
app.use('/api/users',    usersRouter);
app.use('/api/checkins', checkinsRouter);
app.use('/api/images',   imagesRouter);
app.use('/api/utils',    utilsRouter);

// Rotas de portfolio (rate limiting extra)
app.use('/api/banking',   portfolioLimiter, bankingRouter);
app.use('/api/portfolio', portfolioLimiter, portfolioRouter);
app.use('/api/tr',      portfolioLimiter, trAuthRouter);
app.use('/api/brokers', portfolioLimiter, brokersRouter);

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

// Cria pastas necessárias
[
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'public'),
  path.join(__dirname, 'logs'),
].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✅ Pasta criada: ${dir}`);
  }
});

app.listen(PORT, () => {
  console.log('\n🚀 Servidor Checkin API iniciado!');
  console.log(`📡 Porta: ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 API Key: ${API_KEY.slice(0, 8)}...`);
  console.log(`⏰ Timestamp: ${new Date().toISOString()}\n`);
});

process.on('SIGTERM', () => { console.log('SIGTERM recebido, a desligar...'); process.exit(0); });
process.on('SIGINT',  () => { console.log('\nSIGINT recebido, a desligar...');  process.exit(0); });

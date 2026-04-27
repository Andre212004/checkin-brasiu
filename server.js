const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const usersRouter = require('./routes/users');
const checkinsRouter = require('./routes/checkins');
const imagesRouter = require('./routes/images');
const utilsRouter = require('./routes/utils');

const app = express();
const PORT = process.env.PORT || 3000;


const DIARY_API_KEY = process.env.DIARY_API_KEY;

if (!DIARY_API_KEY) {
  console.error('API key não definida no .env');
  process.exit(1);
}

const REJECT_LOG = path.join(__dirname, 'logs', 'rejected.log');

function logRejected(req, reason) {
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const timestamp = new Date().toISOString();
  const line = `${timestamp} | ${ip} | ${req.method} ${req.originalUrl} | ${reason}\n`;
  fs.appendFile(REJECT_LOG, line, () => {});
}

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

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiados pedidos, tenta novamente em 15 minutos' },
  handler: (req, res, next, options) => {
    logRejected(req, 'RATE_LIMIT_GERAL');
    res.status(429).json(options.message);
  }
});

app.use('/api/', generalLimiter);

function requireApiKey(req, res, next) {
  const publicPaths = ['/', '/health'];
  if (publicPaths.includes(req.path)) return next();

  const key = req.headers['x-api-key'];
  if (!key) {
    logRejected(req, 'API_KEY_AUSENTE');
    return res.status(401).json({ error: 'API key obrigatória' });
  }

  const validKeys = [DIARY_API_KEY].filter(Boolean);
  if (!validKeys.includes(key)) {
    logRejected(req, 'API_KEY_INVALIDA');
    return res.status(401).json({ error: 'API key inválida' });
  }

  next();
}

app.use('/api/', requireApiKey);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Diary API Server',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.use('/api/users', usersRouter);
app.use('/api/checkins', checkinsRouter);
app.use('/api/images', imagesRouter);
app.use('/api/utils', utilsRouter);

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

[
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'logs')
].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.listen(PORT, () => {
  console.log(`Diary API na porta ${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

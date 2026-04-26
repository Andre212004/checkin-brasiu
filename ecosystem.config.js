// ============================================
// ECOSYSTEM.CONFIG.JS - Configuração PM2
// ============================================

module.exports = {
  apps: [{
    name: 'diary-api',
    script: './server.js',
    
    // Instâncias (1 é suficiente para Raspberry Pi)
    instances: 1,
    exec_mode: 'fork',
    
    // Auto-restart
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    
    // Logs
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Variáveis de ambiente
    env: {
      NODE_ENV: 'development',
      PORT: 3003
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3003
    },
    
    // Restart delays
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // Cronjob para bloquear semanas antigas (toda segunda-feira às 00:05)
    cron_restart: '5 0 * * 1'
  }]
};

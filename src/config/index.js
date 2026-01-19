require('dotenv').config();

const config = {
  // Сервер
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiSecretKey: process.env.API_SECRET_KEY || 'dev-secret-key',
  
  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  
  // VAPID для Web Push
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  },
  
  // Apple Push Notification Service
  apns: {
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    bundleId: process.env.APNS_BUNDLE_ID,
    production: process.env.APNS_PRODUCTION === 'true',
    keyPath: process.env.APNS_KEY_PATH || './certs/apns-key.p8'
  },
  
  // Android Push (собственный WebSocket сервер - без Google!)
  // Настройка не требуется, WebSocket автоматически поднимается на /ws/android
  
  // База данных
  database: {
    path: process.env.DATABASE_PATH || './data/notifications.db'
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },
  
  // Логирование
  logLevel: process.env.LOG_LEVEL || 'info'
};

// Валидация конфигурации
function validateConfig() {
  const warnings = [];
  
  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    warnings.push('VAPID ключи не настроены. Web Push уведомления не будут работать. Запустите: npm run generate-vapid');
  }
  
  if (!config.apns.keyId || !config.apns.teamId) {
    warnings.push('APNS не настроен. iOS уведомления не будут работать.');
  }
  
  if (config.nodeEnv === 'production') {
    if (config.apiSecretKey === 'dev-secret-key') {
      throw new Error('API_SECRET_KEY должен быть изменён в production!');
    }
    if (config.jwt.secret === 'dev-jwt-secret') {
      throw new Error('JWT_SECRET должен быть изменён в production!');
    }
  }
  
  return warnings;
}

module.exports = { config, validateConfig };

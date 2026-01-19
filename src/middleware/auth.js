const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { applicationService } = require('../services');

/**
 * Middleware для аутентификации через API ключ
 * Использует заголовок X-API-Key
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API_KEY_MISSING',
      message: 'Требуется X-API-Key заголовок'
    });
  }
  
  const app = applicationService.getByApiKey(apiKey);
  
  if (!app) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_API_KEY',
      message: 'Недействительный API ключ'
    });
  }
  
  req.app = app;
  next();
}

/**
 * Middleware для аутентификации через JWT (для админ-панели)
 */
function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'TOKEN_MISSING',
      message: 'Требуется Authorization: Bearer <token>'
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'Токен истёк'
      });
    }
    
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Недействительный токен'
    });
  }
}

/**
 * Middleware для проверки секретного ключа API (для серверных операций)
 * Использует заголовки X-API-Key и X-API-Secret
 */
function apiSecretAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const apiSecret = req.headers['x-api-secret'];
  
  if (!apiKey || !apiSecret) {
    return res.status(401).json({
      success: false,
      error: 'CREDENTIALS_MISSING',
      message: 'Требуются заголовки X-API-Key и X-API-Secret'
    });
  }
  
  const app = applicationService.getByApiKey(apiKey);
  
  if (!app || app.apiSecret !== apiSecret) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: 'Недействительные учётные данные'
    });
  }
  
  req.app = app;
  next();
}

/**
 * Middleware для проверки роли пользователя
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Требуется аутентификация'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'Недостаточно прав для выполнения операции'
      });
    }
    
    next();
  };
}

module.exports = {
  apiKeyAuth,
  jwtAuth,
  apiSecretAuth,
  requireRole
};

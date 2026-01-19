const rateLimit = require('express-rate-limit');
const { config } = require('../config');

/**
 * Общий rate limiter
 */
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: 'RATE_LIMITED',
    message: 'Слишком много запросов, попробуйте позже'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

/**
 * Rate limiter для публичного API (регистрация устройств)
 * Более мягкий лимит
 */
const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 500,
  message: {
    success: false,
    error: 'RATE_LIMITED',
    message: 'Слишком много запросов'
  },
  validate: { xForwardedForHeader: false }
});

/**
 * Rate limiter для отправки уведомлений
 * Строгий лимит для предотвращения спама
 */
const notificationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 60, // 60 уведомлений в минуту
  message: {
    success: false,
    error: 'RATE_LIMITED',
    message: 'Превышен лимит отправки уведомлений'
  },
  validate: { xForwardedForHeader: false }
});

/**
 * Rate limiter для аутентификации
 * Защита от brute-force
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10, // 10 попыток входа
  message: {
    success: false,
    error: 'RATE_LIMITED',
    message: 'Слишком много попыток входа, попробуйте позже'
  },
  validate: { xForwardedForHeader: false }
});

module.exports = {
  generalLimiter,
  publicApiLimiter,
  notificationLimiter,
  authLimiter
};

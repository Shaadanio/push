const { apiKeyAuth, jwtAuth, apiSecretAuth, requireRole } = require('./auth');
const { generalLimiter, publicApiLimiter, notificationLimiter, authLimiter } = require('./rate-limit');
const { handleValidation, deviceValidators, notificationValidators, applicationValidators } = require('./validators');

module.exports = {
  apiKeyAuth,
  jwtAuth,
  apiSecretAuth,
  requireRole,
  generalLimiter,
  publicApiLimiter,
  notificationLimiter,
  authLimiter,
  handleValidation,
  deviceValidators,
  notificationValidators,
  applicationValidators
};

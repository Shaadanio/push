const { body, param, query, validationResult } = require('express-validator');

/**
 * Обработчик результатов валидации
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Ошибка валидации',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  
  next();
}

// Валидаторы для устройств
const deviceValidators = {
  register: [
    body('platform')
      .isIn(['web', 'ios', 'android'])
      .withMessage('Платформа должна быть web, ios или android'),
    body('token')
      .notEmpty()
      .withMessage('Токен обязателен'),
    body('endpoint')
      .optional()
      .isURL()
      .withMessage('Endpoint должен быть валидным URL'),
    body('p256dh')
      .optional()
      .isString(),
    body('auth')
      .optional()
      .isString(),
    body('userId')
      .optional({ nullable: true })
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        if (typeof value === 'string' || typeof value === 'number') return true;
        throw new Error('userId должен быть строкой или числом');
      }),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags должен быть массивом'),
    body('language')
      .optional()
      .isLength({ min: 2, max: 5 }),
    handleValidation
  ],
  
  update: [
    param('id')
      .isUUID()
      .withMessage('Некорректный ID устройства'),
    body('tags')
      .optional()
      .isArray(),
    body('userId')
      .optional()
      .isString(),
    handleValidation
  ]
};

// Валидаторы для уведомлений
const notificationValidators = {
  send: [
    body('title')
      .notEmpty()
      .withMessage('Заголовок обязателен')
      .isLength({ max: 200 })
      .withMessage('Заголовок слишком длинный'),
    body('body')
      .optional()
      .isLength({ max: 2000 })
      .withMessage('Текст слишком длинный'),
    body('icon')
      .optional()
      .isURL()
      .withMessage('Icon должен быть валидным URL'),
    body('image')
      .optional()
      .isURL()
      .withMessage('Image должен быть валидным URL'),
    body('url')
      .optional()
      .isURL()
      .withMessage('URL должен быть валидным'),
    body('data')
      .optional()
      .isObject()
      .withMessage('Data должен быть объектом'),
    body('platform')
      .optional()
      .isIn(['web', 'ios', 'android'])
      .withMessage('Некорректная платформа'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags должен быть массивом'),
    body('userIds')
      .optional()
      .isArray()
      .withMessage('userIds должен быть массивом'),
    body('userId')
      .optional()
      .custom((value) => {
        if (value === null || value === undefined || value === '') return true;
        if (typeof value === 'string' || typeof value === 'number') return true;
        throw new Error('userId должен быть строкой или числом');
      }),
    handleValidation
  ],
  
  schedule: [
    body('title')
      .notEmpty()
      .withMessage('Заголовок обязателен'),
    body('scheduledAt')
      .isISO8601()
      .withMessage('scheduledAt должен быть в формате ISO 8601'),
    handleValidation
  ]
};

// Валидаторы для приложений
const applicationValidators = {
  create: [
    body('name')
      .notEmpty()
      .withMessage('Название обязательно')
      .isLength({ max: 100 })
      .withMessage('Название слишком длинное'),
    handleValidation
  ],
  
  update: [
    param('id')
      .isUUID()
      .withMessage('Некорректный ID приложения'),
    body('name')
      .optional()
      .isLength({ max: 100 }),
    handleValidation
  ]
};

module.exports = {
  handleValidation,
  deviceValidators,
  notificationValidators,
  applicationValidators
};

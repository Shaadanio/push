const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { config } = require('../config');
const { applicationService, deviceService, notificationService, subscriptionService } = require('../services');
const { jwtAuth, requireRole, authLimiter, applicationValidators } = require('../middleware');

/**
 * @route POST /api/v1/admin/auth/login
 * @desc Авторизация администратора
 */
router.post('/auth/login',
  authLimiter,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_CREDENTIALS',
          message: 'Email и пароль обязательны'
        });
      }
      
      const stmt = db.prepare('SELECT * FROM admin_users WHERE email = ?');
      const user = stmt.get(email);
      
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'Неверный email или пароль'
        });
      }
      
      // Обновляем время последнего входа
      const updateStmt = db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
      updateStmt.run(user.id);
      
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          role: user.role 
        },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      
      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
          }
        }
      });
    } catch (error) {
      console.error('Ошибка авторизации:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route POST /api/v1/admin/auth/register
 * @desc Регистрация первого администратора (только если нет пользователей)
 */
router.post('/auth/register',
  async (req, res) => {
    try {
      const { email, password, name } = req.body;
      
      // Проверяем, есть ли уже администраторы
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM admin_users');
      const { count } = countStmt.get();
      
      if (count > 0) {
        return res.status(403).json({
          success: false,
          error: 'REGISTRATION_CLOSED',
          message: 'Регистрация закрыта. Обратитесь к администратору.'
        });
      }
      
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_FIELDS',
          message: 'Email и пароль обязательны'
        });
      }
      
      const id = uuidv4();
      const passwordHash = bcrypt.hashSync(password, 10);
      
      const insertStmt = db.prepare(`
        INSERT INTO admin_users (id, email, password_hash, name, role)
        VALUES (?, ?, ?, ?, 'admin')
      `);
      insertStmt.run(id, email, passwordHash, name);
      
      const token = jwt.sign(
        { id, email, role: 'admin' },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      
      res.status(201).json({
        success: true,
        data: {
          token,
          user: {
            id,
            email,
            name,
            role: 'admin'
          }
        }
      });
    } catch (error) {
      console.error('Ошибка регистрации:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route GET /api/v1/admin/me
 * @desc Получение данных текущего пользователя
 */
router.get('/me',
  jwtAuth,
  (req, res) => {
    try {
      const stmt = db.prepare('SELECT id, email, name, role, created_at FROM admin_users WHERE id = ?');
      const user = stmt.get(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Пользователь не найден'
        });
      }
      
      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.created_at
        }
      });
    } catch (error) {
      console.error('Ошибка получения пользователя:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

// === Приложения ===

/**
 * @route GET /api/v1/admin/applications
 * @desc Получение списка приложений
 */
router.get('/applications',
  jwtAuth,
  (req, res) => {
    try {
      const apps = applicationService.getAll();
      
      res.json({
        success: true,
        data: apps.map(app => ({
          ...app,
          apiSecret: undefined // Не отправляем секрет в списке
        }))
      });
    } catch (error) {
      console.error('Ошибка получения приложений:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route POST /api/v1/admin/applications
 * @desc Создание нового приложения
 */
router.post('/applications',
  jwtAuth,
  requireRole('admin'),
  applicationValidators.create,
  (req, res) => {
    try {
      const userId = req.user.id;
      
      // Проверяем лимиты подписки
      const platforms = {
        web: req.body.webPushEnabled !== false,
        ios: req.body.apnsEnabled === true,
        android: req.body.androidEnabled !== false
      };
      
      const canCreate = subscriptionService.canCreateApp(userId, platforms);
      
      if (!canCreate.allowed) {
        const messages = {
          WEB_LIMIT_REACHED: `Достигнут лимит Web Push проектов (${canCreate.limit}). Перейдите на Pro для снятия ограничений.`,
          IOS_LIMIT_REACHED: `Достигнут лимит iOS проектов (${canCreate.limit}). Перейдите на Pro для снятия ограничений.`,
          ANDROID_LIMIT_REACHED: `Достигнут лимит Android проектов (${canCreate.limit}). Перейдите на Pro для снятия ограничений.`
        };
        
        return res.status(403).json({
          success: false,
          error: canCreate.reason,
          message: messages[canCreate.reason] || 'Достигнут лимит проектов',
          limit: canCreate.limit,
          current: canCreate.current
        });
      }
      
      const app = applicationService.create({
        name: req.body.name,
        apnsEnabled: req.body.apnsEnabled,
        androidEnabled: req.body.androidEnabled,
        webPushEnabled: req.body.webPushEnabled
      }, userId);
      
      res.status(201).json({
        success: true,
        data: app
      });
    } catch (error) {
      console.error('Ошибка создания приложения:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route GET /api/v1/admin/applications/:id
 * @desc Получение приложения по ID
 */
router.get('/applications/:id',
  jwtAuth,
  (req, res) => {
    try {
      const app = applicationService.getById(req.params.id);
      
      if (!app) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Приложение не найдено'
        });
      }
      
      res.json({
        success: true,
        data: app
      });
    } catch (error) {
      console.error('Ошибка получения приложения:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route PUT /api/v1/admin/applications/:id
 * @desc Обновление приложения
 */
router.put('/applications/:id',
  jwtAuth,
  requireRole('admin', 'editor'),
  applicationValidators.update,
  (req, res) => {
    try {
      const app = applicationService.update(req.params.id, req.body);
      
      if (!app) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Приложение не найдено'
        });
      }
      
      res.json({
        success: true,
        data: app
      });
    } catch (error) {
      console.error('Ошибка обновления приложения:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route DELETE /api/v1/admin/applications/:id
 * @desc Удаление приложения
 */
router.delete('/applications/:id',
  jwtAuth,
  requireRole('admin'),
  (req, res) => {
    try {
      const deleted = applicationService.delete(req.params.id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Приложение не найдено'
        });
      }
      
      res.json({
        success: true,
        data: {
          deleted: true
        }
      });
    } catch (error) {
      console.error('Ошибка удаления приложения:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route POST /api/v1/admin/applications/:id/rotate-keys
 * @desc Ротация API ключей
 */
router.post('/applications/:id/rotate-keys',
  jwtAuth,
  requireRole('admin'),
  (req, res) => {
    try {
      const app = applicationService.rotateApiKeys(req.params.id);
      
      if (!app) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Приложение не найдено'
        });
      }
      
      res.json({
        success: true,
        data: {
          apiKey: app.apiKey,
          apiSecret: app.apiSecret
        }
      });
    } catch (error) {
      console.error('Ошибка ротации ключей:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route GET /api/v1/admin/applications/:id/stats
 * @desc Статистика приложения
 */
router.get('/applications/:id/stats',
  jwtAuth,
  (req, res) => {
    try {
      const stats = applicationService.getStats(req.params.id);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

// === Устройства ===

/**
 * @route GET /api/v1/admin/applications/:appId/devices
 * @desc Получение устройств приложения
 */
router.get('/applications/:appId/devices',
  jwtAuth,
  (req, res) => {
    try {
      const devices = deviceService.getAll(req.params.appId, {
        platform: req.query.platform,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0
      });
      
      const total = deviceService.count(req.params.appId);
      
      res.json({
        success: true,
        data: {
          devices,
          total
        }
      });
    } catch (error) {
      console.error('Ошибка получения устройств:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

// === Уведомления ===

/**
 * @route GET /api/v1/admin/applications/:appId/notifications
 * @desc Получение истории уведомлений приложения
 */
router.get('/applications/:appId/notifications',
  jwtAuth,
  (req, res) => {
    try {
      const notifications = notificationService.getHistory(req.params.appId, {
        status: req.query.status,
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0
      });
      
      res.json({
        success: true,
        data: notifications
      });
    } catch (error) {
      console.error('Ошибка получения уведомлений:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

// === Подписки ===

/**
 * @route GET /api/v1/admin/subscription
 * @desc Получение информации о подписке текущего пользователя
 */
router.get('/subscription',
  jwtAuth,
  (req, res) => {
    try {
      const subscriptionInfo = subscriptionService.getSubscriptionInfo(req.user.id);
      
      res.json({
        success: true,
        data: subscriptionInfo
      });
    } catch (error) {
      console.error('Ошибка получения подписки:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route POST /api/v1/admin/subscription/upgrade
 * @desc Заявка на переход на Pro
 */
router.post('/subscription/upgrade',
  jwtAuth,
  (req, res) => {
    try {
      const { email, message } = req.body;
      const user = req.user;
      
      // Здесь можно добавить отправку email или сохранение заявки
      // Пока просто логируем и возвращаем успех
      console.log(`[UPGRADE REQUEST] User: ${user.email}, Contact: ${email || user.email}, Message: ${message}`);
      
      res.json({
        success: true,
        message: 'Заявка на переход на Pro отправлена. Мы свяжемся с вами в ближайшее время.'
      });
    } catch (error) {
      console.error('Ошибка заявки на upgrade:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route GET /api/v1/admin/subscriptions
 * @desc Получение всех подписок (только для суперадмина)
 */
router.get('/subscriptions',
  jwtAuth,
  requireRole('admin'),
  (req, res) => {
    try {
      const subscriptions = subscriptionService.getAll();
      
      res.json({
        success: true,
        data: subscriptions
      });
    } catch (error) {
      console.error('Ошибка получения подписок:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route PUT /api/v1/admin/subscriptions/:userId
 * @desc Обновление подписки пользователя (только для суперадмина)
 */
router.put('/subscriptions/:userId',
  jwtAuth,
  requireRole('admin'),
  (req, res) => {
    try {
      const { plan, expiresAt } = req.body;
      
      if (!['free', 'pro'].includes(plan)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PLAN',
          message: 'Неверный тарифный план'
        });
      }
      
      const subscription = subscriptionService.updatePlan(req.params.userId, plan, expiresAt);
      
      res.json({
        success: true,
        data: subscription
      });
    } catch (error) {
      console.error('Ошибка обновления подписки:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route GET /api/v1/admin/users
 * @desc Получение списка всех пользователей (только для админа)
 */
router.get('/users',
  jwtAuth,
  requireRole('admin'),
  (req, res) => {
    try {
      // Получаем всех пользователей с их подписками и количеством приложений
      const stmt = db.prepare(`
        SELECT 
          u.id, 
          u.email, 
          u.name, 
          u.role, 
          u.last_login as lastLogin,
          u.created_at as createdAt,
          s.plan as subscriptionPlan,
          s.expires_at as subscriptionExpiresAt,
          (SELECT COUNT(*) FROM applications WHERE owner_id = u.id) as appsCount
        FROM admin_users u
        LEFT JOIN subscriptions s ON u.id = s.user_id
        ORDER BY u.created_at DESC
      `);
      
      const users = stmt.all().map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        lastLogin: u.lastLogin,
        createdAt: u.createdAt,
        appsCount: u.appsCount || 0,
        subscription: {
          plan: u.subscriptionPlan || 'free',
          expiresAt: u.subscriptionExpiresAt
        }
      }));
      
      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('Ошибка получения пользователей:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

module.exports = router;

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database');
const { config } = require('../config');
const { applicationService, deviceService, notificationService } = require('../services');
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
      const app = applicationService.create({
        name: req.body.name,
        apnsEnabled: req.body.apnsEnabled,
        androidEnabled: req.body.androidEnabled,
        webPushEnabled: req.body.webPushEnabled
      });
      
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

module.exports = router;

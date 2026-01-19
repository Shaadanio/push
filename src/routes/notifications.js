const express = require('express');
const router = express.Router();
const { notificationService } = require('../services');
const { apiSecretAuth, notificationLimiter, notificationValidators } = require('../middleware');

/**
 * @route POST /api/v1/notifications/send
 * @desc Отправка уведомления
 * @access Private (с API Secret)
 */
router.post('/send',
  notificationLimiter,
  apiSecretAuth,
  notificationValidators.send,
  async (req, res) => {
    try {
      // Поддержка как userId (один), так и userIds (массив)
      let userIds = req.body.userIds;
      if (!userIds && req.body.userId) {
        userIds = [req.body.userId];
      }
      
      const result = await notificationService.send(
        req.app.id,
        {
          title: req.body.title,
          body: req.body.body,
          icon: req.body.icon,
          image: req.body.image,
          url: req.body.url,
          data: req.body.data,
          ttl: req.body.ttl,
          priority: req.body.priority,
          tag: req.body.tag,
          collapseKey: req.body.collapseKey
        },
        {
          platform: req.body.platform,
          tags: req.body.tags,
          userIds: userIds,
          segment: req.body.segment
        }
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Ошибка отправки уведомления:', error);
      res.status(500).json({
        success: false,
        error: 'SEND_ERROR',
        message: error.message
      });
    }
  }
);

/**
 * @route POST /api/v1/notifications/send-to-user/:userId
 * @desc Отправка уведомления конкретному пользователю (на все его устройства)
 * @access Private (с API Secret)
 */
router.post('/send-to-user/:userId',
  notificationLimiter,
  apiSecretAuth,
  notificationValidators.send,
  async (req, res) => {
    try {
      const result = await notificationService.sendToUser(
        req.app.id,
        req.params.userId,
        {
          title: req.body.title,
          body: req.body.body,
          icon: req.body.icon,
          image: req.body.image,
          url: req.body.url,
          data: req.body.data,
          ttl: req.body.ttl,
          priority: req.body.priority
        }
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Ошибка отправки уведомления пользователю:', error);
      res.status(500).json({
        success: false,
        error: 'SEND_ERROR',
        message: error.message
      });
    }
  }
);

/**
 * @route POST /api/v1/notifications/send-to-device/:deviceId
 * @desc Отправка уведомления конкретному устройству
 * @access Private (с API Secret)
 */
router.post('/send-to-device/:deviceId',
  notificationLimiter,
  apiSecretAuth,
  notificationValidators.send,
  async (req, res) => {
    try {
      const result = await notificationService.sendToDevice(
        req.app.id,
        req.params.deviceId,
        {
          title: req.body.title,
          body: req.body.body,
          icon: req.body.icon,
          image: req.body.image,
          url: req.body.url,
          data: req.body.data
        }
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Ошибка отправки уведомления:', error);
      
      if (error.message === 'Устройство не найдено') {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'SEND_ERROR',
        message: error.message
      });
    }
  }
);

/**
 * @route POST /api/v1/notifications/send-to-user/:userId
 * @desc Отправка уведомления пользователю (на все его устройства)
 * @access Private (с API Secret)
 */
router.post('/send-to-user/:userId',
  notificationLimiter,
  apiSecretAuth,
  notificationValidators.send,
  async (req, res) => {
    try {
      const result = await notificationService.sendToUser(
        req.app.id,
        req.params.userId,
        {
          title: req.body.title,
          body: req.body.body,
          icon: req.body.icon,
          image: req.body.image,
          url: req.body.url,
          data: req.body.data
        }
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Ошибка отправки уведомления:', error);
      res.status(500).json({
        success: false,
        error: 'SEND_ERROR',
        message: error.message
      });
    }
  }
);

/**
 * @route POST /api/v1/notifications/schedule
 * @desc Планирование отложенной отправки
 * @access Private (с API Secret)
 */
router.post('/schedule',
  apiSecretAuth,
  notificationValidators.schedule,
  (req, res) => {
    try {
      const result = notificationService.schedule(
        req.app.id,
        {
          title: req.body.title,
          body: req.body.body,
          icon: req.body.icon,
          image: req.body.image,
          url: req.body.url,
          data: req.body.data
        },
        req.body.scheduledAt,
        {
          platform: req.body.platform,
          tags: req.body.tags,
          userIds: req.body.userIds,
          segment: req.body.segment
        }
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Ошибка планирования уведомления:', error);
      res.status(500).json({
        success: false,
        error: 'SCHEDULE_ERROR',
        message: error.message
      });
    }
  }
);

/**
 * @route DELETE /api/v1/notifications/:id/cancel
 * @desc Отмена запланированного уведомления
 * @access Private (с API Secret)
 */
router.delete('/:id/cancel',
  apiSecretAuth,
  (req, res) => {
    try {
      const cancelled = notificationService.cancel(req.params.id);
      
      if (!cancelled) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Уведомление не найдено или не может быть отменено'
        });
      }
      
      res.json({
        success: true,
        data: {
          cancelled: true
        }
      });
    } catch (error) {
      console.error('Ошибка отмены уведомления:', error);
      res.status(500).json({
        success: false,
        error: 'CANCEL_ERROR',
        message: error.message
      });
    }
  }
);

/**
 * @route GET /api/v1/notifications/:id
 * @desc Получение информации об уведомлении
 * @access Private (с API Secret)
 */
router.get('/:id',
  apiSecretAuth,
  (req, res) => {
    try {
      const notification = notificationService.getById(req.params.id);
      
      if (!notification || notification.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Уведомление не найдено'
        });
      }
      
      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      console.error('Ошибка получения уведомления:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route GET /api/v1/notifications
 * @desc Получение истории уведомлений
 * @access Private (с API Secret)
 */
router.get('/',
  apiSecretAuth,
  (req, res) => {
    try {
      const notifications = notificationService.getHistory(req.app.id, {
        status: req.query.status,
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0
      });
      
      res.json({
        success: true,
        data: notifications
      });
    } catch (error) {
      console.error('Ошибка получения истории:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route POST /api/v1/notifications/:id/click
 * @desc Трекинг клика по уведомлению
 * @access Public (с API ключом)
 */
router.post('/:id/click',
  (req, res) => {
    try {
      const { deviceId } = req.body;
      
      notificationService.trackClick(req.params.id, deviceId);
      
      res.json({
        success: true
      });
    } catch (error) {
      console.error('Ошибка трекинга клика:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

/**
 * @route POST /api/v1/notifications/:id/delivered
 * @desc Трекинг доставки уведомления
 * @access Public (с API ключом)
 */
router.post('/:id/delivered',
  (req, res) => {
    try {
      const { deviceId } = req.body;
      
      notificationService.trackDelivery(req.params.id, deviceId);
      
      res.json({
        success: true
      });
    } catch (error) {
      console.error('Ошибка трекинга доставки:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Внутренняя ошибка сервера'
      });
    }
  }
);

module.exports = router;

const express = require('express');
const router = express.Router();
const { deviceService } = require('../services');
const { apiKeyAuth, publicApiLimiter, deviceValidators } = require('../middleware');

/**
 * @route POST /api/v1/devices/register
 * @desc Регистрация нового устройства
 * @access Public (с API ключом)
 */
router.post('/register', 
  publicApiLimiter,
  apiKeyAuth,
  deviceValidators.register,
  (req, res) => {
    try {
      const device = deviceService.register(req.app.id, {
        platform: req.body.platform,
        token: req.body.token,
        endpoint: req.body.endpoint,
        p256dh: req.body.p256dh,
        auth: req.body.auth,
        userId: req.body.userId,
        tags: req.body.tags,
        language: req.body.language,
        timezone: req.body.timezone,
        deviceModel: req.body.deviceModel,
        osVersion: req.body.osVersion,
        appVersion: req.body.appVersion
      });
      
      res.status(201).json({
        success: true,
        data: {
          deviceId: device.id
        }
      });
    } catch (error) {
      console.error('Ошибка регистрации устройства:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при регистрации устройства'
      });
    }
  }
);

/**
 * @route DELETE /api/v1/devices/unregister
 * @desc Отмена регистрации устройства (отписка)
 * @access Public (с API ключом)
 */
router.delete('/unregister',
  publicApiLimiter,
  apiKeyAuth,
  (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'TOKEN_REQUIRED',
          message: 'Токен обязателен'
        });
      }
      
      const deleted = deviceService.deleteByToken(req.app.id, token);
      
      res.json({
        success: true,
        data: {
          deleted
        }
      });
    } catch (error) {
      console.error('Ошибка отписки устройства:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при отписке устройства'
      });
    }
  }
);

/**
 * @route PUT /api/v1/devices/:id
 * @desc Обновление информации об устройстве
 * @access Public (с API ключом)
 */
router.put('/:id',
  apiKeyAuth,
  deviceValidators.update,
  (req, res) => {
    try {
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      const updated = deviceService.update(req.params.id, req.body);
      
      res.json({
        success: true,
        data: {
          deviceId: updated.id
        }
      });
    } catch (error) {
      console.error('Ошибка обновления устройства:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при обновлении устройства'
      });
    }
  }
);

/**
 * @route POST /api/v1/devices/:id/link-user
 * @desc Привязка пользователя к устройству (после авторизации)
 * @access Public (с API ключом)
 */
router.post('/:id/link-user',
  apiKeyAuth,
  (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'USER_ID_REQUIRED',
          message: 'userId обязателен'
        });
      }
      
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      const updated = deviceService.update(req.params.id, { userId: String(userId) });
      
      console.log(`[LINK-USER] deviceId=${req.params.id}, userId=${userId}`);
      
      res.json({
        success: true,
        data: {
          deviceId: updated.id,
          userId: updated.userId
        }
      });
    } catch (error) {
      console.error('Ошибка привязки пользователя:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при привязке пользователя'
      });
    }
  }
);

/**
 * @route POST /api/v1/devices/:id/unlink-user
 * @desc Отвязка пользователя от устройства (после выхода)
 * @access Public (с API ключом)
 */
router.post('/:id/unlink-user',
  apiKeyAuth,
  (req, res) => {
    try {
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      const updated = deviceService.update(req.params.id, { userId: null });
      
      console.log(`[UNLINK-USER] deviceId=${req.params.id}`);
      
      res.json({
        success: true,
        data: {
          deviceId: updated.id
        }
      });
    } catch (error) {
      console.error('Ошибка отвязки пользователя:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при отвязке пользователя'
      });
    }
  }
);

/**
 * @route GET /api/v1/devices/:id/poll
 * @desc Получение pending уведомлений для устройства (polling для FlutterFlow)
 * @access Public (с API ключом)
 */
router.get('/:id/poll',
  apiKeyAuth,
  (req, res) => {
    try {
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      // Получаем pending уведомления для этого устройства
      const { androidPushProvider } = require('../providers');
      const pendingMessages = androidPushProvider.getPendingMessages(req.params.id);
      
      console.log(`[POLL] Device ${req.params.id}: found ${pendingMessages?.length || 0} messages`);
      
      res.json({
        success: true,
        data: {
          notifications: pendingMessages || []
        }
      });
    } catch (error) {
      console.error('Ошибка polling:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при получении уведомлений'
      });
    }
  }
);

/**
 * @route DELETE /api/v1/devices/:id
 * @desc Удаление устройства по ID (когда разрешение отозвано)
 * @access Public (с API ключом)
 */
router.delete('/:id',
  apiKeyAuth,
  (req, res) => {
    try {
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      deviceService.delete(req.params.id);
      
      res.json({
        success: true,
        data: {
          deleted: true
        }
      });
    } catch (error) {
      console.error('Ошибка удаления устройства:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при удалении устройства'
      });
    }
  }
);

/**
 * @route POST /api/v1/devices/:id/tags
 * @desc Добавление тегов к устройству
 * @access Public (с API ключом)
 */
router.post('/:id/tags',
  apiKeyAuth,
  (req, res) => {
    try {
      const { tags } = req.body;
      
      if (!Array.isArray(tags)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TAGS',
          message: 'Tags должен быть массивом'
        });
      }
      
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      const updated = deviceService.addTags(req.params.id, tags);
      
      res.json({
        success: true,
        data: {
          tags: updated.tags
        }
      });
    } catch (error) {
      console.error('Ошибка добавления тегов:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при добавлении тегов'
      });
    }
  }
);

/**
 * @route DELETE /api/v1/devices/:id/tags
 * @desc Удаление тегов с устройства
 * @access Public (с API ключом)
 */
router.delete('/:id/tags',
  apiKeyAuth,
  (req, res) => {
    try {
      const { tags } = req.body;
      
      if (!Array.isArray(tags)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TAGS',
          message: 'Tags должен быть массивом'
        });
      }
      
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      const updated = deviceService.removeTags(req.params.id, tags);
      
      res.json({
        success: true,
        data: {
          tags: updated.tags
        }
      });
    } catch (error) {
      console.error('Ошибка удаления тегов:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при удалении тегов'
      });
    }
  }
);

/**
 * @route POST /api/v1/devices/:id/user
 * @desc Привязка устройства к пользователю
 * @access Public (с API ключом)
 */
router.post('/:id/user',
  apiKeyAuth,
  (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'USER_ID_REQUIRED',
          message: 'userId обязателен'
        });
      }
      
      const device = deviceService.getById(req.params.id);
      
      if (!device || device.appId !== req.app.id) {
        return res.status(404).json({
          success: false,
          error: 'NOT_FOUND',
          message: 'Устройство не найдено'
        });
      }
      
      const updated = deviceService.setUserId(req.params.id, userId);
      
      res.json({
        success: true,
        data: {
          deviceId: updated.id,
          userId: updated.userId
        }
      });
    } catch (error) {
      console.error('Ошибка привязки пользователя:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Ошибка при привязке пользователя'
      });
    }
  }
);

module.exports = router;

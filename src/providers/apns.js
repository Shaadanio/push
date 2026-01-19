const apn = require('apn');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

class APNSProvider {
  constructor() {
    this.provider = null;
    this.initialized = false;
  }
  
  /**
   * Инициализация APNS провайдера
   */
  initialize(options = {}) {
    const keyPath = options.keyPath || config.apns.keyPath;
    const keyId = options.keyId || config.apns.keyId;
    const teamId = options.teamId || config.apns.teamId;
    const production = options.production !== undefined ? options.production : config.apns.production;
    
    if (!keyId || !teamId) {
      console.warn('⚠ APNS: Не настроены keyId или teamId');
      return false;
    }
    
    // Проверяем существование ключа
    const absoluteKeyPath = path.resolve(keyPath);
    if (!fs.existsSync(absoluteKeyPath)) {
      console.warn(`⚠ APNS: Ключ не найден по пути ${absoluteKeyPath}`);
      return false;
    }
    
    try {
      this.provider = new apn.Provider({
        token: {
          key: absoluteKeyPath,
          keyId: keyId,
          teamId: teamId
        },
        production: production
      });
      
      this.bundleId = options.bundleId || config.apns.bundleId;
      this.initialized = true;
      console.log(`✓ APNS инициализирован (${production ? 'production' : 'sandbox'})`);
      return true;
    } catch (error) {
      console.error('✗ APNS: Ошибка инициализации:', error.message);
      return false;
    }
  }
  
  /**
   * Отправка push-уведомления на iOS устройство
   * @param {string} deviceToken - Device token устройства
   * @param {Object} payload - Данные уведомления
   * @returns {Promise<Object>} - Результат отправки
   */
  async send(deviceToken, payload) {
    if (!this.initialized) {
      throw new Error('APNS не инициализирован');
    }
    
    const notification = new apn.Notification();
    
    // Основные поля уведомления
    notification.alert = {
      title: payload.title,
      body: payload.body,
      subtitle: payload.subtitle
    };
    
    // Звук уведомления
    notification.sound = payload.sound || 'default';
    
    // Badge (число на иконке приложения)
    if (payload.badge !== undefined) {
      notification.badge = payload.badge;
    }
    
    // Категория для интерактивных уведомлений
    if (payload.category) {
      notification.category = payload.category;
    }
    
    // Thread ID для группировки уведомлений
    if (payload.threadId) {
      notification.threadId = payload.threadId;
    }
    
    // Пользовательские данные
    notification.payload = {
      notificationId: payload.notificationId,
      url: payload.url,
      ...payload.data
    };
    
    // Приоритет
    notification.priority = payload.priority || 10; // 10 = немедленная доставка, 5 = энергосберегающая
    
    // Время жизни уведомления
    if (payload.expiry) {
      notification.expiry = Math.floor(Date.now() / 1000) + payload.expiry;
    }
    
    // Collapse ID для замены предыдущих уведомлений
    if (payload.collapseId) {
      notification.collapseId = payload.collapseId;
    }
    
    // Content-available для фоновых обновлений
    if (payload.contentAvailable) {
      notification.contentAvailable = true;
    }
    
    // Mutable-content для модификации уведомления в приложении
    if (payload.mutableContent) {
      notification.mutableContent = true;
    }
    
    notification.topic = this.bundleId;
    
    try {
      const result = await this.provider.send(notification, deviceToken);
      
      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const error = failure.response || {};
        
        // Обработка специфичных ошибок APNS
        if (error.reason === 'BadDeviceToken' || 
            error.reason === 'Unregistered' || 
            error.reason === 'DeviceTokenNotForTopic') {
          return {
            success: false,
            error: error.reason,
            message: 'Устройство недействительно и должно быть удалено',
            shouldRemove: true
          };
        }
        
        return {
          success: false,
          error: error.reason || 'UNKNOWN_ERROR',
          message: error.reason || 'Неизвестная ошибка',
          statusCode: error.status,
          shouldRemove: false
        };
      }
      
      return {
        success: true,
        sent: result.sent.length
      };
    } catch (error) {
      return {
        success: false,
        error: 'EXCEPTION',
        message: error.message,
        shouldRemove: false
      };
    }
  }
  
  /**
   * Массовая отправка уведомлений на iOS устройства
   * @param {Array<string>} deviceTokens - Массив device token
   * @param {Object} payload - Данные уведомления
   * @returns {Promise<Object>} - Статистика отправки
   */
  async sendBatch(devices, payload) {
    const results = {
      total: devices.length,
      success: 0,
      failed: 0,
      expired: [],
      errors: []
    };
    
    // APNS поддерживает отправку на несколько устройств одновременно
    const promises = devices.map(async (device) => {
      try {
        const result = await this.send(device.token, payload);
        if (result.success) {
          results.success++;
        } else {
          results.failed++;
          if (result.shouldRemove) {
            results.expired.push(device.id);
          }
          results.errors.push({
            deviceId: device.id,
            error: result.error,
            message: result.message
          });
        }
        return result;
      } catch (error) {
        results.failed++;
        results.errors.push({
          deviceId: device.id,
          error: 'EXCEPTION',
          message: error.message
        });
        return { success: false, error: error.message };
      }
    });
    
    await Promise.allSettled(promises);
    return results;
  }
  
  /**
   * Закрытие соединения с APNS
   */
  shutdown() {
    if (this.provider) {
      this.provider.shutdown();
      this.initialized = false;
      console.log('APNS провайдер остановлен');
    }
  }
}

module.exports = new APNSProvider();

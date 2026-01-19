const webPush = require('web-push');
const { config } = require('../config');

class WebPushProvider {
  constructor() {
    this.initialized = false;
  }
  
  /**
   * Инициализация Web Push с VAPID ключами
   */
  initialize(vapidPublicKey, vapidPrivateKey, subject) {
    const publicKey = vapidPublicKey || config.vapid.publicKey;
    const privateKey = vapidPrivateKey || config.vapid.privateKey;
    const vapidSubject = subject || config.vapid.subject;
    
    if (!publicKey || !privateKey) {
      console.warn('⚠ Web Push: VAPID ключи не настроены');
      return false;
    }
    
    webPush.setVapidDetails(vapidSubject, publicKey, privateKey);
    this.initialized = true;
    console.log('✓ Web Push инициализирован');
    return true;
  }
  
  /**
   * Отправка уведомления через Web Push
   * @param {Object} subscription - Подписка браузера {endpoint, keys: {p256dh, auth}}
   * @param {Object} payload - Данные уведомления
   * @returns {Promise<Object>} - Результат отправки
   */
  async send(subscription, payload) {
    if (!this.initialized) {
      throw new Error('Web Push не инициализирован');
    }
    
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };
    
    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon,
      image: payload.image,
      badge: payload.badge,
      tag: payload.tag || 'default',
      requireInteraction: payload.requireInteraction || false,
      renotify: payload.renotify || false,
      silent: payload.silent || false,
      vibrate: payload.vibrate || [200, 100, 200],
      data: {
        url: payload.url,
        notificationId: payload.notificationId,
        apiUrl: payload.apiUrl,  // URL сервера для статистики
        ...payload.data
      },
      actions: payload.actions || []
    });
    
    console.log('[WEB-PUSH] Отправка payload:', notificationPayload);
    
    const options = {
      TTL: payload.ttl || 86400, // 24 часа по умолчанию
      urgency: payload.urgency || 'normal', // 'very-low', 'low', 'normal', 'high'
      topic: payload.topic
    };
    
    try {
      const result = await webPush.sendNotification(pushSubscription, notificationPayload, options);
      return {
        success: true,
        statusCode: result.statusCode,
        headers: result.headers
      };
    } catch (error) {
      // Обработка специфичных ошибок Web Push
      if (error.statusCode === 410 || error.statusCode === 404) {
        // Подписка недействительна - нужно удалить
        return {
          success: false,
          statusCode: error.statusCode,
          error: 'SUBSCRIPTION_EXPIRED',
          message: 'Подписка недействительна и должна быть удалена',
          shouldRemove: true
        };
      }
      
      if (error.statusCode === 429) {
        return {
          success: false,
          statusCode: error.statusCode,
          error: 'RATE_LIMITED',
          message: 'Превышен лимит запросов',
          shouldRemove: false
        };
      }
      
      return {
        success: false,
        statusCode: error.statusCode,
        error: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        shouldRemove: false
      };
    }
  }
  
  /**
   * Массовая отправка уведомлений
   * @param {Array} subscriptions - Массив подписок
   * @param {Object} payload - Данные уведомления
   * @returns {Promise<Object>} - Статистика отправки
   */
  async sendBatch(subscriptions, payload) {
    const results = {
      total: subscriptions.length,
      success: 0,
      failed: 0,
      expired: [],
      errors: []
    };
    
    const promises = subscriptions.map(async (sub) => {
      try {
        const result = await this.send(sub, payload);
        if (result.success) {
          results.success++;
        } else {
          results.failed++;
          if (result.shouldRemove) {
            results.expired.push(sub.id);
          }
          results.errors.push({
            deviceId: sub.id,
            error: result.error,
            message: result.message
          });
        }
        return result;
      } catch (error) {
        results.failed++;
        results.errors.push({
          deviceId: sub.id,
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
   * Генерация VAPID ключей
   */
  static generateVapidKeys() {
    return webPush.generateVAPIDKeys();
  }
}

module.exports = new WebPushProvider();

const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');
const deviceService = require('./device.service');
const applicationService = require('./application.service');
const { webPushProvider, apnsProvider, androidPushProvider } = require('../providers');
const { config } = require('../config');

class NotificationService {
  /**
   * Создание и отправка уведомления
   */
  async send(appId, payload, options = {}) {
    const app = applicationService.getById(appId);
    if (!app) {
      throw new Error('Приложение не найдено');
    }
    
    const notificationId = uuidv4();
    
    // Сохраняем уведомление в БД
    const notificationStmt = db.prepare(`
      INSERT INTO notifications 
      (id, app_id, title, body, icon, image, url, data, segment, tags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending')
    `);
    
    notificationStmt.run(
      notificationId,
      appId,
      payload.title,
      payload.body || null,
      payload.icon || null,
      payload.image || null,
      payload.url || null,
      JSON.stringify(payload.data || {}),
      options.segment || null,
      JSON.stringify(options.tags || [])
    );
    
    // Получаем устройства для отправки
    const devices = deviceService.getForNotification(appId, {
      platform: options.platform,
      userIds: options.userIds,
      tags: options.tags
    });
    
    if (devices.length === 0) {
      this._updateNotificationStatus(notificationId, 'completed', { totalSent: 0 });
      return {
        notificationId,
        status: 'completed',
        message: 'Нет устройств для отправки',
        stats: { total: 0, sent: 0, failed: 0 }
      };
    }
    
    // Группируем устройства по платформам
    const webDevices = devices.filter(d => d.platform === 'web');
    const iosDevices = devices.filter(d => d.platform === 'ios');
    const androidDevices = devices.filter(d => d.platform === 'android');
    
    const results = {
      total: devices.length,
      success: 0,
      failed: 0,
      expired: []
    };
    
    const notificationPayload = {
      ...payload,
      notificationId,
      apiUrl: config.serverUrl  // URL сервера для статистики
    };
    
    // Отправка Web Push
    if (webDevices.length > 0 && app.webPushEnabled) {
      const webResult = await this._sendWebPush(app, webDevices, notificationPayload);
      results.success += webResult.success;
      results.failed += webResult.failed;
      results.expired.push(...webResult.expired);
    }
    
    // Отправка на iOS
    if (iosDevices.length > 0 && app.apnsEnabled) {
      const iosResult = await this._sendAPNS(iosDevices, notificationPayload);
      results.success += iosResult.success;
      results.failed += iosResult.failed;
      results.expired.push(...iosResult.expired);
    }
    
    // Отправка на Android
    if (androidDevices.length > 0 && app.androidEnabled) {
      const androidResult = await this._sendAndroid(androidDevices, notificationPayload);
      results.success += androidResult.success;
      results.failed += androidResult.failed;
      results.expired.push(...androidResult.expired);
    }
    
    // Деактивируем устаревшие токены
    if (results.expired.length > 0) {
      deviceService.deactivateBatch(results.expired);
    }
    
    // Обновляем статистику уведомления
    this._updateNotificationStatus(notificationId, 'completed', {
      totalSent: results.success,
      totalFailed: results.failed
    });
    
    return {
      notificationId,
      status: 'completed',
      stats: {
        total: results.total,
        sent: results.success,
        failed: results.failed,
        expiredDevices: results.expired.length
      }
    };
  }
  
  /**
   * Отправка конкретному устройству
   */
  async sendToDevice(appId, deviceId, payload) {
    const device = deviceService.getById(deviceId);
    if (!device || device.appId !== appId) {
      throw new Error('Устройство не найдено');
    }
    
    const app = applicationService.getById(appId);
    if (!app) {
      throw new Error('Приложение не найдено');
    }
    
    const notificationId = uuidv4();
    const notificationPayload = { 
      ...payload, 
      notificationId,
      apiUrl: config.serverUrl
    };
    
    let result;
    
    switch (device.platform) {
      case 'web':
        if (!app.webPushEnabled) throw new Error('Web Push отключён для этого приложения');
        result = await this._sendWebPush(app, [device], notificationPayload);
        break;
      case 'ios':
        if (!app.apnsEnabled) throw new Error('APNS отключён для этого приложения');
        result = await this._sendAPNS([device], notificationPayload);
        break;
      case 'android':
        if (!app.androidEnabled) throw new Error('Android Push отключён для этого приложения');
        result = await this._sendAndroid([device], notificationPayload);
        break;
      default:
        throw new Error('Неизвестная платформа');
    }
    
    // Деактивируем если токен невалидный
    if (result.expired.length > 0) {
      deviceService.deactivate(deviceId);
    }
    
    return {
      notificationId,
      success: result.success > 0,
      errors: result.errors
    };
  }
  
  /**
   * Отправка пользователю (на все его устройства)
   */
  async sendToUser(appId, userId, payload) {
    return this.send(appId, payload, { userIds: [userId] });
  }
  
  /**
   * Планирование отложенной отправки
   */
  schedule(appId, payload, scheduledAt, options = {}) {
    const notificationId = uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO notifications 
      (id, app_id, title, body, icon, image, url, data, segment, tags, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
    `);
    
    stmt.run(
      notificationId,
      appId,
      payload.title,
      payload.body || null,
      payload.icon || null,
      payload.image || null,
      payload.url || null,
      JSON.stringify(payload.data || {}),
      options.segment || null,
      JSON.stringify(options.tags || []),
      scheduledAt
    );
    
    return {
      notificationId,
      status: 'scheduled',
      scheduledAt
    };
  }
  
  /**
   * Отмена запланированного уведомления
   */
  cancel(notificationId) {
    const stmt = db.prepare(`
      UPDATE notifications 
      SET status = 'cancelled' 
      WHERE id = ? AND status = 'scheduled'
    `);
    const result = stmt.run(notificationId);
    return result.changes > 0;
  }
  
  /**
   * Получение уведомления по ID
   */
  getById(id) {
    const stmt = db.prepare('SELECT * FROM notifications WHERE id = ?');
    const notification = stmt.get(id);
    return notification ? this._formatNotification(notification) : null;
  }
  
  /**
   * Получение истории уведомлений приложения
   */
  getHistory(appId, options = {}) {
    let query = 'SELECT * FROM notifications WHERE app_id = ?';
    const params = [appId];
    
    if (options.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    
    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }
    
    const stmt = db.prepare(query);
    return stmt.all(...params).map(n => this._formatNotification(n));
  }
  
  /**
   * Получение запланированных уведомлений
   */
  getScheduled() {
    const stmt = db.prepare(`
      SELECT * FROM notifications 
      WHERE status = 'scheduled' AND scheduled_at <= datetime('now')
      ORDER BY scheduled_at ASC
    `);
    return stmt.all().map(n => this._formatNotification(n));
  }
  
  /**
   * Обработка клика по уведомлению
   */
  trackClick(notificationId, deviceId) {
    // Обновляем доставку
    const deliveryStmt = db.prepare(`
      UPDATE deliveries 
      SET status = 'clicked', clicked_at = CURRENT_TIMESTAMP 
      WHERE notification_id = ? AND device_id = ?
    `);
    deliveryStmt.run(notificationId, deviceId);
    
    // Обновляем счётчик в уведомлении
    const notifStmt = db.prepare(`
      UPDATE notifications 
      SET total_clicked = total_clicked + 1 
      WHERE id = ?
    `);
    notifStmt.run(notificationId);
    
    return true;
  }
  
  /**
   * Обработка доставки уведомления
   */
  trackDelivery(notificationId, deviceId) {
    // Обновляем доставку
    const deliveryStmt = db.prepare(`
      UPDATE deliveries 
      SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP 
      WHERE notification_id = ? AND device_id = ?
    `);
    deliveryStmt.run(notificationId, deviceId);
    
    // Обновляем счётчик в уведомлении
    const notifStmt = db.prepare(`
      UPDATE notifications 
      SET total_delivered = total_delivered + 1 
      WHERE id = ?
    `);
    notifStmt.run(notificationId);
    
    return true;
  }
  
  // Приватные методы
  
  async _sendWebPush(app, devices, payload) {
    // Инициализируем провайдер с ключами приложения
    webPushProvider.initialize(app.vapidPublicKey, app.vapidPrivateKey);
    
    const subscriptions = devices.map(d => ({
      id: d.id,
      endpoint: d.endpoint,
      p256dh: d.p256dh,
      auth: d.auth
    }));
    
    return webPushProvider.sendBatch(subscriptions, payload);
  }
  
  async _sendAPNS(devices, payload) {
    if (!apnsProvider.initialized) {
      console.warn('APNS не инициализирован, пропускаем iOS устройства');
      return { success: 0, failed: devices.length, expired: [], errors: [] };
    }
    
    return apnsProvider.sendBatch(devices, payload);
  }
  
  _sendAndroid(devices, payload) {
    if (!androidPushProvider.initialized) {
      console.warn('Android Push не инициализирован, пропускаем Android устройства');
      return { success: 0, failed: devices.length, expired: [], errors: [] };
    }
    
    return androidPushProvider.sendBatch(devices, payload);
  }
  
  _updateNotificationStatus(id, status, stats = {}) {
    const fields = ['status = ?', 'sent_at = CURRENT_TIMESTAMP'];
    const values = [status];
    
    if (stats.totalSent !== undefined) {
      fields.push('total_sent = ?');
      values.push(stats.totalSent);
    }
    if (stats.totalFailed !== undefined) {
      fields.push('total_failed = ?');
      values.push(stats.totalFailed);
    }
    if (stats.totalDelivered !== undefined) {
      fields.push('total_delivered = ?');
      values.push(stats.totalDelivered);
    }
    
    values.push(id);
    
    const stmt = db.prepare(`UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }
  
  _formatNotification(notification) {
    return {
      id: notification.id,
      appId: notification.app_id,
      title: notification.title,
      body: notification.body,
      icon: notification.icon,
      image: notification.image,
      url: notification.url,
      data: JSON.parse(notification.data || '{}'),
      segment: notification.segment,
      tags: JSON.parse(notification.tags || '[]'),
      scheduledAt: notification.scheduled_at,
      sentAt: notification.sent_at,
      stats: {
        totalSent: notification.total_sent,
        totalDelivered: notification.total_delivered,
        totalClicked: notification.total_clicked,
        totalFailed: notification.total_failed
      },
      status: notification.status,
      createdAt: notification.created_at
    };
  }
}

module.exports = new NotificationService();

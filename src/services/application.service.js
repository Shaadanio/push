const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { webPushProvider } = require('../providers');

class ApplicationService {
  /**
   * Создание нового приложения
   */
  create(data, ownerId = null) {
    const id = uuidv4();
    const apiKey = `pk_${this._generateRandomKey(32)}`;
    const apiSecret = `sk_${this._generateRandomKey(48)}`;
    
    // Генерируем VAPID ключи для каждого приложения
    const vapidKeys = webPushProvider.constructor.prototype.constructor.generateVapidKeys 
      ? require('web-push').generateVAPIDKeys()
      : { publicKey: null, privateKey: null };
    
    const stmt = db.prepare(`
      INSERT INTO applications 
      (id, name, api_key, api_secret, owner_id, vapid_public_key, vapid_private_key, 
       apns_enabled, android_enabled, web_push_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.name,
      apiKey,
      apiSecret,
      ownerId,
      vapidKeys.publicKey,
      vapidKeys.privateKey,
      data.apnsEnabled ? 1 : 0,
      data.androidEnabled !== false ? 1 : 0,
      data.webPushEnabled !== false ? 1 : 0
    );
    
    return this.getById(id);
  }
  
  /**
   * Получение приложения по ID
   */
  getById(id) {
    const stmt = db.prepare('SELECT * FROM applications WHERE id = ?');
    const app = stmt.get(id);
    return app ? this._formatApp(app) : null;
  }
  
  /**
   * Получение приложения по API ключу
   */
  getByApiKey(apiKey) {
    const stmt = db.prepare('SELECT * FROM applications WHERE api_key = ?');
    const app = stmt.get(apiKey);
    return app ? this._formatApp(app) : null;
  }
  
  /**
   * Получение всех приложений
   */
  getAll() {
    const stmt = db.prepare('SELECT * FROM applications ORDER BY created_at DESC');
    return stmt.all().map(app => this._formatApp(app));
  }
  
  /**
   * Обновление приложения
   */
  update(id, data) {
    const fields = [];
    const values = [];
    
    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.apnsEnabled !== undefined) {
      fields.push('apns_enabled = ?');
      values.push(data.apnsEnabled ? 1 : 0);
    }
    if (data.androidEnabled !== undefined) {
      fields.push('android_enabled = ?');
      values.push(data.androidEnabled ? 1 : 0);
    }
    if (data.webPushEnabled !== undefined) {
      fields.push('web_push_enabled = ?');
      values.push(data.webPushEnabled ? 1 : 0);
    }
    
    if (fields.length === 0) return this.getById(id);
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    const stmt = db.prepare(`UPDATE applications SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    
    return this.getById(id);
  }
  
  /**
   * Удаление приложения
   */
  delete(id) {
    const stmt = db.prepare('DELETE FROM applications WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
  
  /**
   * Ротация API ключей
   */
  rotateApiKeys(id) {
    const apiKey = `pk_${this._generateRandomKey(32)}`;
    const apiSecret = `sk_${this._generateRandomKey(48)}`;
    
    const stmt = db.prepare(`
      UPDATE applications 
      SET api_key = ?, api_secret = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    stmt.run(apiKey, apiSecret, id);
    
    return this.getById(id);
  }
  
  /**
   * Статистика по приложению
   */
  getStats(id) {
    const devicesStmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN platform = 'web' THEN 1 ELSE 0 END) as web,
        SUM(CASE WHEN platform = 'ios' THEN 1 ELSE 0 END) as ios,
        SUM(CASE WHEN platform = 'android' THEN 1 ELSE 0 END) as android,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
      FROM devices WHERE app_id = ?
    `);
    
    const notificationsStmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(total_sent) as total_sent,
        SUM(total_delivered) as total_delivered,
        SUM(total_clicked) as total_clicked,
        SUM(total_failed) as total_failed
      FROM notifications WHERE app_id = ?
    `);
    
    return {
      devices: devicesStmt.get(id),
      notifications: notificationsStmt.get(id)
    };
  }
  
  _formatApp(app) {
    return {
      id: app.id,
      name: app.name,
      apiKey: app.api_key,
      apiSecret: app.api_secret,
      ownerId: app.owner_id,
      vapidPublicKey: app.vapid_public_key,
      vapidPrivateKey: app.vapid_private_key,
      apnsEnabled: app.apns_enabled === 1,
      apnsKeyId: app.apns_key_id,
      apnsTeamId: app.apns_team_id,
      apnsBundleId: app.apns_bundle_id,
      apnsKeyFile: app.apns_key_file,
      androidEnabled: app.android_enabled === 1,
      webPushEnabled: app.web_push_enabled === 1,
      createdAt: app.created_at,
      updatedAt: app.updated_at
    };
  }
  
  _generateRandomKey(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

module.exports = new ApplicationService();

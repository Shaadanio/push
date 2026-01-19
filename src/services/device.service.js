const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');

class DeviceService {
  /**
   * Регистрация нового устройства/подписки
   */
  register(appId, data) {
    const id = uuidv4();
    
    // Проверяем, существует ли уже такое устройство
    const existing = this.getByToken(appId, data.token);
    if (existing) {
      return this.update(existing.id, data);
    }
    
    const stmt = db.prepare(`
      INSERT INTO devices 
      (id, app_id, platform, token, endpoint, p256dh, auth, user_id, tags, 
       language, timezone, device_model, os_version, app_version, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      id,
      appId,
      data.platform,
      data.token,
      data.endpoint || null,
      data.p256dh || null,
      data.auth || null,
      data.userId || null,
      JSON.stringify(data.tags || []),
      data.language || 'ru',
      data.timezone || null,
      data.deviceModel || null,
      data.osVersion || null,
      data.appVersion || null
    );
    
    return this.getById(id);
  }
  
  /**
   * Получение устройства по ID
   */
  getById(id) {
    const stmt = db.prepare('SELECT * FROM devices WHERE id = ?');
    const device = stmt.get(id);
    return device ? this._formatDevice(device) : null;
  }
  
  /**
   * Получение устройства по токену
   */
  getByToken(appId, token) {
    const stmt = db.prepare('SELECT * FROM devices WHERE app_id = ? AND token = ?');
    const device = stmt.get(appId, token);
    return device ? this._formatDevice(device) : null;
  }
  
  /**
   * Получение всех устройств приложения с фильтрацией
   */
  getAll(appId, filters = {}) {
    let query = 'SELECT * FROM devices WHERE app_id = ?';
    const params = [appId];
    
    if (filters.platform) {
      query += ' AND platform = ?';
      params.push(filters.platform);
    }
    
    if (filters.isActive !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.isActive ? 1 : 0);
    }
    
    if (filters.userId) {
      query += ' AND user_id = ?';
      params.push(filters.userId);
    }
    
    if (filters.tags && filters.tags.length > 0) {
      // Поиск устройств с определёнными тегами
      const tagConditions = filters.tags.map(() => "tags LIKE ?").join(' OR ');
      query += ` AND (${tagConditions})`;
      filters.tags.forEach(tag => params.push(`%"${tag}"%`));
    }
    
    query += ' ORDER BY last_active DESC';
    
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    
    if (filters.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }
    
    const stmt = db.prepare(query);
    return stmt.all(...params).map(d => this._formatDevice(d));
  }
  
  /**
   * Получение устройств для отправки уведомлений
   */
  getForNotification(appId, options = {}) {
    let query = 'SELECT * FROM devices WHERE app_id = ? AND is_active = 1';
    const params = [appId];
    
    if (options.platform) {
      query += ' AND platform = ?';
      params.push(options.platform);
    }
    
    if (options.userIds && options.userIds.length > 0) {
      const placeholders = options.userIds.map(() => '?').join(',');
      query += ` AND user_id IN (${placeholders})`;
      params.push(...options.userIds);
    }
    
    if (options.tags && options.tags.length > 0) {
      const tagConditions = options.tags.map(() => "tags LIKE ?").join(' OR ');
      query += ` AND (${tagConditions})`;
      options.tags.forEach(tag => params.push(`%"${tag}"%`));
    }
    
    if (options.excludeIds && options.excludeIds.length > 0) {
      const placeholders = options.excludeIds.map(() => '?').join(',');
      query += ` AND id NOT IN (${placeholders})`;
      params.push(...options.excludeIds);
    }
    
    const stmt = db.prepare(query);
    return stmt.all(...params).map(d => this._formatDevice(d));
  }
  
  /**
   * Обновление устройства
   */
  update(id, data) {
    const fields = [];
    const values = [];
    
    const updateableFields = {
      token: 'token',
      endpoint: 'endpoint',
      p256dh: 'p256dh',
      auth: 'auth',
      userId: 'user_id',
      language: 'language',
      timezone: 'timezone',
      deviceModel: 'device_model',
      osVersion: 'os_version',
      appVersion: 'app_version',
      isActive: 'is_active'
    };
    
    for (const [key, column] of Object.entries(updateableFields)) {
      if (data[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(key === 'isActive' ? (data[key] ? 1 : 0) : data[key]);
      }
    }
    
    if (data.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(data.tags));
    }
    
    if (fields.length === 0) return this.getById(id);
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    fields.push('last_active = CURRENT_TIMESTAMP');
    values.push(id);
    
    const stmt = db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    
    return this.getById(id);
  }
  
  /**
   * Добавление тегов к устройству
   */
  addTags(id, tags) {
    const device = this.getById(id);
    if (!device) return null;
    
    const existingTags = device.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];
    
    return this.update(id, { tags: newTags });
  }
  
  /**
   * Удаление тегов с устройства
   */
  removeTags(id, tags) {
    const device = this.getById(id);
    if (!device) return null;
    
    const existingTags = device.tags || [];
    const newTags = existingTags.filter(t => !tags.includes(t));
    
    return this.update(id, { tags: newTags });
  }
  
  /**
   * Привязка устройства к пользователю
   */
  setUserId(id, userId) {
    return this.update(id, { userId });
  }
  
  /**
   * Деактивация устройства (при невалидном токене)
   */
  deactivate(id) {
    return this.update(id, { isActive: false });
  }
  
  /**
   * Массовая деактивация устройств
   */
  deactivateBatch(ids) {
    if (ids.length === 0) return 0;
    
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE devices 
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE id IN (${placeholders})
    `);
    
    const result = stmt.run(...ids);
    return result.changes;
  }
  
  /**
   * Удаление устройства
   */
  delete(id) {
    const stmt = db.prepare('DELETE FROM devices WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
  
  /**
   * Удаление устройства по токену (для отписки)
   */
  deleteByToken(appId, token) {
    const stmt = db.prepare('DELETE FROM devices WHERE app_id = ? AND token = ?');
    const result = stmt.run(appId, token);
    return result.changes > 0;
  }
  
  /**
   * Количество устройств
   */
  count(appId, filters = {}) {
    let query = 'SELECT COUNT(*) as count FROM devices WHERE app_id = ?';
    const params = [appId];
    
    if (filters.platform) {
      query += ' AND platform = ?';
      params.push(filters.platform);
    }
    
    if (filters.isActive !== undefined) {
      query += ' AND is_active = ?';
      params.push(filters.isActive ? 1 : 0);
    }
    
    const stmt = db.prepare(query);
    return stmt.get(...params).count;
  }
  
  /**
   * Обновление времени последней активности
   */
  updateLastActive(id) {
    const stmt = db.prepare('UPDATE devices SET last_active = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(id);
  }
  
  _formatDevice(device) {
    return {
      id: device.id,
      appId: device.app_id,
      platform: device.platform,
      token: device.token,
      endpoint: device.endpoint,
      p256dh: device.p256dh,
      auth: device.auth,
      userId: device.user_id,
      tags: JSON.parse(device.tags || '[]'),
      language: device.language,
      timezone: device.timezone,
      deviceModel: device.device_model,
      osVersion: device.os_version,
      appVersion: device.app_version,
      isActive: device.is_active === 1,
      lastActive: device.last_active,
      createdAt: device.created_at,
      updatedAt: device.updated_at
    };
  }
}

module.exports = new DeviceService();

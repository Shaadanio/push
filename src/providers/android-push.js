const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class AndroidPushProvider {
  constructor() {
    this.wss = null;
    this.connections = new Map(); // deviceId -> WebSocket
    this.deviceTokens = new Map(); // token -> deviceId
    this.initialized = false;
    this.pendingMessages = new Map(); // deviceId -> Array of pending messages
  }
  
  /**
   * Инициализация WebSocket сервера для Android устройств
   * @param {Object} server - HTTP сервер Express
   */
  initialize(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws/android'
    });
    
    this.wss.on('connection', (ws, req) => {
      console.log('Android: Новое WebSocket подключение');
      
      let deviceId = null;
      let heartbeatInterval = null;
      
      // Heartbeat для поддержания соединения
      const startHeartbeat = () => {
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, 30000); // Пинг каждые 30 секунд
      };
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          switch (message.type) {
            case 'register':
              // Регистрация устройства
              deviceId = message.deviceId;
              const token = message.token;
              
              // Сохраняем соединение
              this.connections.set(deviceId, ws);
              this.deviceTokens.set(token, deviceId);
              
              ws.send(JSON.stringify({
                type: 'registered',
                deviceId: deviceId,
                timestamp: new Date().toISOString()
              }));
              
              console.log(`Android: Устройство зарегистрировано: ${deviceId}`);
              
              // Отправляем накопленные сообщения
              this._sendPendingMessages(deviceId, ws);
              
              startHeartbeat();
              break;
              
            case 'ack':
              // Подтверждение получения уведомления
              this._handleAck(message.notificationId, deviceId);
              break;
              
            case 'click':
              // Клик по уведомлению
              this._handleClick(message.notificationId, deviceId);
              break;
              
            case 'pong':
              // Ответ на heartbeat
              break;
          }
        } catch (error) {
          console.error('Android: Ошибка обработки сообщения:', error);
        }
      });
      
      ws.on('close', () => {
        console.log(`Android: Соединение закрыто: ${deviceId}`);
        if (deviceId) {
          this.connections.delete(deviceId);
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      });
      
      ws.on('error', (error) => {
        console.error(`Android: Ошибка WebSocket: ${error.message}`);
      });
      
      ws.on('pong', () => {
        // Устройство живо
      });
    });
    
    this.initialized = true;
    console.log('✓ Android Push (WebSocket) инициализирован');
    return true;
  }
  
  /**
   * Отправка уведомления на Android устройство
   * @param {string} deviceId - ID устройства
   * @param {Object} payload - Данные уведомления
   * @returns {Object} - Результат отправки
   */
  send(deviceId, payload) {
    const ws = this.connections.get(deviceId);
    
    const message = {
      type: 'notification',
      id: payload.notificationId || uuidv4(),
      title: payload.title,
      body: payload.body,
      icon: payload.icon,
      image: payload.image,
      url: payload.url,
      data: payload.data || {},
      priority: payload.priority || 'high',
      channelId: payload.channelId || 'default',
      timestamp: new Date().toISOString()
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        return {
          success: true,
          messageId: message.id,
          delivered: true
        };
      } catch (error) {
        return {
          success: false,
          error: 'SEND_ERROR',
          message: error.message,
          shouldRemove: false
        };
      }
    } else {
      // Устройство не подключено - сохраняем сообщение для доставки позже
      this._addPendingMessage(deviceId, message);
      
      return {
        success: true,
        messageId: message.id,
        delivered: false,
        queued: true,
        message: 'Устройство офлайн, сообщение в очереди'
      };
    }
  }
  
  /**
   * Массовая отправка уведомлений
   * @param {Array<Object>} devices - Массив устройств
   * @param {Object} payload - Данные уведомления
   * @returns {Object} - Статистика отправки
   */
  sendBatch(devices, payload) {
    const results = {
      total: devices.length,
      success: 0,
      failed: 0,
      queued: 0,
      expired: [],
      errors: []
    };
    
    for (const device of devices) {
      const result = this.send(device.id, payload);
      
      if (result.success) {
        if (result.delivered) {
          results.success++;
        } else if (result.queued) {
          results.queued++;
          results.success++; // Считаем успехом, т.к. доставим позже
        }
      } else {
        results.failed++;
        results.errors.push({
          deviceId: device.id,
          error: result.error,
          message: result.message
        });
      }
    }
    
    return results;
  }
  
  /**
   * Проверка онлайн статуса устройства
   */
  isOnline(deviceId) {
    const ws = this.connections.get(deviceId);
    return ws && ws.readyState === WebSocket.OPEN;
  }
  
  /**
   * Получение списка онлайн устройств
   */
  getOnlineDevices() {
    const online = [];
    for (const [deviceId, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        online.push(deviceId);
      }
    }
    return online;
  }
  
  /**
   * Получение статистики
   */
  getStats() {
    let online = 0;
    for (const ws of this.connections.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        online++;
      }
    }
    
    return {
      totalConnections: this.connections.size,
      onlineConnections: online,
      pendingMessages: this.pendingMessages.size
    };
  }
  
  /**
   * Добавление сообщения в очередь ожидания
   */
  _addPendingMessage(deviceId, message) {
    if (!this.pendingMessages.has(deviceId)) {
      this.pendingMessages.set(deviceId, []);
    }
    
    const pending = this.pendingMessages.get(deviceId);
    
    // Ограничиваем очередь 100 сообщениями
    if (pending.length >= 100) {
      pending.shift(); // Удаляем самое старое
    }
    
    // Добавляем TTL - 24 часа
    message.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    pending.push(message);
  }
  
  /**
   * Отправка накопленных сообщений
   */
  _sendPendingMessages(deviceId, ws) {
    const pending = this.pendingMessages.get(deviceId);
    if (!pending || pending.length === 0) return;
    
    const now = Date.now();
    const validMessages = pending.filter(m => m.expiresAt > now);
    
    for (const message of validMessages) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Android: Ошибка отправки отложенного сообщения:', error);
      }
    }
    
    // Очищаем очередь
    this.pendingMessages.delete(deviceId);
    
    if (validMessages.length > 0) {
      console.log(`Android: Отправлено ${validMessages.length} отложенных сообщений на ${deviceId}`);
    }
  }
  
  /**
   * Обработка подтверждения получения
   */
  _handleAck(notificationId, deviceId) {
    // Можно добавить логику обновления статуса доставки в БД
    console.log(`Android: Уведомление ${notificationId} доставлено на ${deviceId}`);
  }
  
  /**
   * Обработка клика
   */
  _handleClick(notificationId, deviceId) {
    // Можно добавить логику обновления статистики кликов в БД
    console.log(`Android: Клик по уведомлению ${notificationId} с ${deviceId}`);
  }
  
  /**
   * Очистка устаревших сообщений в очереди
   */
  cleanupPendingMessages() {
    const now = Date.now();
    
    for (const [deviceId, messages] of this.pendingMessages) {
      const valid = messages.filter(m => m.expiresAt > now);
      if (valid.length === 0) {
        this.pendingMessages.delete(deviceId);
      } else {
        this.pendingMessages.set(deviceId, valid);
      }
    }
  }
}

module.exports = new AndroidPushProvider();

/**
 * Push Notification SDK для веб-сайтов
 * Клиентская библиотека для регистрации и управления push-уведомлениями
 */

(function(window) {
  'use strict';

  const PushSDK = {
    // Конфигурация
    config: {
      apiUrl: '',
      apiKey: '',
      vapidPublicKey: '',
      serviceWorkerPath: '/push-sw.js',
      debug: false
    },

    // Состояние
    state: {
      initialized: false,
      deviceId: null,
      subscription: null
    },

    /**
     * Инициализация SDK
     * @param {Object} options - Параметры инициализации
     */
    init: function(options) {
      if (this.state.initialized) {
        this._log('SDK уже инициализирован');
        return Promise.resolve(this.state.deviceId);
      }

      // Проверка обязательных параметров
      if (!options.apiKey) {
        throw new Error('PushSDK: apiKey обязателен');
      }
      if (!options.vapidPublicKey) {
        throw new Error('PushSDK: vapidPublicKey обязателен');
      }
      if (!options.userId) {
        throw new Error('PushSDK: userId обязателен — передайте ID пользователя вашей системы');
      }

      // Установка конфигурации
      this.config.apiUrl = options.apiUrl || window.location.origin;
      this.config.apiKey = options.apiKey;
      this.config.vapidPublicKey = options.vapidPublicKey;
      this.config.serviceWorkerPath = options.serviceWorkerPath || '/push-sw.js';
      this.config.debug = options.debug || false;
      this.config.autoSubscribe = options.autoSubscribe !== false; // по умолчанию true
      this.config.userId = String(options.userId);
      this.config.tags = options.tags || [];

      // Загружаем сохранённый deviceId
      this.state.deviceId = localStorage.getItem('pushsdk_device_id');

      this.state.initialized = true;
      this._log('SDK инициализирован');

      // Проверяем отзыв разрешения
      this._checkPermissionRevoked();

      // Автоподписка
      if (this.config.autoSubscribe) {
        this._autoSubscribe();
      }

      return Promise.resolve(this.state.deviceId);
    },

    /**
     * Проверка отзыва разрешения — удаляем устройство с сервера
     */
    _checkPermissionRevoked: async function() {
      if (!this.state.deviceId) return;
      
      var permission = this.getPermissionStatus();
      
      if (permission === 'denied') {
        this._log('⚠️ Разрешение отозвано, удаляем устройство с сервера...');
        try {
          await this._deleteDeviceFromServer();
          localStorage.removeItem('pushsdk_device_id');
          this.state.deviceId = null;
          this._log('✅ Устройство удалено');
        } catch (e) {
          this._log('❌ Ошибка удаления устройства:', e.message);
        }
      }
    },

    /**
     * Удаление устройства с сервера
     */
    _deleteDeviceFromServer: async function() {
      if (!this.state.deviceId) return;
      
      await fetch(`${this.config.apiUrl}/api/v1/devices/${this.state.deviceId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        }
      });
    },

    /**
     * Автоматическая подписка (вызывается из init)
     */
    _autoSubscribe: async function() {
      this._log('🔄 Автоподписка: начало');
      
      try {
        if (!this.isSupported()) {
          this._log('❌ Push не поддерживается');
          return;
        }
        this._log('✓ Push поддерживается');

        var permission = this.getPermissionStatus();
        this._log('📋 Текущий статус:', permission);
        
        // Если уже отклонил — не спрашиваем
        if (permission === 'denied') {
          this._log('⛔ Уведомления заблокированы пользователем');
          return;
        }

        // Если уже подписан — ничего не делаем
        if (permission === 'granted') {
          this._log('✓ Разрешение уже получено, проверяем подписку...');
          var isSubscribed = await this.isSubscribed();
          if (isSubscribed && this.state.deviceId) {
            this._log('✅ Уже подписан, deviceId:', this.state.deviceId);
            return;
          }
          this._log('⚠️ Разрешение есть, но подписки нет — создаём');
        }

        // Подписываемся
        this._log('🚀 Запуск подписки...');
        var result = await this.subscribe({
          userId: this.config.userId,
          tags: this.config.tags
        });
        this._log('✅ Автоподписка успешна! deviceId:', result.deviceId);
      } catch (error) {
        this._log('❌ Автоподписка отклонена:', error.message);
      }
    },

    /**
     * Проверка поддержки push-уведомлений
     */
    isSupported: function() {
      return 'serviceWorker' in navigator && 
             'PushManager' in window && 
             'Notification' in window;
    },

    /**
     * Проверка текущего разрешения
     */
    getPermissionStatus: function() {
      if (!this.isSupported()) {
        return 'unsupported';
      }
      return Notification.permission;
    },

    /**
     * Проверка подписки
     */
    isSubscribed: async function() {
      if (!this.isSupported()) return false;
      
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return !!subscription;
    },

    /**
     * Запрос разрешения и подписка на уведомления
     */
    subscribe: async function(options = {}) {
      if (!this._checkInitialized()) return null;

      if (!this.isSupported()) {
        throw new Error('Push-уведомления не поддерживаются в этом браузере');
      }

      // Запрос разрешения
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this._log('Пользователь отклонил уведомления');
        throw new Error('Пользователь отклонил уведомления');
      }

      // Регистрация Service Worker
      const registration = await navigator.serviceWorker.register(this.config.serviceWorkerPath);
      await navigator.serviceWorker.ready;
      this._log('Service Worker зарегистрирован');

      // Подписка на push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(this.config.vapidPublicKey)
      });
      this._log('Подписка получена');

      // Отправка подписки на сервер
      const subscriptionData = subscription.toJSON();
      
      const response = await fetch(`${this.config.apiUrl}/api/v1/devices/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({
          platform: 'web',
          token: subscriptionData.endpoint,
          endpoint: subscriptionData.endpoint,
          p256dh: subscriptionData.keys.p256dh,
          auth: subscriptionData.keys.auth,
          userId: options.userId,
          tags: options.tags,
          language: navigator.language
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        this._log('❌ Ошибка сервера:', response.status, errorData);
        throw new Error(errorData.message || 'Ошибка регистрации устройства');
      }

      const result = await response.json();
      this.state.deviceId = result.data.deviceId;
      this.state.subscription = subscription;
      
      localStorage.setItem('pushsdk_device_id', this.state.deviceId);
      localStorage.setItem('pushsdk_api_url', this.config.apiUrl);
      localStorage.setItem('pushsdk_api_key', this.config.apiKey);
      this._log('Устройство зарегистрировано:', this.state.deviceId);

      // Передаём конфиг в Service Worker
      this._sendConfigToSW();

      return {
        deviceId: this.state.deviceId,
        subscription: subscriptionData
      };
    },

    /**
     * Передача конфига в Service Worker
     */
    _sendConfigToSW: async function() {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          registration.active.postMessage({
            type: 'CONFIG',
            apiUrl: this.config.apiUrl,
            apiKey: this.config.apiKey,
            deviceId: this.state.deviceId
          });
          this._log('Конфиг передан в Service Worker');
        }
      } catch (e) {
        this._log('Не удалось передать конфиг в SW:', e);
      }
    },

    /**
     * Отписка от уведомлений
     */
    unsubscribe: async function() {
      if (!this._checkInitialized()) return false;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        // Отписываемся на клиенте
        await subscription.unsubscribe();
        
        // Удаляем с сервера
        await fetch(`${this.config.apiUrl}/api/v1/devices/unregister`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.config.apiKey
          },
          body: JSON.stringify({
            token: subscription.endpoint
          })
        });
        
        this.state.subscription = null;
        localStorage.removeItem('pushsdk_device_id');
        this._log('Отписка выполнена');
        
        return true;
      }
      
      return false;
    },

    /**
     * Установка тегов для устройства
     */
    setTags: async function(tags) {
      if (!this._checkInitialized() || !this.state.deviceId) return false;

      const response = await fetch(`${this.config.apiUrl}/api/v1/devices/${this.state.deviceId}/tags`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({ tags })
      });

      if (!response.ok) {
        throw new Error('Ошибка установки тегов');
      }

      const result = await response.json();
      this._log('Теги установлены:', result.data.tags);
      
      return result.data.tags;
    },

    /**
     * Удаление тегов
     */
    removeTags: async function(tags) {
      if (!this._checkInitialized() || !this.state.deviceId) return false;

      const response = await fetch(`${this.config.apiUrl}/api/v1/devices/${this.state.deviceId}/tags`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({ tags })
      });

      if (!response.ok) {
        throw new Error('Ошибка удаления тегов');
      }

      const result = await response.json();
      return result.data.tags;
    },

    /**
     * Привязка пользователя
     */
    setUserId: async function(userId) {
      if (!this._checkInitialized() || !this.state.deviceId) return false;

      const response = await fetch(`${this.config.apiUrl}/api/v1/devices/${this.state.deviceId}/user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey
        },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        throw new Error('Ошибка установки пользователя');
      }

      this._log('Пользователь привязан:', userId);
      return true;
    },

    /**
     * Получение ID устройства
     */
    getDeviceId: function() {
      return this.state.deviceId;
    },

    /**
     * Трекинг клика по уведомлению
     */
    trackClick: async function(notificationId) {
      if (!this._checkInitialized()) return false;

      await fetch(`${this.config.apiUrl}/api/v1/notifications/${notificationId}/click`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          deviceId: this.state.deviceId
        })
      });

      return true;
    },

    // Вспомогательные методы

    _checkInitialized: function() {
      if (!this.state.initialized) {
        console.error('PushSDK: SDK не инициализирован. Вызовите PushSDK.init() сначала.');
        return false;
      }
      return true;
    },

    _log: function(...args) {
      if (this.config.debug) {
        console.log('[PushSDK]', ...args);
      }
    },

    _urlBase64ToUint8Array: function(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);

      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    },

    _version: '1.0.0'
  };

  // Красивый вывод в консоль при загрузке
  console.log(
    '%c Push360 %c v' + PushSDK._version + ' %c https://push360.ru ',
    'background: #6366f1; color: #fff; padding: 4px 8px; border-radius: 4px 0 0 4px; font-weight: bold;',
    'background: #4f46e5; color: #fff; padding: 4px 8px;',
    'background: #1e1e1e; color: #a5a5a5; padding: 4px 8px; border-radius: 0 4px 4px 0;'
  );

  // Экспорт
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PushSDK;
  } else {
    window.PushSDK = PushSDK;
  }

})(typeof window !== 'undefined' ? window : this);

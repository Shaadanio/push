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

      // Установка конфигурации
      this.config.apiUrl = options.apiUrl || window.location.origin;
      this.config.apiKey = options.apiKey;
      this.config.vapidPublicKey = options.vapidPublicKey;
      this.config.serviceWorkerPath = options.serviceWorkerPath || '/push-sw.js';
      this.config.debug = options.debug || false;

      // Загружаем сохранённый deviceId
      this.state.deviceId = localStorage.getItem('pushsdk_device_id');

      this.state.initialized = true;
      this._log('SDK инициализирован');

      return Promise.resolve(this.state.deviceId);
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
        throw new Error('Ошибка регистрации устройства');
      }

      const result = await response.json();
      this.state.deviceId = result.data.deviceId;
      this.state.subscription = subscription;
      
      localStorage.setItem('pushsdk_device_id', this.state.deviceId);
      this._log('Устройство зарегистрировано:', this.state.deviceId);

      return {
        deviceId: this.state.deviceId,
        subscription: subscriptionData
      };
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
    }
  };

  // Экспорт
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PushSDK;
  } else {
    window.PushSDK = PushSDK;
  }

})(typeof window !== 'undefined' ? window : this);

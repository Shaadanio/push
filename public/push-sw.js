/**
 * Push Notifications Service Worker
 * Обработка push-уведомлений в браузере
 */

// Версия service worker
const SW_VERSION = '1.0.0';

// Обработка push-уведомлений
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push получен');
  
  let data = {
    title: 'Уведомление',
    body: 'Новое сообщение',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: 'default',
    requireInteraction: false,
    silent: false,
    data: {}
  };
  
  try {
    if (event.data) {
      const payload = event.data.json();
      data = {
        ...data,
        ...payload,
        data: {
          ...data.data,
          ...payload.data,
          url: payload.url || payload.data?.url
        }
      };
    }
  } catch (e) {
    console.error('[Service Worker] Ошибка парсинга payload:', e);
    if (event.data) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    requireInteraction: data.requireInteraction,
    silent: data.silent,
    data: data.data,
    vibrate: [200, 100, 200],
    actions: data.actions || []
  };
  
  // Добавляем изображение если есть
  if (data.image) {
    options.image = data.image;
  }
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Клик по уведомлению:', event.notification.tag);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  const url = data.url || '/';
  
  // Обработка действий (кнопок)
  if (event.action) {
    console.log('[Service Worker] Действие:', event.action);
    
    // Отправляем событие на сервер
    if (data.notificationId) {
      fetch('/api/notifications/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          notificationId: data.notificationId,
          action: event.action,
          deviceId: data.deviceId
        })
      }).catch(err => console.error('[Service Worker] Ошибка отправки действия:', err));
    }
  }
  
  // Открываем или фокусируем окно
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Ищем уже открытое окно
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // Открываем новое окно
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
  
  // Отправляем событие клика на сервер
  if (data.notificationId) {
    fetch('/api/notifications/clicked', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notificationId: data.notificationId,
        deviceId: data.deviceId
      })
    }).catch(err => console.error('[Service Worker] Ошибка отправки клика:', err));
  }
});

// Обработка закрытия уведомления
self.addEventListener('notificationclose', (event) => {
  console.log('[Service Worker] Уведомление закрыто:', event.notification.tag);
  
  const data = event.notification.data || {};
  
  // Отправляем событие на сервер
  if (data.notificationId) {
    fetch('/api/notifications/dismissed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notificationId: data.notificationId,
        deviceId: data.deviceId
      })
    }).catch(err => console.error('[Service Worker] Ошибка отправки dismiss:', err));
  }
});

// Обработка изменения подписки
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[Service Worker] Подписка изменена');
  
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: self.vapidPublicKey
    })
    .then((subscription) => {
      // Отправляем новую подписку на сервер
      return fetch('/api/devices/update-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscription: subscription.toJSON()
        })
      });
    })
    .catch(err => console.error('[Service Worker] Ошибка обновления подписки:', err))
  );
});

// Обработка установки service worker
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Установка версии:', SW_VERSION);
  self.skipWaiting();
});

// Обработка активации
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Активация версии:', SW_VERSION);
  event.waitUntil(clients.claim());
});

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Сообщение:', event.data);
  
  if (event.data.type === 'SET_VAPID_KEY') {
    self.vapidPublicKey = event.data.key;
  }
  
  if (event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});

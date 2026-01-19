/**
 * Service Worker для Push-уведомлений
 */

// Версия для управления кэшем
const SW_VERSION = '1.0.0';

// Обработка установки
self.addEventListener('install', (event) => {
  console.log('[Push SW] Установка, версия:', SW_VERSION);
  self.skipWaiting();
});

// Обработка активации
self.addEventListener('activate', (event) => {
  console.log('[Push SW] Активация');
  event.waitUntil(clients.claim());
});

// Обработка push-уведомлений
self.addEventListener('push', (event) => {
  console.log('[Push SW] Push получен');
  
  let data = {
    title: 'Новое уведомление',
    body: '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    image: null,
    tag: 'default',
    requireInteraction: false,
    renotify: false,
    silent: false,
    vibrate: [200, 100, 200],
    data: {}
  };
  
  // Парсим данные уведомления
  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  // Опции уведомления
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    image: data.image,
    tag: data.tag,
    requireInteraction: data.requireInteraction,
    renotify: data.renotify,
    silent: data.silent,
    vibrate: data.vibrate,
    data: data.data,
    actions: data.actions || []
  };
  
  // Показываем уведомление
  event.waitUntil(
    self.registration.showNotification(data.title, options)
      .then(() => {
        // Отправляем событие доставки
        if (data.data && data.data.notificationId) {
          return trackDelivery(data.data.notificationId);
        }
      })
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
  console.log('[Push SW] Клик по уведомлению');
  
  const notification = event.notification;
  const data = notification.data || {};
  const action = event.action;
  
  notification.close();
  
  // Определяем URL для открытия
  let url = data.url || '/';
  
  // Если есть action, проверяем его URL
  if (action && data.actions) {
    const actionData = data.actions.find(a => a.action === action);
    if (actionData && actionData.url) {
      url = actionData.url;
    }
  }
  
  // Отправляем событие клика
  if (data.notificationId) {
    trackClick(data.notificationId);
  }
  
  // Открываем URL
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Ищем уже открытое окно
        for (const client of windowClients) {
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
});

// Обработка закрытия уведомления
self.addEventListener('notificationclose', (event) => {
  console.log('[Push SW] Уведомление закрыто');
});

// Отправка события клика на сервер
async function trackClick(notificationId) {
  try {
    const deviceId = await getDeviceId();
    await fetch(`/api/v1/notifications/${notificationId}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
  } catch (e) {
    console.error('[Push SW] Ошибка отправки клика:', e);
  }
}

// Отправка события доставки на сервер
async function trackDelivery(notificationId) {
  try {
    const deviceId = await getDeviceId();
    await fetch(`/api/v1/notifications/${notificationId}/delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
  } catch (e) {
    console.error('[Push SW] Ошибка отправки доставки:', e);
  }
}

// Получение deviceId из localStorage через клиент
async function getDeviceId() {
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    // Отправляем запрос клиенту для получения deviceId
    client.postMessage({ type: 'GET_DEVICE_ID' });
  }
  return null;
}

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'DEVICE_ID') {
    // Сохраняем deviceId (можно использовать IndexedDB)
    console.log('[Push SW] Получен deviceId:', event.data.deviceId);
  }
});

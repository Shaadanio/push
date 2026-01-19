/**
 * Service Worker для Push-уведомлений
 * Push360 - https://push360.ru
 */

// Версия для управления кэшем
const SW_VERSION = '1.1.0';

// Конфигурация (получаем от SDK или из IndexedDB)
let config = {
  apiUrl: null,
  apiKey: null,
  deviceId: null
};

// Обработка установки
self.addEventListener('install', (event) => {
  console.log('[Push SW] Установка, версия:', SW_VERSION);
  self.skipWaiting();
});

// Обработка активации
self.addEventListener('activate', (event) => {
  console.log('[Push SW] Активация');
  event.waitUntil(
    Promise.all([
      clients.claim(),
      loadConfigFromIDB()
    ])
  );
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
      console.log('[Push SW] Payload получен:', JSON.stringify(payload));
      data = { ...data, ...payload };
    } catch (e) {
      console.log('[Push SW] Ошибка парсинга payload:', e);
      data.body = event.data.text();
    }
  }
  
  console.log('[Push SW] data.data:', JSON.stringify(data.data));
  console.log('[Push SW] notificationId:', data.data?.notificationId);
  console.log('[Push SW] apiUrl:', data.data?.apiUrl);
  
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
          console.log('[Push SW] Отправляем доставку для:', data.data.notificationId, 'на', data.data.apiUrl);
          return trackDelivery(data.data.notificationId, data.data.apiUrl);
        } else {
          console.log('[Push SW] notificationId не найден в payload, статистика не будет отправлена');
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
    trackClick(data.notificationId, data.apiUrl);
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
async function trackClick(notificationId, apiUrlFromPayload) {
  try {
    const cfg = await getConfig();
    const apiUrl = apiUrlFromPayload || cfg.apiUrl;
    
    if (!apiUrl) {
      console.warn('[Push SW] apiUrl не настроен, клик не отправлен');
      return;
    }
    
    await fetch(`${apiUrl}/api/v1/notifications/${notificationId}/click`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': cfg.apiKey || ''
      },
      body: JSON.stringify({ deviceId: cfg.deviceId })
    });
    console.log('[Push SW] Клик отправлен');
  } catch (e) {
    console.error('[Push SW] Ошибка отправки клика:', e);
  }
}

// Отправка события доставки на сервер
async function trackDelivery(notificationId, apiUrlFromPayload) {
  console.log('[Push SW] trackDelivery вызван:', { notificationId, apiUrlFromPayload });
  try {
    const cfg = await getConfig();
    console.log('[Push SW] config из IndexedDB:', JSON.stringify(cfg));
    const apiUrl = apiUrlFromPayload || cfg.apiUrl;
    
    if (!apiUrl) {
      console.warn('[Push SW] apiUrl не настроен, доставка не отправлена');
      return;
    }
    
    const url = `${apiUrl}/api/v1/notifications/${notificationId}/delivered`;
    console.log('[Push SW] Отправляем POST на:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Key': cfg.apiKey || ''
      },
      body: JSON.stringify({ deviceId: cfg.deviceId })
    });
    
    const result = await response.json();
    console.log('[Push SW] Доставка отправлена, ответ:', JSON.stringify(result));
  } catch (e) {
    console.error('[Push SW] Ошибка отправки доставки:', e);
  }
}

// Получение конфигурации
async function getConfig() {
  // Сначала пробуем IndexedDB
  const idbConfig = await loadConfigFromIDB();
  if (idbConfig && idbConfig.apiUrl) {
    return idbConfig;
  }
  // Fallback на memory config
  return config;
}

// Обработка сообщений от SDK
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CONFIG') {
    config = {
      apiUrl: event.data.apiUrl,
      apiKey: event.data.apiKey,
      deviceId: event.data.deviceId
    };
    // Сохраняем в IndexedDB для персистентности
    saveConfigToIDB(config);
    console.log('[Push SW] Конфиг получен:', config.apiUrl);
  }
});

// IndexedDB для хранения конфига
const DB_NAME = 'PushSDK';
const STORE_NAME = 'config';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function saveConfigToIDB(cfg) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(cfg, 'config');
    await tx.complete;
  } catch (e) {
    console.warn('[Push SW] Не удалось сохранить конфиг в IDB:', e);
  }
}

async function loadConfigFromIDB() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve) => {
      const request = store.get('config');
      request.onsuccess = () => resolve(request.result || {});
      request.onerror = () => resolve({});
    });
  } catch (e) {
    return {};
  }
}

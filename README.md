# Push Notification Service

Собственный сервис push-уведомлений для веб-сайтов, iOS и Android приложений. Полностью независимый от сторонних провайдеров (OneSignal, Firebase Push и т.д.).

## Возможности

- 🌐 **Web Push** - уведомления в браузерах через Web Push API (VAPID)
- 📱 **iOS** - прямая интеграция с Apple Push Notification Service (APNS)
- 🤖 **Android** - собственная реализация через WebSocket (без Google/Firebase!)
- 👥 **Сегментация** - теги, пользователи, платформы
- 📊 **Статистика** - отслеживание доставки и кликов
- ⏰ **Планирование** - отложенная отправка уведомлений
- 🔐 **Безопасность** - API ключи, rate limiting, JWT аутентификация
- 💻 **Админ-панель** - веб-интерфейс для управления

## Быстрый старт

### 1. Установка

```bash
cd notif
npm install
```

### 2. Генерация VAPID ключей для Web Push

```bash
npm run generate-vapid
```

### 3. Настройка

Скопируйте `.env.example` в `.env` и настройте переменные:

```bash
cp .env.example .env
```

Обязательные переменные:
- `VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY` - генерируются автоматически
- `API_SECRET_KEY` - секретный ключ для API (измените в production!)
- `JWT_SECRET` - секрет для JWT токенов

Для iOS (опционально):
- `APNS_KEY_ID` - ID ключа из Apple Developer
- `APNS_TEAM_ID` - Team ID из Apple Developer
- `APNS_BUNDLE_ID` - Bundle ID вашего приложения
- Поместите `.p8` ключ в `certs/apns-key.p8`

Для Android:
- Никакой дополнительной настройки на сервере не требуется
- Android использует WebSocket соединение (без Google/Firebase)

### 4. Запуск

```bash
# Разработка
npm run dev

# Production
npm start
```

Сервер запустится на http://localhost:3000

### 5. Первоначальная настройка

1. Откройте http://localhost:3000/admin
2. Создайте первого администратора (доступно только при первом запуске)
3. Создайте приложение и получите API ключи

## Интеграция

### Web Push (Браузеры)

```html
<script src="https://your-server.com/sdk/push-sdk.js"></script>
<script>
  // Инициализация
  PushSDK.init({
    apiKey: 'pk_YOUR_API_KEY',
    vapidPublicKey: 'YOUR_VAPID_PUBLIC_KEY',
    debug: true
  });

  // Проверка поддержки
  if (PushSDK.isSupported()) {
    // Подписка
    document.getElementById('subscribeBtn').onclick = async () => {
      try {
        const result = await PushSDK.subscribe({
          userId: 'user123',  // опционально
          tags: ['premium', 'news']  // опционально
        });
        console.log('Подписка успешна:', result.deviceId);
      } catch (error) {
        console.error('Ошибка:', error);
      }
    };
  }
</script>
```

### iOS (Swift)

```swift
import UserNotifications

class AppDelegate: UIResponder, UIApplicationDelegate {
    
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
        return true
    }
    
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        registerDevice(token: token)
    }
    
    private func registerDevice(token: String) {
        guard let url = URL(string: "https://your-server.com/api/v1/devices/register") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("pk_YOUR_API_KEY", forHTTPHeaderField: "X-API-Key")
        
        let body: [String: Any] = [
            "platform": "ios",
            "token": token,
            "userId": "user123",
            "tags": ["premium"]
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request).resume()
    }
}
```

### Android (Java/Kotlin)

Android использует собственное WebSocket соединение вместо Google/Firebase.
Скопируйте SDK из `public/sdk/android/` в ваш проект.

```kotlin
// Application.kt
import com.yourcompany.pushsdk.PushSDK

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        
        // Инициализация SDK
        PushSDK.init(
            this,
            "wss://your-server.com/ws/android",  // WebSocket URL
            "pk_YOUR_API_KEY"                     // API ключ
        )
        
        // Опционально: установить ID пользователя
        PushSDK.getInstance().setUserId("user123")
        
        // Опционально: добавить теги
        PushSDK.getInstance().addTag("premium")
        
        // Подключение
        PushSDK.getInstance().connect()
    }
}
```

**AndroidManifest.xml:**
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />

<application ...>
    <receiver android:name=".NotificationClickReceiver" />
</application>
```

**Преимущества WebSocket подхода:**
- Не зависит от Google Play Services
- Работает на всех Android устройствах (включая Huawei, Xiaomi без GMS)
- Полный контроль над доставкой
- Очередь сообщений для оффлайн устройств (TTL 24 часа)
- Автоматическое переподключение
```

## API

### Регистрация устройства

```http
POST /api/v1/devices/register
X-API-Key: pk_YOUR_API_KEY
Content-Type: application/json

{
  "platform": "web|ios|android",
  "token": "device_token",
  "endpoint": "https://...",  // только для web
  "p256dh": "...",            // только для web
  "auth": "...",              // только для web
  "userId": "user123",
  "tags": ["tag1", "tag2"],
  "language": "ru"
}
```

### Отправка уведомления

```http
POST /api/v1/notifications/send
X-API-Key: pk_YOUR_API_KEY
X-API-Secret: sk_YOUR_API_SECRET
Content-Type: application/json

{
  "title": "Заголовок",
  "body": "Текст уведомления",
  "url": "https://example.com/page",
  "icon": "https://example.com/icon.png",
  "image": "https://example.com/image.jpg",
  "platform": "web",           // опционально, фильтр по платформе
  "tags": ["tag1"],            // опционально, фильтр по тегам
  "userIds": ["user123"],      // опционально, конкретные пользователи
  "data": {                    // опционально, кастомные данные
    "key": "value"
  }
}
```

### Отправка конкретному устройству

```http
POST /api/v1/notifications/send-to-device/:deviceId
```

### Отправка пользователю

```http
POST /api/v1/notifications/send-to-user/:userId
```

### Планирование уведомления

```http
POST /api/v1/notifications/schedule
{
  "title": "...",
  "body": "...",
  "scheduledAt": "2025-01-20T10:00:00Z"
}
```

## Структура проекта

```
notif/
├── src/
│   ├── config/          # Конфигурация
│   ├── database/        # SQLite база данных
│   ├── middleware/      # Express middleware
│   ├── providers/       # Провайдеры (Web Push, APNS, WebSocket)
│   ├── routes/          # API маршруты
│   ├── services/        # Бизнес-логика
│   ├── scheduler/       # Планировщик задач
│   и └── server.js        # Точка входа
├── public/
│   ├── admin/           # Админ-панель
│   ├── sdk/             # Клиентский SDK (Web, Android)
│   └── push-sw.js       # Service Worker для Web Push
├── certs/               # Сертификаты (APNS)
├── data/                # База данных SQLite
├── scripts/             # Вспомогательные скрипты
└── package.json
```

## Production

### Рекомендации

1. Используйте HTTPS
2. Измените `API_SECRET_KEY` и `JWT_SECRET`
3. Настройте reverse proxy (nginx)
4. Используйте PM2 или systemd для управления процессом
5. Настройте бэкапы базы данных

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name push.yoursite.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Лицензия

MIT

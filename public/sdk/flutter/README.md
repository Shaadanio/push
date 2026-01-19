# Push360 SDK для Flutter

Независимый сервис push-уведомлений без Firebase.

## Установка

### Способ 1: Локальный пакет

Скопируйте папку `push360_sdk` в ваш проект и добавьте в `pubspec.yaml`:

```yaml
dependencies:
  push360_sdk:
    path: ./push360_sdk
```

### Способ 2: Git

```yaml
dependencies:
  push360_sdk:
    git:
      url: https://github.com/Shaadanio/push.git
      path: public/sdk/flutter
```

## Настройка Android

### 1. Добавьте разрешения в `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```

### 2. Для фонового режима добавьте в `<application>`:

```xml
<service
    android:name="com.dexterous.flutterlocalnotifications.ForegroundService"
    android:exported="false"
    android:stopWithTask="false"/>
```

## Настройка iOS

### 1. Добавьте в `ios/Runner/Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
    <string>remote-notification</string>
</array>
```

### 2. Включите Push Notifications в Xcode:
- Откройте `ios/Runner.xcworkspace` в Xcode
- Runner → Signing & Capabilities → + Capability → Push Notifications

### 3. Для iOS нужен APNs сертификат:
- Создайте сертификат в Apple Developer Console
- Загрузите .p8 файл в админку Push360

## Использование

```dart
import 'package:push360_sdk/push360_sdk.dart';

class MyApp extends StatefulWidget {
  @override
  _MyAppState createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late Push360SDK push;

  @override
  void initState() {
    super.initState();
    _initPush();
  }

  Future<void> _initPush() async {
    // Создаём экземпляр SDK
    push = Push360SDK(
      apiUrl: 'https://push360.ru',
      apiKey: 'pk_ваш_публичный_ключ',
      debug: true, // Включить логи (убрать в продакшене)
    );

    // Инициализация
    await push.init();

    // Запрос разрешения на уведомления
    final granted = await push.requestPermission();
    if (!granted) {
      print('Пользователь отклонил уведомления');
      return;
    }

    // Регистрация устройства
    await push.register(
      userId: 'user_123',  // опционально
      tags: ['news', 'promo'],  // опционально
    );

    // Обработка входящих уведомлений
    push.onNotificationReceived = (notification) {
      print('Получено: ${notification.title}');
    };

    // Обработка клика по уведомлению
    push.onNotificationClick = (notification, action) {
      print('Клик: ${notification.title}');
      if (notification.url != null) {
        // Перейти по ссылке
        Navigator.pushNamed(context, notification.url!);
      }
    };
  }

  @override
  void dispose() {
    push.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: Text('Push360 Demo')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Device ID: ${push.deviceId ?? "не зарегистрирован"}'),
              SizedBox(height: 20),
              ElevatedButton(
                onPressed: () => push.setUserId('new_user_456'),
                child: Text('Изменить userId'),
              ),
              ElevatedButton(
                onPressed: () => push.addTag('vip'),
                child: Text('Добавить тег VIP'),
              ),
              ElevatedButton(
                onPressed: () => push.unregister(),
                child: Text('Отписаться'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

## API

### `Push360SDK(apiUrl, apiKey, debug)`
Конструктор SDK.

### `init()`
Инициализация SDK. Вызывать первым.

### `requestPermission()`
Запрос разрешения на уведомления. Возвращает `bool`.

### `register({userId, tags, apnsToken})`
Регистрация устройства. Возвращает `deviceId`.

### `setUserId(userId)`
Привязка пользователя к устройству.

### `setTags(tags)` / `addTag(tag)` / `removeTag(tag)`
Управление тегами для сегментации.

### `unregister()`
Отписка от уведомлений.

### `dispose()`
Освобождение ресурсов.

## Callbacks

### `onNotificationReceived`
Вызывается при получении уведомления.

### `onNotificationClick`
Вызывается при нажатии на уведомление.

## Свойства (read-only)

- `deviceId` — ID устройства
- `userId` — ID пользователя
- `tags` — список тегов
- `isConnected` — статус WebSocket соединения
- `isRegistered` — зарегистрировано ли устройство

## Отправка уведомлений с сервера

```bash
curl -X POST https://push360.ru/api/v1/notifications/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_ваш_секретный_ключ" \
  -d '{
    "title": "Привет!",
    "body": "Это тестовое уведомление",
    "url": "/promo",
    "userId": "user_123"
  }'
```

## Поддержка

- Документация: https://push360.ru/admin (вкладка "Интеграция")
- GitHub: https://github.com/Shaadanio/push

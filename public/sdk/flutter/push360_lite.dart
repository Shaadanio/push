// Push360 SDK для FlutterFlow - с Polling поддержкой
// 
// ⚠️ ВАЖНО для FlutterFlow:
// 1. Добавьте зависимости в pubspec.yaml (Settings → Project Dependencies):
//    - http: ^1.1.0
//    - flutter_local_notifications: ^16.0.0
//
// 2. Создайте Custom Actions из этого файла
// 3. Вызовите initPush360() при запуске приложения
// 4. Запустите startPush360Polling() для получения уведомлений
//
// Без Firebase! Работает через HTTP Polling.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (храним состояние)
// ============================================================
String _push360ApiKey = '';
String _push360ApiUrl = 'https://push360.ru';
String? _push360DeviceId;
String? _push360Token;
Timer? _push360PollTimer;
bool _push360Polling = false;
final FlutterLocalNotificationsPlugin _push360Notifications = FlutterLocalNotificationsPlugin();

// Callback для обработки кликов (установите в вашем коде)
Function(String? url, Map<String, dynamic> data)? push360OnNotificationClick;

// ============================================================
// 1. ИНИЦИАЛИЗАЦИЯ (Custom Action: initPush360)
// ============================================================
// 
// Вызовите ОДИН РАЗ при запуске приложения!
// 
// Параметры:
// - apiKey (String, required) - ваш публичный API ключ (pk_...)
//
// Return Type: Future<bool>
//
Future<bool> initPush360(String apiKey) async {
  _push360ApiKey = apiKey;
  
  // Инициализация локальных уведомлений
  const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
  const iosSettings = DarwinInitializationSettings(
    requestAlertPermission: true,
    requestBadgePermission: true,
    requestSoundPermission: true,
  );
  
  await _push360Notifications.initialize(
    const InitializationSettings(android: androidSettings, iOS: iosSettings),
    onDidReceiveNotificationResponse: (response) {
      if (response.payload != null) {
        try {
          final data = jsonDecode(response.payload!) as Map<String, dynamic>;
          final url = data['url'] as String?;
          push360OnNotificationClick?.call(url, data);
          
          // Трекинг клика
          final notifId = data['notificationId']?.toString();
          if (notifId != null && _push360DeviceId != null) {
            _push360TrackClick(notifId);
          }
        } catch (_) {}
      }
    },
  );
  
  return true;
}

// ============================================================
// 2. РЕГИСТРАЦИЯ УСТРОЙСТВА (Custom Action: registerPush360Device)
// ============================================================
//
// Вызовите после initPush360()
// Автоматически запускает polling для получения уведомлений
//
// Параметры:
// - userId (String?, nullable) - ID пользователя (можно null)
//
// Return Type: Future<String?> - возвращает deviceId
//
Future<String?> registerPush360Device(String? userId) async {
  // Генерируем токен
  _push360Token ??= 'push360_${DateTime.now().millisecondsSinceEpoch}';
  
  final platform = Platform.isIOS ? 'ios' : 'android';
  
  try {
    final Map<String, dynamic> body = {
      'platform': platform,
      'token': _push360Token,
      'tags': <String>[],
    };
    
    if (userId != null && userId.isNotEmpty) {
      body['userId'] = userId;
    }
    
    final response = await http.post(
      Uri.parse('$_push360ApiUrl/api/v1/devices/register'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _push360ApiKey,
      },
      body: jsonEncode(body),
    );
    
    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final dataObj = data['data'] as Map<String, dynamic>?;
      _push360DeviceId = dataObj?['deviceId'] as String?;
      
      // Запускаем polling
      startPush360Polling();
      
      return _push360DeviceId;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 3. ЗАПУСК POLLING (Custom Action: startPush360Polling)
// ============================================================
//
// Запускает периодический опрос сервера на новые уведомления
// Автоматически вызывается при registerPush360Device
//
// Return Type: void
//
void startPush360Polling() {
  if (_push360Polling || _push360DeviceId == null) return;
  
  _push360Polling = true;
  
  // Опрашиваем сервер каждые 10 секунд
  _push360PollTimer = Timer.periodic(const Duration(seconds: 10), (_) {
    _push360Poll();
  });
  
  // Сразу делаем первый запрос
  _push360Poll();
}

// ============================================================
// 4. ОСТАНОВКА POLLING (Custom Action: stopPush360Polling)
// ============================================================
//
// Останавливает периодический опрос (например при выходе из приложения)
//
// Return Type: void
//
void stopPush360Polling() {
  _push360Polling = false;
  _push360PollTimer?.cancel();
  _push360PollTimer = null;
}

// ============================================================
// 5. ПРИВЯЗКА ПОЛЬЗОВАТЕЛЯ (Custom Action: linkPush360User)
// ============================================================
//
// Вызовите после авторизации пользователя
//
// Параметры:
// - userId (String, required)
//
// Return Type: Future<bool>
//
Future<bool> linkPush360User(String userId) async {
  if (_push360DeviceId == null) return false;
  
  try {
    final response = await http.post(
      Uri.parse('$_push360ApiUrl/api/v1/devices/$_push360DeviceId/link-user'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _push360ApiKey,
      },
      body: jsonEncode({'userId': userId}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 6. ОТВЯЗКА ПОЛЬЗОВАТЕЛЯ (Custom Action: unlinkPush360User)
// ============================================================
//
// Вызовите при выходе из аккаунта
//
// Return Type: Future<bool>
//
Future<bool> unlinkPush360User() async {
  if (_push360DeviceId == null) return false;
  
  try {
    final response = await http.post(
      Uri.parse('$_push360ApiUrl/api/v1/devices/$_push360DeviceId/unlink-user'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _push360ApiKey,
      },
      body: '{}',
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 7. ОБНОВЛЕНИЕ ТЕГОВ (Custom Action: updatePush360Tags)
// ============================================================
//
// Параметры:
// - tags (List<String>, required)
//
// Return Type: Future<bool>
//
Future<bool> updatePush360Tags(List<String> tags) async {
  if (_push360DeviceId == null) return false;
  
  try {
    final response = await http.put(
      Uri.parse('$_push360ApiUrl/api/v1/devices/$_push360DeviceId'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _push360ApiKey,
      },
      body: jsonEncode({'tags': tags}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 8. ПОЛУЧИТЬ DEVICE ID (Custom Action: getPush360DeviceId)
// ============================================================
//
// Return Type: String?
//
String? getPush360DeviceId() {
  return _push360DeviceId;
}

// ============================================================
// 9. ПРОВЕРКА POLLING (Custom Action: isPush360Polling)
// ============================================================
//
// Return Type: bool
//
bool isPush360Polling() {
  return _push360Polling;
}

// ============================================================
// ВНУТРЕННИЕ ФУНКЦИИ (не создавайте для них Custom Actions)
// ============================================================

Future<void> _push360Poll() async {
  if (_push360DeviceId == null || !_push360Polling) return;
  
  try {
    final response = await http.get(
      Uri.parse('$_push360ApiUrl/api/v1/devices/$_push360DeviceId/poll'),
      headers: {
        'X-API-Key': _push360ApiKey,
      },
    );
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final notifications = (data['data']?['notifications'] as List?) ?? [];
      
      for (final notif in notifications) {
        await _push360ShowNotification(notif as Map<String, dynamic>);
      }
    }
  } catch (_) {}
}

Future<void> _push360ShowNotification(Map<String, dynamic> data) async {
  final notificationId = data['notificationId']?.toString();
  final title = (data['title'] ?? 'Уведомление') as String;
  final body = (data['body'] ?? '') as String;
  
  const androidDetails = AndroidNotificationDetails(
    'push360_channel',
    'Push360',
    channelDescription: 'Push уведомления',
    importance: Importance.high,
    priority: Priority.high,
  );
  
  const iosDetails = DarwinNotificationDetails(
    presentAlert: true,
    presentBadge: true,
    presentSound: true,
  );
  
  await _push360Notifications.show(
    notificationId?.hashCode ?? DateTime.now().millisecondsSinceEpoch,
    title,
    body,
    const NotificationDetails(android: androidDetails, iOS: iosDetails),
    payload: jsonEncode(data),
  );
  
  // Трекинг доставки
  if (notificationId != null) {
    _push360TrackDelivered(notificationId);
  }
}

Future<void> _push360TrackDelivered(String notificationId) async {
  if (_push360DeviceId == null) return;
  try {
    await http.post(
      Uri.parse('$_push360ApiUrl/api/v1/notifications/$notificationId/delivered'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _push360ApiKey,
      },
      body: jsonEncode({'deviceId': _push360DeviceId}),
    );
  } catch (_) {}
}

Future<void> _push360TrackClick(String notificationId) async {
  if (_push360DeviceId == null) return;
  try {
    await http.post(
      Uri.parse('$_push360ApiUrl/api/v1/notifications/$notificationId/click'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _push360ApiKey,
      },
      body: jsonEncode({'deviceId': _push360DeviceId}),
    );
  } catch (_) {}
}

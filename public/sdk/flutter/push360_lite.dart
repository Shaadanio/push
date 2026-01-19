// Push360 SDK для FlutterFlow - с WebSocket поддержкой
// 
// ⚠️ ВАЖНО для FlutterFlow:
// 1. Добавьте зависимости в pubspec.yaml (Settings → Project Dependencies):
//    - http: ^1.1.0
//    - web_socket_channel: ^2.4.0  
//    - flutter_local_notifications: ^16.0.0
//
// 2. Создайте Custom Actions из этого файла
// 3. Вызовите initPush360() при запуске приложения
//
// Без Firebase! Работает через WebSocket на Android.

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

// ============================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (храним состояние)
// ============================================================
String _push360ApiKey = '';
String _push360ApiUrl = 'https://push360.ru';
String? _push360DeviceId;
String? _push360Token;
WebSocketChannel? _push360Channel;
bool _push360Connected = false;
Timer? _push360Heartbeat;
Timer? _push360Reconnect;
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
// Для Android автоматически подключает WebSocket
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
      
      // Для Android подключаемся к WebSocket
      if (Platform.isAndroid && _push360DeviceId != null) {
        _push360ConnectWebSocket();
      }
      
      return _push360DeviceId;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 3. ПРИВЯЗКА ПОЛЬЗОВАТЕЛЯ (Custom Action: linkPush360User)
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
// 4. ОТВЯЗКА ПОЛЬЗОВАТЕЛЯ (Custom Action: unlinkPush360User)
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
// 5. ОБНОВЛЕНИЕ ТЕГОВ (Custom Action: updatePush360Tags)
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
// 6. ПОЛУЧИТЬ DEVICE ID (Custom Action: getPush360DeviceId)
// ============================================================
//
// Return Type: String?
//
String? getPush360DeviceId() {
  return _push360DeviceId;
}

// ============================================================
// 7. ПРОВЕРКА ПОДКЛЮЧЕНИЯ (Custom Action: isPush360Connected)
// ============================================================
//
// Return Type: bool
//
bool isPush360Connected() {
  return _push360Connected;
}

// ============================================================
// 8. ПЕРЕПОДКЛЮЧЕНИЕ (Custom Action: reconnectPush360)
// ============================================================
//
// Вызовите если нужно принудительно переподключиться
//
// Return Type: Future<void>
//
Future<void> reconnectPush360() async {
  if (Platform.isAndroid && _push360DeviceId != null) {
    _push360ConnectWebSocket();
  }
}

// ============================================================
// ВНУТРЕННИЕ ФУНКЦИИ (не создавайте для них Custom Actions)
// ============================================================

void _push360ConnectWebSocket() {
  _push360Disconnect();
  
  final wsUrl = _push360ApiUrl
      .replaceFirst('https://', 'wss://')
      .replaceFirst('http://', 'ws://');
  
  try {
    _push360Channel = WebSocketChannel.connect(
      Uri.parse('$wsUrl/ws/android'),
    );
    
    _push360Channel!.stream.listen(
      _push360HandleMessage,
      onDone: () {
        _push360Connected = false;
        _push360ScheduleReconnect();
      },
      onError: (error) {
        _push360Connected = false;
        _push360ScheduleReconnect();
      },
    );
    
    // Регистрация на сервере
    _push360SendWs({
      'type': 'register',
      'deviceId': _push360DeviceId,
      'token': _push360Token,
    });
    
    _push360Connected = true;
    _push360StartHeartbeat();
  } catch (e) {
    _push360ScheduleReconnect();
  }
}

void _push360HandleMessage(dynamic message) {
  try {
    final data = jsonDecode(message.toString()) as Map<String, dynamic>;
    
    switch (data['type']) {
      case 'notification':
        _push360ShowNotification(data);
        break;
      case 'ping':
        _push360SendWs({'type': 'pong'});
        break;
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
  
  // ACK и трекинг доставки
  if (notificationId != null) {
    _push360SendWs({'type': 'ack', 'notificationId': notificationId});
    _push360TrackDelivered(notificationId);
  }
}

void _push360SendWs(Map<String, dynamic> data) {
  _push360Channel?.sink.add(jsonEncode(data));
}

void _push360StartHeartbeat() {
  _push360Heartbeat?.cancel();
  _push360Heartbeat = Timer.periodic(const Duration(seconds: 25), (_) {
    if (_push360Connected) {
      _push360SendWs({'type': 'ping'});
    }
  });
}

void _push360ScheduleReconnect() {
  _push360Reconnect?.cancel();
  _push360Reconnect = Timer(const Duration(seconds: 5), () {
    if (!_push360Connected && _push360DeviceId != null) {
      _push360ConnectWebSocket();
    }
  });
}

void _push360Disconnect() {
  _push360Heartbeat?.cancel();
  _push360Reconnect?.cancel();
  _push360Channel?.sink.close();
  _push360Channel = null;
  _push360Connected = false;
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

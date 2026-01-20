// Push360 SDK для FlutterFlow - Простая версия
// 
// ⚠️ Для FlutterFlow: каждая функция — отдельный Custom Action
// 
// Зависимости (добавьте в pubspec.yaml через FlutterFlow):
//   - http: ^1.1.0
//   - flutter_local_notifications: ^17.0.0
//   - workmanager: ^0.5.2
//   - shared_preferences: ^2.2.2
// 
// API URL и API Key захардкожены — измените под себя!
//
// ⚠️ ВАЖНО: Для фоновых уведомлений добавьте в AndroidManifest.xml:
//   <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
//   <uses-permission android:name="android.permission.WAKE_LOCK"/>

import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:workmanager/workmanager.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ============================================================
// ⚠️ НАСТРОЙКИ - ИЗМЕНИТЕ ПОД СЕБЯ!
// ============================================================
const String _apiUrl = 'https://push360.ru';
const String _apiKey = 'pk_RwPCyl5JjVpJJNPQVTy0Uw1dbydtwxvv'; // Замените на ваш ключ!

// Singleton для локальных уведомлений
final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
bool _notificationsInitialized = false;

// Константа для WorkManager
const String _backgroundTaskName = 'push360_background_poll';

// ============================================================
// 0. CALLBACK ДЛЯ ФОНОВОГО POLLING (вызовите в main.dart!)
// ============================================================
//
// ⚠️ ВАЖНО: Добавьте этот вызов в main.dart ПЕРЕД runApp():
//
// void main() {
//   WidgetsFlutterBinding.ensureInitialized();
//   Workmanager().initialize(push360BackgroundCallback, isInDebugMode: false);
//   runApp(MyApp());
// }
//
@pragma('vm:entry-point')
void push360BackgroundCallback() {
  Workmanager().executeTask((task, inputData) async {
    if (task == _backgroundTaskName) {
      await _backgroundPoll();
    }
    return true;
  });
}

// Фоновый polling (вызывается WorkManager)
Future<void> _backgroundPoll() async {
  try {
    // Получаем deviceId из SharedPreferences
    final prefs = await SharedPreferences.getInstance();
    final deviceId = prefs.getString('push360_device_id');
    
    if (deviceId == null || deviceId.isEmpty) {
      return;
    }
    
    // Инициализируем уведомления для фонового режима
    final localNotifications = FlutterLocalNotificationsPlugin();
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);
    await localNotifications.initialize(initSettings);
    
    // Делаем polling
    final response = await http.get(
      Uri.parse('$_apiUrl/api/v1/devices/$deviceId/poll'),
      headers: {'X-API-Key': _apiKey},
    );
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final notifications = (data['data']?['notifications'] as List?) ?? [];
      
      for (final notif in notifications) {
        final notifId = notif['notificationId']?.toString() ?? '';
        final title = notif['title'] ?? 'Уведомление';
        final body = notif['body'] ?? '';
        
        // Показываем уведомление
        const androidDetails = AndroidNotificationDetails(
          'push360_channel',
          'Push360 Notifications',
          channelDescription: 'Уведомления от Push360',
          importance: Importance.high,
          priority: Priority.high,
          showWhen: true,
        );
        const details = NotificationDetails(android: androidDetails);
        await localNotifications.show(notifId.hashCode, title, body, details);
        
        // Отмечаем доставку
        await http.post(
          Uri.parse('$_apiUrl/api/v1/notifications/$notifId/delivered'),
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': _apiKey,
          },
          body: jsonEncode({'deviceId': deviceId}),
        );
      }
    }
  } catch (e) {
    // Игнорируем ошибки в фоне
  }
}

// ============================================================
// 1. ИНИЦИАЛИЗАЦИЯ SDK (Custom Action: initPush360)
// ============================================================
//
// Вызовите ОДИН РАЗ при запуске приложения (на первом экране в On Page Load)
// Инициализирует локальные уведомления и проверяет сервер
//
// Return Type: bool
//
Future<bool> initPush360() async {
  try {
    // Инициализация локальных уведомлений
    if (!_notificationsInitialized) {
      const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosSettings = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );
      const initSettings = InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
      );
      await _localNotifications.initialize(initSettings);
      
      // Запрос разрешений для Android 13+
      if (Platform.isAndroid) {
        await _localNotifications
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
            ?.requestNotificationsPermission();
      }
      
      _notificationsInitialized = true;
    }
    
    // Проверка сервера
    final response = await http.get(
      Uri.parse('$_apiUrl/health'),
      headers: {
        'X-API-Key': _apiKey,
      },
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 1.1 ЗАПУСК ФОНОВОГО POLLING (Custom Action: startPush360Background)
// ============================================================
//
// Вызовите ПОСЛЕ регистрации устройства!
// Запускает фоновый polling каждые 15 минут (минимум для Android)
//
// Параметры:
// - deviceId (String, required) - сохраненный deviceId
//
// Return Type: bool
//
Future<bool> startPush360Background(String deviceId) async {
  try {
    // Сохраняем deviceId для фонового доступа
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('push360_device_id', deviceId);
    
    // Регистрируем периодическую задачу
    await Workmanager().registerPeriodicTask(
      _backgroundTaskName,
      _backgroundTaskName,
      frequency: const Duration(minutes: 15), // Минимум для Android
      constraints: Constraints(
        networkType: NetworkType.connected,
      ),
      existingWorkPolicy: ExistingWorkPolicy.replace,
    );
    
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 1.2 ОСТАНОВКА ФОНОВОГО POLLING (Custom Action: stopPush360Background)
// ============================================================
//
// Return Type: bool
//
Future<bool> stopPush360Background() async {
  try {
    await Workmanager().cancelByUniqueName(_backgroundTaskName);
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 2. РЕГИСТРАЦИЯ УСТРОЙСТВА (Custom Action: registerPush360Device)
// ============================================================
// 
// Параметры:
// - userId (String?, nullable) - ID пользователя (можно null)
//
// Return Type: String? (deviceId)
//
// ⚠️ СОХРАНИТЕ deviceId в App State!
//
Future<String?> registerPush360Device(String? userId) async {
  try {
    final token = 'push360_${DateTime.now().millisecondsSinceEpoch}';
    final platform = Platform.isIOS ? 'ios' : 'android';
    
    final Map<String, dynamic> body = {
      'platform': platform,
      'token': token,
      'tags': <String>[],
    };
    
    if (userId != null && userId.isNotEmpty) {
      body['userId'] = userId;
    }
    
    final response = await http.post(
      Uri.parse('$_apiUrl/api/v1/devices/register'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _apiKey,
      },
      body: jsonEncode(body),
    );
    
    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final dataObj = data['data'] as Map<String, dynamic>?;
      return dataObj?['deviceId'] as String?;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 2. ПРИВЯЗКА ПОЛЬЗОВАТЕЛЯ (Custom Action: linkPush360User)
// ============================================================
//
// Параметры:
// - deviceId (String, required) - из App State
// - userId (String, required)
//
// Return Type: bool
//
Future<bool> linkPush360User(String deviceId, String userId) async {
  try {
    final response = await http.post(
      Uri.parse('$_apiUrl/api/v1/devices/$deviceId/link-user'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _apiKey,
      },
      body: jsonEncode({'userId': userId}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 3. ОТВЯЗКА ПОЛЬЗОВАТЕЛЯ (Custom Action: unlinkPush360User)
// ============================================================
//
// Параметры:
// - deviceId (String, required) - из App State
//
// Return Type: bool
//
Future<bool> unlinkPush360User(String deviceId) async {
  try {
    final response = await http.post(
      Uri.parse('$_apiUrl/api/v1/devices/$deviceId/unlink-user'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _apiKey,
      },
      body: '{}',
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 4. ПОЛУЧИТЬ УВЕДОМЛЕНИЯ (Custom Action: pollPush360)
// ============================================================
//
// Вызывайте периодически (например, на таймере или при открытии экрана)
// Автоматически показывает уведомления в системной шторке!
//
// Параметры:
// - deviceId (String, required) - из App State
//
// Return Type: List<dynamic>? (список уведомлений)
//
Future<List<dynamic>?> pollPush360(String deviceId) async {
  try {
    final response = await http.get(
      Uri.parse('$_apiUrl/api/v1/devices/$deviceId/poll'),
      headers: {
        'X-API-Key': _apiKey,
      },
    );
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final notifications = (data['data']?['notifications'] as List?) ?? [];
      
      // Показываем каждое уведомление в системной шторке
      for (final notif in notifications) {
        final notifId = notif['notificationId']?.toString() ?? '';
        final title = notif['title'] ?? 'Уведомление';
        final body = notif['body'] ?? '';
        
        await _showLocalNotification(notifId, title, body);
        
        // Отмечаем доставку
        await trackPush360Delivered(deviceId, notifId);
      }
      
      return notifications;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 4.1 ПОКАЗАТЬ ЛОКАЛЬНОЕ УВЕДОМЛЕНИЕ (внутренняя функция)
// ============================================================
Future<void> _showLocalNotification(String id, String title, String body) async {
  const androidDetails = AndroidNotificationDetails(
    'push360_channel',
    'Push360 Notifications',
    channelDescription: 'Уведомления от Push360',
    importance: Importance.high,
    priority: Priority.high,
    showWhen: true,
  );
  const iosDetails = DarwinNotificationDetails(
    presentAlert: true,
    presentBadge: true,
    presentSound: true,
  );
  const details = NotificationDetails(
    android: androidDetails,
    iOS: iosDetails,
  );
  
  await _localNotifications.show(
    id.hashCode,
    title,
    body,
    details,
  );
}

// ============================================================
// 5. ОТМЕТИТЬ ДОСТАВКУ (Custom Action: trackPush360Delivered)
// ============================================================
//
// Вызовите когда показали уведомление пользователю
//
// Параметры:
// - deviceId (String, required)
// - notificationId (String, required)
//
// Return Type: bool
//
Future<bool> trackPush360Delivered(String deviceId, String notificationId) async {
  try {
    final response = await http.post(
      Uri.parse('$_apiUrl/api/v1/notifications/$notificationId/delivered'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _apiKey,
      },
      body: jsonEncode({'deviceId': deviceId}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 6. ОТМЕТИТЬ КЛИК (Custom Action: trackPush360Click)
// ============================================================
//
// Вызовите когда пользователь нажал на уведомление
//
// Параметры:
// - deviceId (String, required)
// - notificationId (String, required)
//
// Return Type: bool
//
Future<bool> trackPush360Click(String deviceId, String notificationId) async {
  try {
    final response = await http.post(
      Uri.parse('$_apiUrl/api/v1/notifications/$notificationId/click'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _apiKey,
      },
      body: jsonEncode({'deviceId': deviceId}),
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
// - deviceId (String, required)
// - tags (List<String>, required)
//
// Return Type: bool
//
Future<bool> updatePush360Tags(String deviceId, List<String> tags) async {
  try {
    final response = await http.put(
      Uri.parse('$_apiUrl/api/v1/devices/$deviceId'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': _apiKey,
      },
      body: jsonEncode({'tags': tags}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

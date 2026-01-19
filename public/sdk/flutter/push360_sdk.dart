/// Push360 SDK для Flutter
/// Независимый сервис push-уведомлений
/// 
/// Поддержка:
/// - Android: WebSocket соединение
/// - iOS: APNs (Apple Push Notification service)
///
/// Пример использования:
/// ```dart
/// final push = Push360SDK(
///   apiUrl: 'https://push360.ru',
///   apiKey: 'pk_ваш_публичный_ключ',
/// );
/// await push.init();
/// await push.register(userId: 'user123', tags: ['news', 'promo']);
/// ```

library push360_sdk;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Callback для обработки уведомлений
typedef NotificationCallback = void Function(Push360Notification notification);
typedef NotificationClickCallback = void Function(Push360Notification notification, String? action);

/// Модель уведомления
class Push360Notification {
  final String id;
  final String title;
  final String body;
  final String? icon;
  final String? image;
  final String? url;
  final Map<String, dynamic>? data;
  final DateTime receivedAt;

  Push360Notification({
    required this.id,
    required this.title,
    required this.body,
    this.icon,
    this.image,
    this.url,
    this.data,
    DateTime? receivedAt,
  }) : receivedAt = receivedAt ?? DateTime.now();

  factory Push360Notification.fromJson(Map<String, dynamic> json) {
    return Push360Notification(
      id: json['notificationId']?.toString() ?? json['id']?.toString() ?? '',
      title: json['title'] ?? 'Уведомление',
      body: json['body'] ?? '',
      icon: json['icon'],
      image: json['image'],
      url: json['url'] ?? json['data']?['url'],
      data: json['data'] is Map ? Map<String, dynamic>.from(json['data']) : null,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'body': body,
    'icon': icon,
    'image': image,
    'url': url,
    'data': data,
    'receivedAt': receivedAt.toIso8601String(),
  };
}

/// Основной класс SDK
class Push360SDK {
  final String apiUrl;
  final String apiKey;
  final bool debug;
  
  String? _deviceId;
  String? _userId;
  List<String> _tags = [];
  WebSocketChannel? _wsChannel;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  bool _isConnected = false;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 10;
  
  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  
  NotificationCallback? onNotificationReceived;
  NotificationClickCallback? onNotificationClick;

  Push360SDK({
    required this.apiUrl,
    required this.apiKey,
    this.debug = false,
  });

  /// Инициализация SDK
  Future<void> init() async {
    _log('Инициализация Push360 SDK...');
    
    // Загружаем сохранённый deviceId
    final prefs = await SharedPreferences.getInstance();
    _deviceId = prefs.getString('push360_device_id');
    _userId = prefs.getString('push360_user_id');
    final tagsJson = prefs.getString('push360_tags');
    if (tagsJson != null) {
      _tags = List<String>.from(jsonDecode(tagsJson));
    }
    
    // Инициализация локальных уведомлений
    await _initLocalNotifications();
    
    _log('SDK инициализирован. DeviceId: $_deviceId');
  }

  /// Инициализация локальных уведомлений
  Future<void> _initLocalNotifications() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    
    const initSettings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );
    
    await _localNotifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationTap,
    );
  }

  /// Обработка нажатия на уведомление
  void _onNotificationTap(NotificationResponse response) {
    _log('Нажатие на уведомление: ${response.payload}');
    
    if (response.payload != null) {
      try {
        final data = jsonDecode(response.payload!);
        final notification = Push360Notification.fromJson(data);
        
        // Отправляем статистику клика
        _trackClick(notification.id);
        
        // Вызываем callback
        onNotificationClick?.call(notification, response.actionId);
      } catch (e) {
        _log('Ошибка парсинга payload: $e');
      }
    }
  }

  /// Регистрация устройства
  Future<String?> register({
    String? userId,
    List<String>? tags,
    String? apnsToken, // Для iOS
  }) async {
    _log('Регистрация устройства...');
    
    final platform = Platform.isIOS ? 'ios' : 'android';
    
    final body = {
      'platform': platform,
      'deviceInfo': {
        'os': Platform.operatingSystem,
        'osVersion': Platform.operatingSystemVersion,
        'model': 'Flutter App',
      },
      if (userId != null) 'userId': userId,
      if (tags != null && tags.isNotEmpty) 'tags': tags,
      if (apnsToken != null) 'apnsToken': apnsToken,
    };
    
    try {
      final response = await http.post(
        Uri.parse('$apiUrl/api/v1/devices/register'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode(body),
      );
      
      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = jsonDecode(response.body);
        _deviceId = data['deviceId'];
        
        // Сохраняем
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('push360_device_id', _deviceId!);
        if (userId != null) {
          _userId = userId;
          await prefs.setString('push360_user_id', userId);
        }
        if (tags != null) {
          _tags = tags;
          await prefs.setString('push360_tags', jsonEncode(tags));
        }
        
        _log('Устройство зарегистрировано: $_deviceId');
        
        // Подключаемся к WebSocket (для Android)
        if (Platform.isAndroid) {
          await _connectWebSocket();
        }
        
        return _deviceId;
      } else {
        _log('Ошибка регистрации: ${response.statusCode} ${response.body}');
        return null;
      }
    } catch (e) {
      _log('Ошибка сети при регистрации: $e');
      return null;
    }
  }

  /// Подключение к WebSocket (Android)
  Future<void> _connectWebSocket() async {
    if (_deviceId == null) {
      _log('Невозможно подключиться: deviceId не установлен');
      return;
    }
    
    final wsUrl = apiUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
    final uri = Uri.parse('$wsUrl/ws/android?deviceId=$_deviceId&apiKey=$apiKey');
    
    _log('Подключение к WebSocket: $uri');
    
    try {
      _wsChannel = WebSocketChannel.connect(uri);
      _isConnected = true;
      _reconnectAttempts = 0;
      
      // Ping каждые 30 секунд
      _pingTimer?.cancel();
      _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
        if (_isConnected) {
          _wsChannel?.sink.add(jsonEncode({'type': 'ping'}));
        }
      });
      
      // Слушаем сообщения
      _wsChannel!.stream.listen(
        _onWebSocketMessage,
        onError: _onWebSocketError,
        onDone: _onWebSocketClosed,
      );
      
      _log('WebSocket подключён');
    } catch (e) {
      _log('Ошибка подключения WebSocket: $e');
      _scheduleReconnect();
    }
  }

  /// Обработка сообщения WebSocket
  void _onWebSocketMessage(dynamic message) {
    _log('WS сообщение: $message');
    
    try {
      final data = jsonDecode(message);
      
      if (data['type'] == 'notification') {
        final notification = Push360Notification.fromJson(data);
        _showLocalNotification(notification);
        onNotificationReceived?.call(notification);
      } else if (data['type'] == 'pong') {
        // Сервер жив
      }
    } catch (e) {
      _log('Ошибка парсинга WS сообщения: $e');
    }
  }

  /// Ошибка WebSocket
  void _onWebSocketError(error) {
    _log('WS ошибка: $error');
    _isConnected = false;
    _scheduleReconnect();
  }

  /// WebSocket закрыт
  void _onWebSocketClosed() {
    _log('WS соединение закрыто');
    _isConnected = false;
    _pingTimer?.cancel();
    _scheduleReconnect();
  }

  /// Планирование переподключения
  void _scheduleReconnect() {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      _log('Превышено максимальное количество попыток переподключения');
      return;
    }
    
    _reconnectTimer?.cancel();
    final delay = Duration(seconds: (2 << _reconnectAttempts).clamp(1, 60));
    _reconnectAttempts++;
    
    _log('Переподключение через ${delay.inSeconds} сек (попытка $_reconnectAttempts)');
    
    _reconnectTimer = Timer(delay, () {
      _connectWebSocket();
    });
  }

  /// Показать локальное уведомление
  Future<void> _showLocalNotification(Push360Notification notification) async {
    const androidDetails = AndroidNotificationDetails(
      'push360_channel',
      'Push360 Уведомления',
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
      notification.id.hashCode,
      notification.title,
      notification.body,
      details,
      payload: jsonEncode(notification.toJson()),
    );
    
    // Отправляем статистику доставки
    _trackDelivery(notification.id);
  }

  /// Отправка статистики доставки
  Future<void> _trackDelivery(String notificationId) async {
    if (notificationId.isEmpty) return;
    
    try {
      await http.post(
        Uri.parse('$apiUrl/api/v1/notifications/$notificationId/delivered'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'deviceId': _deviceId ?? 'unknown'}),
      );
      _log('Статистика доставки отправлена: $notificationId');
    } catch (e) {
      _log('Ошибка отправки статистики доставки: $e');
    }
  }

  /// Отправка статистики клика
  Future<void> _trackClick(String notificationId) async {
    if (notificationId.isEmpty) return;
    
    try {
      await http.post(
        Uri.parse('$apiUrl/api/v1/notifications/$notificationId/click'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'deviceId': _deviceId ?? 'unknown'}),
      );
      _log('Статистика клика отправлена: $notificationId');
    } catch (e) {
      _log('Ошибка отправки статистики клика: $e');
    }
  }

  /// Обновить userId
  Future<bool> setUserId(String userId) async {
    if (_deviceId == null) {
      _log('Невозможно установить userId: устройство не зарегистрировано');
      return false;
    }
    
    try {
      final response = await http.put(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId/user'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'userId': userId}),
      );
      
      if (response.statusCode == 200) {
        _userId = userId;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('push360_user_id', userId);
        _log('UserId обновлён: $userId');
        return true;
      }
      return false;
    } catch (e) {
      _log('Ошибка обновления userId: $e');
      return false;
    }
  }

  /// Обновить теги
  Future<bool> setTags(List<String> tags) async {
    if (_deviceId == null) {
      _log('Невозможно установить теги: устройство не зарегистрировано');
      return false;
    }
    
    try {
      final response = await http.put(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId/tags'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'tags': tags}),
      );
      
      if (response.statusCode == 200) {
        _tags = tags;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('push360_tags', jsonEncode(tags));
        _log('Теги обновлены: $tags');
        return true;
      }
      return false;
    } catch (e) {
      _log('Ошибка обновления тегов: $e');
      return false;
    }
  }

  /// Добавить тег
  Future<bool> addTag(String tag) async {
    if (!_tags.contains(tag)) {
      return setTags([..._tags, tag]);
    }
    return true;
  }

  /// Удалить тег
  Future<bool> removeTag(String tag) async {
    if (_tags.contains(tag)) {
      return setTags(_tags.where((t) => t != tag).toList());
    }
    return true;
  }

  /// Отписаться от уведомлений
  Future<bool> unregister() async {
    if (_deviceId == null) return true;
    
    try {
      final response = await http.delete(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId'),
        headers: {'X-API-Key': apiKey},
      );
      
      if (response.statusCode == 200) {
        _disconnect();
        
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove('push360_device_id');
        await prefs.remove('push360_user_id');
        await prefs.remove('push360_tags');
        
        _deviceId = null;
        _userId = null;
        _tags = [];
        
        _log('Устройство отписано');
        return true;
      }
      return false;
    } catch (e) {
      _log('Ошибка отписки: $e');
      return false;
    }
  }

  /// Отключение
  void _disconnect() {
    _pingTimer?.cancel();
    _reconnectTimer?.cancel();
    _wsChannel?.sink.close();
    _isConnected = false;
  }

  /// Запрос разрешения на уведомления (iOS)
  Future<bool> requestPermission() async {
    if (Platform.isIOS) {
      final result = await _localNotifications
          .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          );
      return result ?? false;
    }
    
    if (Platform.isAndroid) {
      final result = await _localNotifications
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      return result ?? false;
    }
    
    return false;
  }

  /// Геттеры
  String? get deviceId => _deviceId;
  String? get userId => _userId;
  List<String> get tags => List.unmodifiable(_tags);
  bool get isConnected => _isConnected;
  bool get isRegistered => _deviceId != null;

  /// Логирование
  void _log(String message) {
    if (debug) {
      debugPrint('[Push360] $message');
    }
  }

  /// Освобождение ресурсов
  void dispose() {
    _disconnect();
  }
}

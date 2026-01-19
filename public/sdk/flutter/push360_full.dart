// Push360 SDK для Flutter - Full версия с WebSocket
// 
// Для обычного Flutter проекта (НЕ FlutterFlow!)
// FlutterFlow не поддерживает persistent WebSocket — используйте Lite версию.
//
// Зависимости в pubspec.yaml:
//   http: ^1.1.0
//   web_socket_channel: ^2.4.0
//   flutter_local_notifications: ^16.0.0
//   shared_preferences: ^2.2.0
//
// Для iOS добавьте в ios/Runner/Info.plist:
//   <key>UIBackgroundModes</key>
//   <array>
//     <string>fetch</string>
//     <string>remote-notification</string>
//   </array>

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Push360 SDK - полная версия с WebSocket для Android
class Push360 {
  static Push360? _instance;
  
  final String apiUrl;
  final String apiKey;
  
  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  bool _isConnected = false;
  String? _deviceId;
  String? _token;
  
  final FlutterLocalNotificationsPlugin _notifications = FlutterLocalNotificationsPlugin();
  
  // Callbacks
  Function(Map<String, dynamic>)? onNotificationReceived;
  Function(Map<String, dynamic>)? onNotificationClick;
  Function(bool)? onConnectionChanged;
  
  Push360._({required this.apiUrl, required this.apiKey});
  
  /// Инициализация SDK
  static Future<Push360> initialize({
    required String apiKey,
    String apiUrl = 'https://push360.ru',
    Function(Map<String, dynamic>)? onNotificationReceived,
    Function(Map<String, dynamic>)? onNotificationClick,
    Function(bool)? onConnectionChanged,
  }) async {
    _instance = Push360._(apiUrl: apiUrl, apiKey: apiKey);
    _instance!.onNotificationReceived = onNotificationReceived;
    _instance!.onNotificationClick = onNotificationClick;
    _instance!.onConnectionChanged = onConnectionChanged;
    
    await _instance!._initNotifications();
    await _instance!._loadSavedDevice();
    
    return _instance!;
  }
  
  /// Получить текущий экземпляр
  static Push360? get instance => _instance;
  
  /// ID устройства
  String? get deviceId => _deviceId;
  
  /// Статус подключения
  bool get isConnected => _isConnected;
  
  /// Инициализация локальных уведомлений
  Future<void> _initNotifications() async {
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
    
    await _notifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: (response) {
        if (response.payload != null) {
          try {
            final data = jsonDecode(response.payload!);
            onNotificationClick?.call(data);
            _trackClick(data['notificationId']);
          } catch (_) {}
        }
      },
    );
  }
  
  /// Загрузка сохранённого устройства
  Future<void> _loadSavedDevice() async {
    final prefs = await SharedPreferences.getInstance();
    _deviceId = prefs.getString('push360_device_id');
    _token = prefs.getString('push360_token');
  }
  
  /// Сохранение устройства
  Future<void> _saveDevice() async {
    final prefs = await SharedPreferences.getInstance();
    if (_deviceId != null) {
      await prefs.setString('push360_device_id', _deviceId!);
    }
    if (_token != null) {
      await prefs.setString('push360_token', _token!);
    }
  }
  
  /// Регистрация устройства
  /// 
  /// [userId] - ID пользователя (опционально, можно привязать позже)
  /// [tags] - теги для сегментации
  Future<String?> registerDevice({
    String? userId,
    List<String> tags = const [],
  }) async {
    // Генерируем токен если нет
    _token ??= _generateToken();
    
    final platform = Platform.isIOS ? 'ios' : 'android';
    
    try {
      final body = <String, dynamic>{
        'platform': platform,
        'token': _token,
        'tags': tags,
      };
      
      if (userId != null && userId.isNotEmpty) {
        body['userId'] = userId;
      }
      
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
        _deviceId = data['data']?['deviceId'];
        await _saveDevice();
        
        // Для Android подключаемся к WebSocket
        if (Platform.isAndroid) {
          _connectWebSocket();
        }
        
        debugPrint('Push360: Устройство зарегистрировано: $_deviceId');
        return _deviceId;
      }
      
      debugPrint('Push360: Ошибка регистрации: ${response.body}');
      return null;
    } catch (e) {
      debugPrint('Push360: Ошибка: $e');
      return null;
    }
  }
  
  /// Генерация уникального токена
  String _generateToken() {
    final random = DateTime.now().millisecondsSinceEpoch.toString();
    final hash = random.hashCode.abs().toRadixString(36);
    return 'push360_${hash}_$random';
  }
  
  /// Подключение к WebSocket (для Android)
  void _connectWebSocket() {
    if (_deviceId == null || _token == null) return;
    
    _disconnect();
    
    final wsUrl = apiUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
    
    try {
      _channel = WebSocketChannel.connect(Uri.parse('$wsUrl/ws/android'));
      
      _channel!.stream.listen(
        (message) => _handleMessage(message),
        onDone: () {
          debugPrint('Push360: WebSocket отключён');
          _setConnected(false);
          _scheduleReconnect();
        },
        onError: (error) {
          debugPrint('Push360: WebSocket ошибка: $error');
          _setConnected(false);
          _scheduleReconnect();
        },
      );
      
      // Отправляем регистрацию
      _sendWsMessage({
        'type': 'register',
        'deviceId': _deviceId,
        'token': _token,
      });
      
      _setConnected(true);
      _startHeartbeat();
      
      debugPrint('Push360: WebSocket подключён');
    } catch (e) {
      debugPrint('Push360: Ошибка подключения WebSocket: $e');
      _scheduleReconnect();
    }
  }
  
  /// Обработка WebSocket сообщений
  void _handleMessage(dynamic message) {
    try {
      final data = jsonDecode(message.toString());
      
      switch (data['type']) {
        case 'registered':
          debugPrint('Push360: WebSocket зарегистрирован');
          break;
          
        case 'notification':
          _handleNotification(data);
          break;
          
        case 'ping':
          _sendWsMessage({'type': 'pong'});
          break;
      }
    } catch (e) {
      debugPrint('Push360: Ошибка обработки сообщения: $e');
    }
  }
  
  /// Обработка уведомления
  Future<void> _handleNotification(Map<String, dynamic> data) async {
    final notificationId = data['notificationId']?.toString();
    final title = data['title'] ?? 'Уведомление';
    final body = data['body'] ?? '';
    
    // Показываем локальное уведомление
    await _showLocalNotification(
      id: notificationId.hashCode,
      title: title,
      body: body,
      payload: jsonEncode(data),
    );
    
    // Отправляем ACK
    if (notificationId != null) {
      _sendWsMessage({
        'type': 'ack',
        'notificationId': notificationId,
      });
      _trackDelivered(notificationId);
    }
    
    onNotificationReceived?.call(data);
  }
  
  /// Показ локального уведомления
  Future<void> _showLocalNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      'push360_channel',
      'Push360 Уведомления',
      channelDescription: 'Уведомления от Push360',
      importance: Importance.high,
      priority: Priority.high,
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
    
    await _notifications.show(id, title, body, details, payload: payload);
  }
  
  /// Отправка сообщения через WebSocket
  void _sendWsMessage(Map<String, dynamic> data) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(data));
    }
  }
  
  /// Heartbeat для поддержания соединения
  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      if (_isConnected) {
        _sendWsMessage({'type': 'ping'});
      }
    });
  }
  
  /// Планирование переподключения
  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), () {
      if (!_isConnected && _deviceId != null) {
        debugPrint('Push360: Переподключение...');
        _connectWebSocket();
      }
    });
  }
  
  /// Установка статуса подключения
  void _setConnected(bool connected) {
    if (_isConnected != connected) {
      _isConnected = connected;
      onConnectionChanged?.call(connected);
    }
  }
  
  /// Отключение WebSocket
  void _disconnect() {
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
    _setConnected(false);
  }
  
  /// Привязка пользователя к устройству
  Future<bool> linkUser(String userId) async {
    if (_deviceId == null) return false;
    
    try {
      final response = await http.post(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId/link-user'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'userId': userId}),
      );
      
      return response.statusCode == 200;
    } catch (e) {
      debugPrint('Push360: Ошибка привязки пользователя: $e');
      return false;
    }
  }
  
  /// Отвязка пользователя от устройства
  Future<bool> unlinkUser() async {
    if (_deviceId == null) return false;
    
    try {
      final response = await http.post(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId/unlink-user'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: '{}',
      );
      
      return response.statusCode == 200;
    } catch (e) {
      debugPrint('Push360: Ошибка отвязки пользователя: $e');
      return false;
    }
  }
  
  /// Обновление тегов
  Future<bool> updateTags(List<String> tags) async {
    if (_deviceId == null) return false;
    
    try {
      final response = await http.put(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'tags': tags}),
      );
      
      return response.statusCode == 200;
    } catch (e) {
      debugPrint('Push360: Ошибка обновления тегов: $e');
      return false;
    }
  }
  
  /// Трекинг доставки
  Future<void> _trackDelivered(String notificationId) async {
    if (_deviceId == null) return;
    
    try {
      await http.post(
        Uri.parse('$apiUrl/api/v1/notifications/$notificationId/delivered'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'deviceId': _deviceId}),
      );
    } catch (_) {}
  }
  
  /// Трекинг клика
  Future<void> _trackClick(String? notificationId) async {
    if (_deviceId == null || notificationId == null) return;
    
    try {
      await http.post(
        Uri.parse('$apiUrl/api/v1/notifications/$notificationId/click'),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: jsonEncode({'deviceId': _deviceId}),
      );
    } catch (_) {}
  }
  
  /// Отписка устройства
  Future<bool> unregister() async {
    if (_deviceId == null) return false;
    
    _disconnect();
    
    try {
      final response = await http.delete(
        Uri.parse('$apiUrl/api/v1/devices/$_deviceId'),
        headers: {'X-API-Key': apiKey},
      );
      
      if (response.statusCode == 200) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove('push360_device_id');
        await prefs.remove('push360_token');
        _deviceId = null;
        _token = null;
        return true;
      }
      
      return false;
    } catch (e) {
      debugPrint('Push360: Ошибка отписки: $e');
      return false;
    }
  }
  
  /// Освобождение ресурсов
  void dispose() {
    _disconnect();
  }
}

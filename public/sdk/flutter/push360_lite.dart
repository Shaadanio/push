// Push360 SDK для FlutterFlow - Простая версия
// 
// ⚠️ Для FlutterFlow: каждая функция — отдельный Custom Action
// Зависимости: http
// 
// API URL и API Key захардкожены — измените под себя!

import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

// ============================================================
// ⚠️ НАСТРОЙКИ - ИЗМЕНИТЕ ПОД СЕБЯ!
// ============================================================
const String _apiUrl = 'https://push360.ru';
const String _apiKey = 'pk_ВАШ_КЛЮЧ_ЗДЕСЬ'; // Замените на ваш ключ!

// ============================================================
// 1. РЕГИСТРАЦИЯ УСТРОЙСТВА (Custom Action: registerPush360Device)
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
// Возвращает список уведомлений
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
      return (data['data']?['notifications'] as List?) ?? [];
    }
    return null;
  } catch (e) {
    return null;
  }
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

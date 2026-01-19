// Push360 SDK для FlutterFlow - Lite версия
// 
// ⚠️ ВАЖНО для FlutterFlow:
// Каждая функция — это отдельный Custom Action!
// Создайте отдельный Custom Action для каждой нужной функции.
// 
// Зависимости: добавьте "http: ^1.1.0" в pubspec.yaml

import 'dart:convert';
import 'package:http/http.dart' as http;

// ============================================================
// 1. РЕГИСТРАЦИЯ УСТРОЙСТВА (Custom Action: registerPush360Device)
// ============================================================
// 
// Параметры в FlutterFlow:
// - apiKey (String, required) - ваш публичный API ключ
// - platform (String, required) - 'ios' или 'android'
// - token (String, required) - push токен устройства
// - userId (String, optional) - ID пользователя (можно не передавать)
// 
// Return Type: String (nullable) - возвращает deviceId
//
Future<String?> registerPush360Device(
  String apiKey,
  String platform,
  String token,
  String? userId,
) async {
  try {
    final Map<String, dynamic> body = {
      'platform': platform,
      'token': token,
      'tags': <String>[],
    };
    
    if (userId != null && userId.isNotEmpty) {
      body['userId'] = userId;
    }
    
    final response = await http.post(
      Uri.parse('https://push360.ru/api/v1/devices/register'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
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
// Вызывайте после авторизации пользователя!
//
// Параметры в FlutterFlow:
// - apiKey (String, required)
// - deviceId (String, required) - ID из registerPush360Device
// - userId (String, required) - ID пользователя
//
// Return Type: Boolean
//
Future<bool> linkPush360User(
  String apiKey,
  String deviceId,
  String userId,
) async {
  try {
    final response = await http.post(
      Uri.parse('https://push360.ru/api/v1/devices/$deviceId/link-user'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
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
// Вызывайте при выходе из аккаунта!
//
// Параметры в FlutterFlow:
// - apiKey (String, required)
// - deviceId (String, required)
//
// Return Type: Boolean
//
Future<bool> unlinkPush360User(
  String apiKey,
  String deviceId,
) async {
  try {
    final response = await http.post(
      Uri.parse('https://push360.ru/api/v1/devices/$deviceId/unlink-user'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: '{}',
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 4. СТАТИСТИКА ДОСТАВКИ (Custom Action: trackPush360Delivered)
// ============================================================
//
// Вызывайте когда получено push-уведомление
//
// Параметры в FlutterFlow:
// - apiKey (String, required)
// - notificationId (String, required) - из payload уведомления
// - deviceId (String, required)
//
// Return Type: Boolean
//
Future<bool> trackPush360Delivered(
  String apiKey,
  String notificationId,
  String deviceId,
) async {
  try {
    final response = await http.post(
      Uri.parse('https://push360.ru/api/v1/notifications/$notificationId/delivered'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: jsonEncode({'deviceId': deviceId}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 5. СТАТИСТИКА КЛИКА (Custom Action: trackPush360Click)
// ============================================================
//
// Вызывайте когда пользователь нажал на уведомление
//
// Параметры в FlutterFlow:
// - apiKey (String, required)
// - notificationId (String, required)
// - deviceId (String, required)
//
// Return Type: Boolean
//
Future<bool> trackPush360Click(
  String apiKey,
  String notificationId,
  String deviceId,
) async {
  try {
    final response = await http.post(
      Uri.parse('https://push360.ru/api/v1/notifications/$notificationId/click'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: jsonEncode({'deviceId': deviceId}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 6. ОБНОВЛЕНИЕ ТЕГОВ (Custom Action: updatePush360Tags)
// ============================================================
//
// Параметры в FlutterFlow:
// - apiKey (String, required)
// - deviceId (String, required)
// - tags (List<String>, required) - список тегов
//
// Return Type: Boolean
//
Future<bool> updatePush360Tags(
  String apiKey,
  String deviceId,
  List<String> tags,
) async {
  try {
    final response = await http.put(
      Uri.parse('https://push360.ru/api/v1/devices/$deviceId'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: jsonEncode({'tags': tags}),
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 7. ОТПИСКА УСТРОЙСТВА (Custom Action: unregisterPush360Device)
// ============================================================
//
// Параметры в FlutterFlow:
// - apiKey (String, required)
// - deviceId (String, required)
//
// Return Type: Boolean
//
Future<bool> unregisterPush360Device(
  String apiKey,
  String deviceId,
) async {
  try {
    final response = await http.delete(
      Uri.parse('https://push360.ru/api/v1/devices/$deviceId'),
      headers: {
        'X-API-Key': apiKey,
      },
    );
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}

/// Push360 SDK для Flutter - Lite версия для FlutterFlow
/// 
/// Использование в FlutterFlow:
/// 1. Settings → Custom Code → Custom Actions
/// 2. Создайте новый Custom Action
/// 3. Скопируйте этот код
///
/// Для полной версии с WebSocket и локальными уведомлениями
/// используйте полный SDK с pub.dev (когда будет опубликован)

import 'dart:convert';
import 'package:http/http.dart' as http;

/// Конфигурация Push360
class Push360Config {
  static String apiUrl = 'https://push360.ru';
  static String apiKey = ''; // Установите ваш API ключ
  
  static void configure({required String apiUrl, required String apiKey}) {
    Push360Config.apiUrl = apiUrl;
    Push360Config.apiKey = apiKey;
  }
}

/// Регистрация устройства для push-уведомлений
/// 
/// [userId] - ID пользователя в вашей системе (ОБЯЗАТЕЛЬНО)
/// [platform] - 'ios' или 'android'
/// [token] - токен устройства (FCM или APNs)
/// [tags] - теги для сегментации
/// 
/// Возвращает deviceId если успешно, null если ошибка
Future<String?> push360RegisterDevice({
  required String userId,
  required String platform,
  required String token,
  List<String> tags = const [],
}) async {
  try {
    final response = await http.post(
      Uri.parse('${Push360Config.apiUrl}/api/v1/devices/register'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': Push360Config.apiKey,
      },
      body: jsonEncode({
        'platform': platform,
        'token': token,
        'userId': userId,
        'tags': tags,
      }),
    );
    
    if (response.statusCode == 200 || response.statusCode == 201) {
      final data = jsonDecode(response.body);
      return data['data']?['deviceId'];
    }
    
    print('Push360: Ошибка регистрации: ${response.body}');
    return null;
  } catch (e) {
    print('Push360: Ошибка: $e');
    return null;
  }
}

/// Обновление тегов устройства
/// 
/// [deviceId] - ID устройства (полученный при регистрации)
/// [tags] - новые теги
Future<bool> push360UpdateTags({
  required String deviceId,
  required List<String> tags,
}) async {
  try {
    final response = await http.put(
      Uri.parse('${Push360Config.apiUrl}/api/v1/devices/$deviceId'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': Push360Config.apiKey,
      },
      body: jsonEncode({'tags': tags}),
    );
    
    return response.statusCode == 200;
  } catch (e) {
    print('Push360: Ошибка обновления тегов: $e');
    return false;
  }
}

/// Отправка статистики доставки
/// 
/// Вызывайте когда уведомление получено устройством
Future<void> push360TrackDelivered({
  required String notificationId,
  required String deviceId,
}) async {
  try {
    await http.post(
      Uri.parse('${Push360Config.apiUrl}/api/v1/notifications/$notificationId/delivered'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': Push360Config.apiKey,
      },
      body: jsonEncode({'deviceId': deviceId}),
    );
  } catch (e) {
    print('Push360: Ошибка отправки статистики: $e');
  }
}

/// Отправка статистики клика
/// 
/// Вызывайте когда пользователь нажал на уведомление
Future<void> push360TrackClick({
  required String notificationId,
  required String deviceId,
}) async {
  try {
    await http.post(
      Uri.parse('${Push360Config.apiUrl}/api/v1/notifications/$notificationId/click'),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': Push360Config.apiKey,
      },
      body: jsonEncode({'deviceId': deviceId}),
    );
  } catch (e) {
    print('Push360: Ошибка отправки статистики: $e');
  }
}

/// Отписка устройства
Future<bool> push360Unregister({required String deviceId}) async {
  try {
    final response = await http.delete(
      Uri.parse('${Push360Config.apiUrl}/api/v1/devices/$deviceId'),
      headers: {
        'X-API-Key': Push360Config.apiKey,
      },
    );
    
    return response.statusCode == 200;
  } catch (e) {
    print('Push360: Ошибка отписки: $e');
    return false;
  }
}

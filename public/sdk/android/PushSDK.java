package com.pushsdk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Push Notification SDK для Android
 * Подключается напрямую к серверу через WebSocket
 * Без использования Firebase/Google Services
 */
public class PushSDK {
    private static final String TAG = "PushSDK";
    private static final String PREFS_NAME = "PushSDKPrefs";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_TOKEN = "token";
    
    private static PushSDK instance;
    
    private Context context;
    private String serverUrl;
    private String wsUrl;
    private String apiKey;
    private String deviceId;
    private String token;
    
    private OkHttpClient client;
    private WebSocket webSocket;
    private boolean isConnected = false;
    private boolean shouldReconnect = true;
    
    private Handler mainHandler;
    private ExecutorService executor;
    
    private NotificationManager notificationManager;
    private String defaultChannelId = "push_notifications";
    
    private PushListener listener;
    
    private int reconnectAttempts = 0;
    private static final int MAX_RECONNECT_ATTEMPTS = 10;
    private static final long RECONNECT_DELAY_MS = 5000;
    
    public interface PushListener {
        void onConnected();
        void onDisconnected();
        void onNotificationReceived(PushNotification notification);
        void onNotificationClicked(PushNotification notification);
        void onError(String error);
    }
    
    public static class PushNotification {
        public String id;
        public String title;
        public String body;
        public String icon;
        public String image;
        public String url;
        public JSONObject data;
        public String channelId;
        public long timestamp;
    }
    
    private PushSDK(Context context) {
        this.context = context.getApplicationContext();
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.executor = Executors.newSingleThreadExecutor();
        this.notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        
        // Загружаем сохранённые данные
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.deviceId = prefs.getString(KEY_DEVICE_ID, null);
        this.token = prefs.getString(KEY_TOKEN, null);
        
        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString();
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
        }
        
        if (token == null) {
            token = UUID.randomUUID().toString();
            prefs.edit().putString(KEY_TOKEN, token).apply();
        }
        
        createNotificationChannel();
    }
    
    public static synchronized PushSDK getInstance(Context context) {
        if (instance == null) {
            instance = new PushSDK(context);
        }
        return instance;
    }
    
    /**
     * Инициализация SDK
     * @param serverUrl URL сервера (например: https://push.yoursite.com)
     * @param apiKey API ключ приложения
     */
    public void init(String serverUrl, String apiKey) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        
        // Формируем WebSocket URL
        if (serverUrl.startsWith("https://")) {
            this.wsUrl = "wss://" + serverUrl.substring(8) + "/ws/android";
        } else if (serverUrl.startsWith("http://")) {
            this.wsUrl = "ws://" + serverUrl.substring(7) + "/ws/android";
        } else {
            this.wsUrl = "ws://" + serverUrl + "/ws/android";
        }
        
        // Создаём HTTP клиент с поддержкой WebSocket
        client = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // Без таймаута для WebSocket
            .pingInterval(30, TimeUnit.SECONDS)
            .build();
        
        Log.d(TAG, "SDK инициализирован. WebSocket URL: " + wsUrl);
    }
    
    /**
     * Установка слушателя событий
     */
    public void setListener(PushListener listener) {
        this.listener = listener;
    }
    
    /**
     * Подключение к серверу и регистрация устройства
     */
    public void connect() {
        if (serverUrl == null || apiKey == null) {
            Log.e(TAG, "SDK не инициализирован. Вызовите init() сначала.");
            return;
        }
        
        shouldReconnect = true;
        connectWebSocket();
    }
    
    /**
     * Отключение от сервера
     */
    public void disconnect() {
        shouldReconnect = false;
        if (webSocket != null) {
            webSocket.close(1000, "Disconnect requested");
            webSocket = null;
        }
        isConnected = false;
    }
    
    /**
     * Регистрация устройства на сервере через REST API
     */
    public void registerDevice(String userId, List<String> tags) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("platform", "android");
                body.put("token", token);
                body.put("userId", userId);
                body.put("deviceModel", Build.MODEL);
                body.put("osVersion", Build.VERSION.RELEASE);
                
                if (tags != null && !tags.isEmpty()) {
                    body.put("tags", new JSONArray(tags));
                }
                
                Request request = new Request.Builder()
                    .url(serverUrl + "/api/v1/devices/register")
                    .addHeader("Content-Type", "application/json")
                    .addHeader("X-API-Key", apiKey)
                    .post(okhttp3.RequestBody.create(
                        body.toString(),
                        okhttp3.MediaType.parse("application/json")
                    ))
                    .build();
                
                try (Response response = client.newCall(request).execute()) {
                    if (response.isSuccessful()) {
                        String responseBody = response.body().string();
                        JSONObject json = new JSONObject(responseBody);
                        if (json.getBoolean("success")) {
                            String newDeviceId = json.getJSONObject("data").getString("deviceId");
                            deviceId = newDeviceId;
                            
                            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply();
                            
                            Log.d(TAG, "Устройство зарегистрировано: " + deviceId);
                        }
                    } else {
                        Log.e(TAG, "Ошибка регистрации: " + response.code());
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Ошибка регистрации устройства", e);
                notifyError("Ошибка регистрации: " + e.getMessage());
            }
        });
    }
    
    /**
     * Установка тегов для устройства
     */
    public void setTags(List<String> tags) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("tags", new JSONArray(tags));
                
                Request request = new Request.Builder()
                    .url(serverUrl + "/api/v1/devices/" + deviceId + "/tags")
                    .addHeader("Content-Type", "application/json")
                    .addHeader("X-API-Key", apiKey)
                    .post(okhttp3.RequestBody.create(
                        body.toString(),
                        okhttp3.MediaType.parse("application/json")
                    ))
                    .build();
                
                try (Response response = client.newCall(request).execute()) {
                    if (response.isSuccessful()) {
                        Log.d(TAG, "Теги установлены");
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Ошибка установки тегов", e);
            }
        });
    }
    
    /**
     * Привязка к пользователю
     */
    public void setUserId(String userId) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("userId", userId);
                
                Request request = new Request.Builder()
                    .url(serverUrl + "/api/v1/devices/" + deviceId + "/user")
                    .addHeader("Content-Type", "application/json")
                    .addHeader("X-API-Key", apiKey)
                    .post(okhttp3.RequestBody.create(
                        body.toString(),
                        okhttp3.MediaType.parse("application/json")
                    ))
                    .build();
                
                try (Response response = client.newCall(request).execute()) {
                    if (response.isSuccessful()) {
                        Log.d(TAG, "Пользователь привязан: " + userId);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Ошибка привязки пользователя", e);
            }
        });
    }
    
    /**
     * Получение ID устройства
     */
    public String getDeviceId() {
        return deviceId;
    }
    
    /**
     * Проверка подключения
     */
    public boolean isConnected() {
        return isConnected;
    }
    
    // Приватные методы
    
    private void connectWebSocket() {
        Request request = new Request.Builder()
            .url(wsUrl)
            .build();
        
        webSocket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                Log.d(TAG, "WebSocket подключен");
                isConnected = true;
                reconnectAttempts = 0;
                
                // Регистрируемся на сервере
                try {
                    JSONObject registerMsg = new JSONObject();
                    registerMsg.put("type", "register");
                    registerMsg.put("deviceId", deviceId);
                    registerMsg.put("token", token);
                    webSocket.send(registerMsg.toString());
                } catch (JSONException e) {
                    Log.e(TAG, "Ошибка формирования сообщения регистрации", e);
                }
                
                notifyConnected();
            }
            
            @Override
            public void onMessage(WebSocket webSocket, String text) {
                try {
                    JSONObject message = new JSONObject(text);
                    String type = message.optString("type");
                    
                    switch (type) {
                        case "notification":
                            handleNotification(message);
                            break;
                        case "registered":
                            Log.d(TAG, "Устройство зарегистрировано через WebSocket");
                            break;
                    }
                } catch (JSONException e) {
                    Log.e(TAG, "Ошибка парсинга сообщения", e);
                }
            }
            
            @Override
            public void onClosing(WebSocket webSocket, int code, String reason) {
                Log.d(TAG, "WebSocket закрывается: " + reason);
            }
            
            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                Log.d(TAG, "WebSocket закрыт: " + reason);
                isConnected = false;
                notifyDisconnected();
                
                if (shouldReconnect) {
                    scheduleReconnect();
                }
            }
            
            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                Log.e(TAG, "WebSocket ошибка", t);
                isConnected = false;
                notifyError("Ошибка соединения: " + t.getMessage());
                notifyDisconnected();
                
                if (shouldReconnect) {
                    scheduleReconnect();
                }
            }
        });
    }
    
    private void scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.e(TAG, "Превышено максимальное количество попыток переподключения");
            return;
        }
        
        reconnectAttempts++;
        long delay = RECONNECT_DELAY_MS * reconnectAttempts;
        
        Log.d(TAG, "Переподключение через " + delay + "мс (попытка " + reconnectAttempts + ")");
        
        mainHandler.postDelayed(() -> {
            if (shouldReconnect && !isConnected) {
                connectWebSocket();
            }
        }, delay);
    }
    
    private void handleNotification(JSONObject message) {
        try {
            PushNotification notification = new PushNotification();
            notification.id = message.getString("id");
            notification.title = message.optString("title", "");
            notification.body = message.optString("body", "");
            notification.icon = message.optString("icon", null);
            notification.image = message.optString("image", null);
            notification.url = message.optString("url", null);
            notification.data = message.optJSONObject("data");
            notification.channelId = message.optString("channelId", defaultChannelId);
            notification.timestamp = System.currentTimeMillis();
            
            // Отправляем подтверждение
            sendAck(notification.id);
            
            // Показываем уведомление
            showNotification(notification);
            
            // Уведомляем слушателя
            notifyNotificationReceived(notification);
            
        } catch (JSONException e) {
            Log.e(TAG, "Ошибка обработки уведомления", e);
        }
    }
    
    private void sendAck(String notificationId) {
        if (webSocket != null && isConnected) {
            try {
                JSONObject ack = new JSONObject();
                ack.put("type", "ack");
                ack.put("notificationId", notificationId);
                webSocket.send(ack.toString());
            } catch (JSONException e) {
                Log.e(TAG, "Ошибка отправки ACK", e);
            }
        }
    }
    
    private void showNotification(PushNotification notification) {
        int notificationId = notification.id.hashCode();
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, notification.channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // Замените на свою иконку
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true);
        
        // Intent при клике
        Intent intent = new Intent(context, NotificationClickReceiver.class);
        intent.putExtra("notification_id", notification.id);
        intent.putExtra("url", notification.url);
        if (notification.data != null) {
            intent.putExtra("data", notification.data.toString());
        }
        
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, 
            notificationId, 
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.setContentIntent(pendingIntent);
        
        // Загрузка изображения (если есть)
        if (notification.image != null && !notification.image.isEmpty()) {
            executor.execute(() -> {
                Bitmap bitmap = loadBitmap(notification.image);
                if (bitmap != null) {
                    builder.setStyle(new NotificationCompat.BigPictureStyle()
                        .bigPicture(bitmap)
                        .bigLargeIcon((Bitmap) null));
                    
                    mainHandler.post(() -> {
                        notificationManager.notify(notificationId, builder.build());
                    });
                } else {
                    mainHandler.post(() -> {
                        notificationManager.notify(notificationId, builder.build());
                    });
                }
            });
        } else {
            notificationManager.notify(notificationId, builder.build());
        }
    }
    
    private Bitmap loadBitmap(String url) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setDoInput(true);
            connection.connect();
            InputStream input = connection.getInputStream();
            return BitmapFactory.decodeStream(input);
        } catch (Exception e) {
            Log.e(TAG, "Ошибка загрузки изображения", e);
            return null;
        }
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                defaultChannelId,
                "Push уведомления",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Канал для push-уведомлений");
            channel.enableVibration(true);
            notificationManager.createNotificationChannel(channel);
        }
    }
    
    // Уведомление слушателей
    
    private void notifyConnected() {
        if (listener != null) {
            mainHandler.post(() -> listener.onConnected());
        }
    }
    
    private void notifyDisconnected() {
        if (listener != null) {
            mainHandler.post(() -> listener.onDisconnected());
        }
    }
    
    private void notifyNotificationReceived(PushNotification notification) {
        if (listener != null) {
            mainHandler.post(() -> listener.onNotificationReceived(notification));
        }
    }
    
    private void notifyError(String error) {
        if (listener != null) {
            mainHandler.post(() -> listener.onError(error));
        }
    }
    
    /**
     * Вызывается при клике на уведомление
     */
    public void handleNotificationClick(String notificationId, String url, String data) {
        // Отправляем событие клика на сервер
        if (webSocket != null && isConnected) {
            try {
                JSONObject click = new JSONObject();
                click.put("type", "click");
                click.put("notificationId", notificationId);
                webSocket.send(click.toString());
            } catch (JSONException e) {
                Log.e(TAG, "Ошибка отправки события клика", e);
            }
        }
        
        // Уведомляем слушателя
        if (listener != null) {
            PushNotification notification = new PushNotification();
            notification.id = notificationId;
            notification.url = url;
            try {
                notification.data = data != null ? new JSONObject(data) : null;
            } catch (JSONException e) {
                notification.data = null;
            }
            mainHandler.post(() -> listener.onNotificationClicked(notification));
        }
        
        // Открываем URL если указан
        if (url != null && !url.isEmpty()) {
            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(browserIntent);
        }
    }
}

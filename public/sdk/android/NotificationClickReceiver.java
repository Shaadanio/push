package com.pushsdk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * BroadcastReceiver для обработки кликов по уведомлениям
 */
public class NotificationClickReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String notificationId = intent.getStringExtra("notification_id");
        String url = intent.getStringExtra("url");
        String data = intent.getStringExtra("data");
        
        PushSDK.getInstance(context).handleNotificationClick(notificationId, url, data);
    }
}

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');

// Создаём директорию для базы данных если её нет
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.database.path);

// Включаем WAL режим для лучшей производительности
db.pragma('journal_mode = WAL');

// Инициализация схемы базы данных
function initializeDatabase() {
  // Таблица приложений/проектов
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      api_secret TEXT NOT NULL,
      owner_id TEXT,
      vapid_public_key TEXT,
      vapid_private_key TEXT,
      apns_enabled INTEGER DEFAULT 0,
      android_enabled INTEGER DEFAULT 1,
      web_push_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);
  
  // Добавляем owner_id если его нет (миграция)
  try {
    db.exec(`ALTER TABLE applications ADD COLUMN owner_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL`);
  } catch (e) {
    // Колонка уже существует
  }
  
  // Таблица устройств/подписок
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('web', 'ios', 'android')),
      token TEXT NOT NULL,
      endpoint TEXT,
      p256dh TEXT,
      auth TEXT,
      user_id TEXT,
      tags TEXT DEFAULT '[]',
      language TEXT DEFAULT 'ru',
      timezone TEXT,
      device_model TEXT,
      os_version TEXT,
      app_version TEXT,
      is_active INTEGER DEFAULT 1,
      last_active TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE,
      UNIQUE(app_id, token)
    )
  `);
  
  // Индексы для устройств
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_app_id ON devices(app_id);
    CREATE INDEX IF NOT EXISTS idx_devices_platform ON devices(platform);
    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_is_active ON devices(is_active);
  `);
  
  // Таблица уведомлений (история отправок)
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      icon TEXT,
      image TEXT,
      url TEXT,
      data TEXT,
      segment TEXT,
      tags TEXT,
      scheduled_at TEXT,
      sent_at TEXT,
      total_sent INTEGER DEFAULT 0,
      total_delivered INTEGER DEFAULT 0,
      total_clicked INTEGER DEFAULT 0,
      total_failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'scheduled', 'sending', 'completed', 'failed', 'cancelled')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    )
  `);
  
  // Индексы для уведомлений
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_app_id ON notifications(app_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_at ON notifications(scheduled_at);
  `);
  
  // Таблица доставок (детали по каждому устройству)
  db.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'delivered', 'clicked', 'failed')),
      error_message TEXT,
      sent_at TEXT,
      delivered_at TEXT,
      clicked_at TEXT,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);
  
  // Индексы для доставок
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_deliveries_notification_id ON deliveries(notification_id);
    CREATE INDEX IF NOT EXISTS idx_deliveries_device_id ON deliveries(device_id);
    CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
  `);
  
  // Таблица пользователей админ-панели
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'editor', 'viewer')),
      last_login TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Таблица подписок
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free',
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);
  
  // Индекс для подписок
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan);
  `);
  
  // Таблица сегментов
  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      filters TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    )
  `);
  
  // Таблица шаблонов уведомлений
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      icon TEXT,
      image TEXT,
      url TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    )
  `);

  console.log('✓ База данных инициализирована');
}

module.exports = { db, initializeDatabase };

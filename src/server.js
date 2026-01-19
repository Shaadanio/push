require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { config, validateConfig } = require('./config');
const { initializeDatabase, db } = require('./database');
const { webPushProvider, apnsProvider, androidPushProvider } = require('./providers');
const routes = require('./routes');
const { generalLimiter } = require('./middleware');
const scheduler = require('./scheduler');

const app = express();

// Trust proxy (для работы за nginx/reverse proxy)
app.set('trust proxy', 1);

// Валидация конфигурации
const warnings = validateConfig();
warnings.forEach(w => console.warn('⚠', w));

// Инициализация базы данных
initializeDatabase();

// Инициализация провайдеров push-уведомлений
webPushProvider.initialize();
apnsProvider.initialize();
// Android Push инициализируется после запуска HTTP сервера (нужен для WebSocket)

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Отключаем для админ-панели
}));
app.use(cors());
app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting (общий)
if (config.nodeEnv === 'production') {
  app.use(generalLimiter);
}

// Статические файлы для админ-панели
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));

// Файлы верификации и другие статические файлы в корне
app.use(express.static(path.join(__dirname, '../public'), {
  index: false // не показывать index.html автоматически
}));

// SPA роутинг для админки - все под-пути возвращают index.html
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// Файлы SDK для клиентов (с CORS для кросс-доменных запросов)
app.use('/sdk', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../public/sdk')));

// API маршруты
app.use('/api/v1', routes);

// Service Worker для Web Push
app.get('/push-sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '../public/sdk/push-sw.js'));
});

// Health check endpoint для мониторинга
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'push-notification-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: require('../package.json').version
  });
});

// Тестовый эндпоинт для проверки статистики (можно вызвать из браузера)
app.get('/test-stats/:notificationId', (req, res) => {
  const { notificationService } = require('./services');
  try {
    notificationService.trackDelivery(req.params.notificationId, 'test-device');
    console.log(`[TEST-DELIVERED] notificationId=${req.params.notificationId}`);
    res.json({ success: true, message: 'Delivery tracked' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/test-click/:notificationId', (req, res) => {
  const { notificationService } = require('./services');
  try {
    notificationService.trackClick(req.params.notificationId, 'test-device');
    console.log(`[TEST-CLICK] notificationId=${req.params.notificationId}`);
    res.json({ success: true, message: 'Click tracked' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Диагностика: последние уведомления со статистикой
app.get('/debug/notifications', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, title, body, total_sent, total_delivered, total_clicked, created_at 
      FROM notifications 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    const notifications = stmt.all();
    res.json({ success: true, notifications });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Диагностика: проверка что лежит в deliveries
app.get('/debug/deliveries/:notificationId', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT * FROM deliveries 
      WHERE notification_id = ?
    `);
    const deliveries = stmt.all(req.params.notificationId);
    res.json({ success: true, deliveries });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Главная (landing) страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: 'Маршрут не найден'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Ошибка:', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: err.code || 'INTERNAL_ERROR',
    message: config.nodeEnv === 'production' 
      ? 'Внутренняя ошибка сервера' 
      : err.message
  });
});

// Запуск сервера
const server = app.listen(config.port, () => {
  // Инициализация WebSocket для Android после запуска HTTP сервера
  androidPushProvider.initialize(server);
  
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   🔔 Push Notification Service                           ║');
  console.log('║                                                           ║');
  console.log(`║   Сервер запущен на порту ${config.port}                           ║`);
  console.log(`║   Режим: ${config.nodeEnv.padEnd(47)}║`);
  console.log('║                                                           ║');
  console.log('║   API:         http://localhost:' + config.port + '/api/v1              ║');
  console.log('║   Админ-панель: http://localhost:' + config.port + '/admin              ║');
  console.log('║   Android WS:  ws://localhost:' + config.port + '/ws/android            ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
});

// Запуск планировщика
scheduler.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Получен SIGTERM, завершение работы...');
  scheduler.stop();
  apnsProvider.shutdown();
  server.close(() => {
    console.log('Сервер остановлен');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Получен SIGINT, завершение работы...');
  scheduler.stop();
  apnsProvider.shutdown();
  server.close(() => {
    console.log('Сервер остановлен');
    process.exit(0);
  });
});

module.exports = app;

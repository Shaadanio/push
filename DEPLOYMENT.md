# Инструкция по разворачиванию Push Notification Service

## Быстрые команды Ubuntu (Шпаргалка)

```bash
# ═══════════════════════════════════════════════════════════════
# УСТАНОВКА (выполнить один раз)
# ═══════════════════════════════════════════════════════════════

# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# Установка PM2
sudo npm install -g pm2

# Клонирование проекта
cd /opt
sudo git clone https://your-repo.git notif
sudo chown -R $USER:$USER notif
cd notif

# Установка зависимостей
npm ci --only=production

# Генерация VAPID ключей
npm run generate-vapid

# Настройка конфигурации
cp .env.example .env
nano .env

# Запуск сервиса
pm2 start src/server.js --name push-service
pm2 save
pm2 startup

# ═══════════════════════════════════════════════════════════════
# УПРАВЛЕНИЕ СЕРВИСОМ
# ═══════════════════════════════════════════════════════════════

pm2 status                    # Статус сервисов
pm2 logs push-service         # Просмотр логов
pm2 logs push-service --lines 100  # Последние 100 строк
pm2 restart push-service      # Перезапуск
pm2 stop push-service         # Остановка
pm2 delete push-service       # Удаление из PM2
pm2 monit                     # Мониторинг в реальном времени

# ═══════════════════════════════════════════════════════════════
# ОБНОВЛЕНИЕ
# ═══════════════════════════════════════════════════════════════

cd /opt/notif
git pull
npm ci --only=production
pm2 restart push-service

# ═══════════════════════════════════════════════════════════════
# NGINX
# ═══════════════════════════════════════════════════════════════

sudo nano /etc/nginx/sites-available/push-service  # Редактировать конфиг
sudo ln -s /etc/nginx/sites-available/push-service /etc/nginx/sites-enabled/
sudo nginx -t                 # Проверить конфигурацию
sudo systemctl reload nginx   # Перезагрузить Nginx
sudo systemctl status nginx   # Статус Nginx

# ═══════════════════════════════════════════════════════════════
# SSL (LET'S ENCRYPT)
# ═══════════════════════════════════════════════════════════════

sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d push.yourdomain.com
sudo certbot renew --dry-run  # Тест автообновления

# ═══════════════════════════════════════════════════════════════
# ДИАГНОСТИКА
# ═══════════════════════════════════════════════════════════════

curl http://localhost:3000/health     # Проверка здоровья
sudo netstat -tlnp | grep 3000        # Проверка порта
sudo lsof -i :3000                    # Кто использует порт
htop                                  # Мониторинг ресурсов
df -h                                 # Место на диске
free -m                               # Память

# ═══════════════════════════════════════════════════════════════
# БАЗА ДАННЫХ (SQLite)
# ═══════════════════════════════════════════════════════════════

# Бэкап
cp /opt/notif/data/push.db /var/backups/push_$(date +%Y%m%d).db

# Просмотр (установить sqlite3)
sudo apt install sqlite3
sqlite3 /opt/notif/data/push.db ".tables"
sqlite3 /opt/notif/data/push.db "SELECT COUNT(*) FROM devices;"

# ═══════════════════════════════════════════════════════════════
# FIREWALL (UFW)
# ═══════════════════════════════════════════════════════════════

sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable

# ═══════════════════════════════════════════════════════════════
# ЛОГИ
# ═══════════════════════════════════════════════════════════════

pm2 logs push-service                              # Логи PM2
sudo tail -f /var/log/nginx/push-service.access.log  # Логи Nginx
sudo tail -f /var/log/nginx/push-service.error.log   # Ошибки Nginx
journalctl -u nginx -f                             # Системные логи Nginx
```

---

## Требования к серверу

- **ОС**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+) или Windows Server
- **Node.js**: 18.x или выше
- **RAM**: минимум 512 MB (рекомендуется 1 GB+)
- **CPU**: 1 ядро (рекомендуется 2+)
- **Диск**: 1 GB свободного места
- **Сеть**: открытые порты 80, 443 (HTTPS обязателен для Web Push)

## Быстрый старт (Linux)

### 1. Установка Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Проверка версии
node --version
npm --version
```

### 2. Клонирование и установка

```bash
# Клонирование репозитория
cd /opt
git clone https://your-repo.git notif
cd notif

# Установка зависимостей
npm ci --only=production

# Или для разработки
npm install
```

### 3. Генерация VAPID ключей

```bash
npm run generate-vapid
```
Скопируйте сгенерированные ключи в `.env` файл.

### 4. Настройка окружения

```bash
# Копирование примера конфигурации
cp .env.example .env

# Редактирование конфигурации
nano .env
```

**Обязательные переменные:**

```env
# Сервер
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Безопасность (ОБЯЗАТЕЛЬНО ИЗМЕНИТЕ!)
API_SECRET_KEY=your-super-secret-key-change-me-in-production
JWT_SECRET=your-jwt-secret-change-me-too

# VAPID ключи (из шага 3)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:admin@yourdomain.com
```

**Для iOS (опционально):**

```env
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=com.yourcompany.app
APNS_PRODUCTION=true
```

### 5. Настройка iOS (APNS)

Если вы используете iOS push-уведомления:

```bash
# Создание директории для сертификатов
mkdir -p certs

# Скопируйте .p8 ключ
cp /path/to/AuthKey_XXXXXXXXXX.p8 certs/apns-key.p8

# Установите права доступа
chmod 600 certs/apns-key.p8
```

### 6. Запуск сервиса

#### Вариант A: PM2 (рекомендуется)

```bash
# Установка PM2
sudo npm install -g pm2

# Запуск приложения
pm2 start src/server.js --name "push-service"

# Автозапуск при перезагрузке
pm2 startup
pm2 save

# Полезные команды
pm2 status           # Статус
pm2 logs push-service # Логи
pm2 restart push-service # Перезапуск
pm2 stop push-service    # Остановка
```

**Расширенная конфигурация PM2 (ecosystem.config.js):**

```javascript
module.exports = {
  apps: [{
    name: 'push-service',
    script: 'src/server.js',
    instances: 'max',  // Кластеризация
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production'
    },
    max_memory_restart: '500M',
    error_file: '/var/log/push-service/error.log',
    out_file: '/var/log/push-service/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

```bash
# Запуск с конфигурацией
pm2 start ecosystem.config.js --env production
```

#### Вариант B: Systemd

```bash
# Создание systemd сервиса
sudo nano /etc/systemd/system/push-service.service
```

```ini
[Unit]
Description=Push Notification Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/notif
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=push-service
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Активация и запуск
sudo systemctl daemon-reload
sudo systemctl enable push-service
sudo systemctl start push-service

# Проверка статуса
sudo systemctl status push-service

# Просмотр логов
sudo journalctl -u push-service -f
```

### 7. Настройка Nginx (reverse proxy)

```bash
sudo nano /etc/nginx/sites-available/push-service
```

```nginx
# Upstream для балансировки (опционально)
upstream push_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name push.yourdomain.com;
    
    # Редирект на HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name push.yourdomain.com;

    # SSL сертификаты (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/push.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/push.yourdomain.com/privkey.pem;
    
    # SSL настройки
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Безопасность
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Логи
    access_log /var/log/nginx/push-service.access.log;
    error_log /var/log/nginx/push-service.error.log;

    # Основной location
    location / {
        proxy_pass http://push_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Таймауты
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket для Android (ВАЖНО!)
    location /ws/android {
        proxy_pass http://push_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Длинные таймауты для WebSocket
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # Статические файлы (SDK, админ-панель)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://push_backend;
        proxy_cache_valid 200 1d;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# Активация конфигурации
sudo ln -s /etc/nginx/sites-available/push-service /etc/nginx/sites-enabled/

# Проверка конфигурации
sudo nginx -t

# Перезапуск Nginx
sudo systemctl reload nginx
```

### 8. SSL сертификат (Let's Encrypt)

```bash
# Установка Certbot
sudo apt install certbot python3-certbot-nginx

# Получение сертификата
sudo certbot --nginx -d push.yourdomain.com

# Автообновление (уже настроено)
sudo certbot renew --dry-run
```

---

## Docker развёртывание

### Dockerfile

```dockerfile
FROM node:18-alpine

# Метаданные
LABEL maintainer="your@email.com"
LABEL description="Push Notification Service"

# Рабочая директория
WORKDIR /app

# Копирование зависимостей
COPY package*.json ./

# Установка зависимостей
RUN npm ci --only=production && npm cache clean --force

# Копирование кода
COPY . .

# Создание директорий
RUN mkdir -p data certs

# Непривилегированный пользователь
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

# Порт
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Запуск
CMD ["node", "src/server.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  push-service:
    build: .
    container_name: push-service
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - API_SECRET_KEY=${API_SECRET_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
      - VAPID_SUBJECT=${VAPID_SUBJECT}
    volumes:
      - ./data:/app/data          # База данных SQLite
      - ./certs:/app/certs:ro     # Сертификаты (только чтение)
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  nginx:
    image: nginx:alpine
    container_name: push-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on:
      - push-service
```

### Запуск Docker

```bash
# Создание .env файла
cp .env.example .env
nano .env

# Сборка и запуск
docker-compose up -d --build

# Просмотр логов
docker-compose logs -f push-service

# Остановка
docker-compose down
```

---

## Windows Server

### 1. Установка Node.js

Скачайте и установите Node.js с https://nodejs.org/

### 2. Установка как Windows Service

```powershell
# Установка node-windows
npm install -g node-windows

# В директории проекта
npm link node-windows
```

Создайте файл `install-service.js`:

```javascript
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'Push Notification Service',
  description: 'Собственный сервис push-уведомлений',
  script: 'C:\\path\\to\\notif\\src\\server.js',
  nodeOptions: [],
  env: [{
    name: 'NODE_ENV',
    value: 'production'
  }]
});

svc.on('install', () => {
  svc.start();
  console.log('Сервис установлен и запущен');
});

svc.install();
```

```powershell
node install-service.js
```

### 3. IIS как Reverse Proxy

Установите модули:
- URL Rewrite
- Application Request Routing (ARR)

Конфигурация `web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3000/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <webSocket enabled="true" />
  </system.webServer>
</configuration>
```

---

## Мониторинг и обслуживание

### Health Check эндпоинт

Добавьте в сервер (если не добавлен):

```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
```

### Мониторинг с PM2

```bash
# Веб-интерфейс мониторинга
pm2 install pm2-server-monit

# Мониторинг в реальном времени
pm2 monit
```

### Бэкап базы данных

```bash
# Создание скрипта бэкапа
nano /opt/notif/scripts/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/push-service"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Бэкап SQLite базы
cp /opt/notif/data/push.db "$BACKUP_DIR/push_$DATE.db"

# Удаление старых бэкапов (старше 7 дней)
find $BACKUP_DIR -name "*.db" -mtime +7 -delete

echo "Backup completed: push_$DATE.db"
```

```bash
chmod +x /opt/notif/scripts/backup.sh

# Добавление в cron (ежедневно в 3:00)
echo "0 3 * * * /opt/notif/scripts/backup.sh" | crontab -
```

### Ротация логов

```bash
sudo nano /etc/logrotate.d/push-service
```

```
/var/log/push-service/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

## Проверка работоспособности

После развёртывания выполните проверки:

```bash
# 1. Проверка здоровья сервиса
curl https://push.yourdomain.com/health

# 2. Проверка админ-панели
curl -I https://push.yourdomain.com/admin

# 3. Проверка WebSocket (должен вернуть upgrade required)
curl -I https://push.yourdomain.com/ws/android

# 4. Проверка API
curl https://push.yourdomain.com/api/v1/health
```

### Первоначальная настройка

1. Откройте https://push.yourdomain.com/admin
2. Создайте первого администратора
3. Создайте приложение и получите API ключи
4. Интегрируйте SDK в ваши приложения

---

## Troubleshooting

### Сервис не запускается

```bash
# Проверка логов
pm2 logs push-service --lines 100
# или
journalctl -u push-service -n 100

# Проверка портов
sudo netstat -tlnp | grep 3000
sudo lsof -i :3000
```

### WebSocket не работает

1. Проверьте настройки Nginx (proxy_set_header Upgrade)
2. Проверьте firewall
3. Убедитесь что таймауты достаточно большие

```bash
# Тест WebSocket
wscat -c wss://push.yourdomain.com/ws/android
```

### Проблемы с APNS

```bash
# Проверка сертификата
openssl x509 -in certs/apns-key.p8 -text -noout

# Проверка подключения к APNS
curl -v https://api.push.apple.com
```

### Высокая нагрузка

```bash
# Мониторинг процесса
htop
pm2 monit

# Увеличение лимитов
ulimit -n 65535
```

---

## Контакты и поддержка

При возникновении проблем:
1. Проверьте логи приложения
2. Проверьте документацию в README.md
3. Создайте issue в репозитории


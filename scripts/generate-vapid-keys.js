const webPush = require('web-push');
const fs = require('fs');
const path = require('path');

// Генерация VAPID ключей
const vapidKeys = webPush.generateVAPIDKeys();

console.log('');
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║           VAPID Keys Generated Successfully               ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
console.log('Добавьте следующие переменные в ваш .env файл:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log('');

// Также записываем в файл для удобства
const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  // Копируем .env.example в .env и добавляем ключи
  let envContent = fs.readFileSync(envExamplePath, 'utf-8');
  envContent = envContent.replace('VAPID_PUBLIC_KEY=', `VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  envContent = envContent.replace('VAPID_PRIVATE_KEY=', `VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  fs.writeFileSync(envPath, envContent);
  console.log('✓ Создан .env файл с VAPID ключами');
} else if (fs.existsSync(envPath)) {
  console.log('⚠ .env файл уже существует. Обновите VAPID ключи вручную.');
}

console.log('');

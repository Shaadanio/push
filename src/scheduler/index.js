const cron = require('node-cron');
const { notificationService, applicationService } = require('../services');

class Scheduler {
  constructor() {
    this.jobs = [];
  }
  
  /**
   * Запуск планировщика
   */
  start() {
    // Проверка запланированных уведомлений каждую минуту
    const scheduledJob = cron.schedule('* * * * *', async () => {
      await this.processScheduledNotifications();
    });
    this.jobs.push(scheduledJob);
    
    console.log('✓ Планировщик запущен');
  }
  
  /**
   * Обработка запланированных уведомлений
   */
  async processScheduledNotifications() {
    try {
      const scheduled = notificationService.getScheduled();
      
      for (const notification of scheduled) {
        console.log(`Отправка запланированного уведомления: ${notification.id}`);
        
        try {
          const app = applicationService.getById(notification.appId);
          if (!app) {
            console.error(`Приложение не найдено для уведомления ${notification.id}`);
            continue;
          }
          
          await notificationService.send(
            notification.appId,
            {
              title: notification.title,
              body: notification.body,
              icon: notification.icon,
              image: notification.image,
              url: notification.url,
              data: notification.data
            },
            {
              tags: notification.tags,
              segment: notification.segment
            }
          );
        } catch (error) {
          console.error(`Ошибка отправки запланированного уведомления ${notification.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Ошибка в планировщике:', error);
    }
  }
  
  /**
   * Остановка планировщика
   */
  stop() {
    this.jobs.forEach(job => job.stop());
    console.log('Планировщик остановлен');
  }
}

module.exports = new Scheduler();

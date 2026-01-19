const { db } = require('../database');
const { v4: uuidv4 } = require('uuid');

// Лимиты для тарифных планов
const PLAN_LIMITS = {
  free: {
    web: 1,
    ios: 1,
    android: 1,
    totalApps: 3,
    name: 'Free',
    price: 0
  },
  starter: {
    web: 5,
    ios: 5,
    android: 5,
    totalApps: 15,
    name: 'Starter',
    price: null // Цена уточняется
  },
  pro: {
    web: Infinity,
    ios: Infinity,
    android: Infinity,
    totalApps: Infinity,
    name: 'Pro',
    price: null // Цена уточняется
  }
};

class SubscriptionService {
  /**
   * Получение подписки пользователя
   */
  getByUserId(userId) {
    const stmt = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?');
    const subscription = stmt.get(userId);
    
    if (!subscription) {
      // Создаём бесплатную подписку по умолчанию
      return this.create(userId, 'free');
    }
    
    return this._formatSubscription(subscription);
  }
  
  /**
   * Создание подписки
   */
  create(userId, plan = 'free') {
    const id = uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO subscriptions (id, user_id, plan, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    
    try {
      stmt.run(id, userId, plan);
    } catch (error) {
      // Если подписка уже существует, возвращаем её
      if (error.code === 'SQLITE_CONSTRAINT') {
        return this.getByUserId(userId);
      }
      throw error;
    }
    
    return this._formatSubscription({
      id,
      user_id: userId,
      plan,
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
  
  /**
   * Обновление плана подписки
   */
  updatePlan(userId, plan, expiresAt = null) {
    const stmt = db.prepare(`
      UPDATE subscriptions 
      SET plan = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = ?
    `);
    
    stmt.run(plan, expiresAt, userId);
    return this.getByUserId(userId);
  }
  
  /**
   * Получение лимитов для плана
   */
  getPlanLimits(plan) {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  }
  
  /**
   * Подсчёт приложений пользователя по платформам
   */
  getUserAppCounts(userId) {
    const stmt = db.prepare(`
      SELECT 
        SUM(CASE WHEN web_push_enabled = 1 THEN 1 ELSE 0 END) as web,
        SUM(CASE WHEN apns_enabled = 1 THEN 1 ELSE 0 END) as ios,
        SUM(CASE WHEN android_enabled = 1 THEN 1 ELSE 0 END) as android,
        COUNT(*) as total
      FROM applications 
      WHERE owner_id = ?
    `);
    
    const counts = stmt.get(userId);
    return {
      web: counts?.web || 0,
      ios: counts?.ios || 0,
      android: counts?.android || 0,
      total: counts?.total || 0
    };
  }
  
  /**
   * Проверка возможности создания приложения
   */
  canCreateApp(userId, platforms = { web: false, ios: false, android: false }) {
    const subscription = this.getByUserId(userId);
    const limits = this.getPlanLimits(subscription.plan);
    const counts = this.getUserAppCounts(userId);
    
    // Проверяем истечение подписки
    if (subscription.expiresAt && new Date(subscription.expiresAt) < new Date()) {
      // Подписка истекла, применяем лимиты free
      const freeLimits = PLAN_LIMITS.free;
      
      if (platforms.web && counts.web >= freeLimits.web) {
        return { allowed: false, reason: 'WEB_LIMIT_REACHED', limit: freeLimits.web, current: counts.web };
      }
      if (platforms.ios && counts.ios >= freeLimits.ios) {
        return { allowed: false, reason: 'IOS_LIMIT_REACHED', limit: freeLimits.ios, current: counts.ios };
      }
      if (platforms.android && counts.android >= freeLimits.android) {
        return { allowed: false, reason: 'ANDROID_LIMIT_REACHED', limit: freeLimits.android, current: counts.android };
      }
      
      return { allowed: true };
    }
    
    // Проверяем лимиты
    if (platforms.web && counts.web >= limits.web) {
      return { allowed: false, reason: 'WEB_LIMIT_REACHED', limit: limits.web, current: counts.web };
    }
    if (platforms.ios && counts.ios >= limits.ios) {
      return { allowed: false, reason: 'IOS_LIMIT_REACHED', limit: limits.ios, current: counts.ios };
    }
    if (platforms.android && counts.android >= limits.android) {
      return { allowed: false, reason: 'ANDROID_LIMIT_REACHED', limit: limits.android, current: counts.android };
    }
    
    return { allowed: true };
  }
  
  /**
   * Получение информации о подписке с использованием
   */
  getSubscriptionInfo(userId) {
    const subscription = this.getByUserId(userId);
    const limits = this.getPlanLimits(subscription.plan);
    const counts = this.getUserAppCounts(userId);
    
    return {
      ...subscription,
      limits,
      usage: counts,
      remaining: {
        web: Math.max(0, limits.web - counts.web),
        ios: Math.max(0, limits.ios - counts.ios),
        android: Math.max(0, limits.android - counts.android)
      }
    };
  }
  
  /**
   * Получение всех подписок (для админа)
   */
  getAll() {
    const stmt = db.prepare(`
      SELECT s.*, u.email, u.name 
      FROM subscriptions s
      JOIN admin_users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);
    
    return stmt.all().map(s => this._formatSubscription(s));
  }
  
  _formatSubscription(sub) {
    return {
      id: sub.id,
      userId: sub.user_id,
      plan: sub.plan,
      expiresAt: sub.expires_at,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
      userEmail: sub.email,
      userName: sub.name
    };
  }
}

module.exports = new SubscriptionService();

const express = require('express');
const router = express.Router();

const devicesRouter = require('./devices');
const notificationsRouter = require('./notifications');
const adminRouter = require('./admin');

// API маршруты
router.use('/devices', devicesRouter);
router.use('/notifications', notificationsRouter);
router.use('/admin', adminRouter);

// Healthcheck
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

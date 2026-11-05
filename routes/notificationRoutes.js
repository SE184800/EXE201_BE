const express = require('express');
const notificationService = require('../services/notificationService');

function createNotificationRoutes(prisma, requireAuth) {
  const router = express.Router();

  // GET /api/notifications
  router.get('/', requireAuth(), async (req, res, next) => {
    try {
      const userId = req.auth.user.id;
      const { page, limit, unreadOnly } = req.query;
      const result = await notificationService.getNotifications(userId, {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      });
      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/notifications/unread-count
  router.get('/unread-count', requireAuth(), async (req, res, next) => {
    try {
      const userId = req.auth.user.id;
      const unreadCount = await notificationService.getUnreadCount(userId);
      res.json({
        success: true,
        unreadCount,
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/notifications/:id/read
  router.patch('/:id/read', requireAuth(), async (req, res, next) => {
    try {
      const userId = req.auth.user.id;
      const { id } = req.params;
      const updated = await notificationService.markAsRead(userId, id);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo.' });
      }
      res.json({
        success: true,
        notification: updated,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/notifications/mark-all-read
  router.post('/mark-all-read', requireAuth(), async (req, res, next) => {
    try {
      const userId = req.auth.user.id;
      const result = await notificationService.markAllAsRead(userId);
      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/notifications/:id
  router.delete('/:id', requireAuth(), async (req, res, next) => {
    try {
      const userId = req.auth.user.id;
      const { id } = req.params;
      const deleted = await notificationService.deleteNotification(userId, id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo.' });
      }
      res.json({
        success: true,
        message: 'Đã xóa thông báo.',
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createNotificationRoutes };

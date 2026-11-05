const fs = require('node:fs');
const documents = require('./documentStorage');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const dataDir = path.join(__dirname, '../data');
const notifFile = path.join(dataDir, 'notifications.json');

let notifCache = null;

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(notifFile)) {
    fs.writeFileSync(notifFile, JSON.stringify([], null, 2), 'utf8');
  }
}

function loadNotifications() {
  if (documents.active()) return documents.readDocument('notifications', []);
  ensureDataFile();
  if (notifCache) return notifCache;
  try {
    notifCache = JSON.parse(fs.readFileSync(notifFile, 'utf8'));
    if (!Array.isArray(notifCache)) notifCache = [];
  } catch (err) {
    console.error('Không thể đọc notifications.json:', err.message);
    notifCache = [];
  }
  return notifCache;
}

function persistNotifications() {
  if (documents.active()) return documents.writeDocument('notifications', documents.readDocument('notifications', []));
  ensureDataFile();
  try {
    const tempFile = `${notifFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(notifCache, null, 2), 'utf8');
    fs.renameSync(tempFile, notifFile);
  } catch (err) {
    console.error('Không thể ghi notifications.json:', err.message);
  }
}

async function createNotification({
  userId,
  title,
  message,
  type = 'INFO',
  orderId = null,
  link = null,
  metadata = null,
}) {
  if (!userId) return null;

  const notifications = loadNotifications();
  const notification = {
    id: `notif-${Date.now()}-${randomUUID().slice(0, 8)}`,
    userId: Number(userId),
    title: String(title || 'Thông báo mới').trim(),
    message: String(message || '').trim(),
    type: String(type || 'INFO').toUpperCase(),
    orderId: orderId ? Number(orderId) : null,
    link: link || (orderId ? `/orders?id=${orderId}` : null),
    metadata: metadata || null,
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  notifications.unshift(notification);

  // Keep last 1000 notifications in storage
  if (notifications.length > 1000) {
    notifications.length = 1000;
  }

  persistNotifications();
  return notification;
}

async function getNotifications(userId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const numUserId = Number(userId);
  const notifications = loadNotifications();
  let userNotifs = notifications.filter((n) => n.userId === numUserId);

  if (unreadOnly) {
    userNotifs = userNotifs.filter((n) => !n.isRead);
  }

  const total = userNotifs.length;
  const unreadCount = notifications.filter((n) => n.userId === numUserId && !n.isRead).length;

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(limit) || 20));
  const startIndex = (pageNum - 1) * pageSize;
  const items = userNotifs.slice(startIndex, startIndex + pageSize);

  return {
    items,
    total,
    unreadCount,
    page: pageNum,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
}

async function getUnreadCount(userId) {
  const numUserId = Number(userId);
  const notifications = loadNotifications();
  return notifications.filter((n) => n.userId === numUserId && !n.isRead).length;
}

async function markAsRead(userId, notificationId) {
  const numUserId = Number(userId);
  const notifications = loadNotifications();
  const target = notifications.find((n) => n.id === notificationId && n.userId === numUserId);
  if (!target) return null;
  target.isRead = true;
  persistNotifications();
  return target;
}

async function markAllAsRead(userId) {
  const numUserId = Number(userId);
  const notifications = loadNotifications();
  let count = 0;
  for (const n of notifications) {
    if (n.userId === numUserId && !n.isRead) {
      n.isRead = true;
      count += 1;
    }
  }
  if (count > 0) persistNotifications();
  return { updatedCount: count };
}

async function deleteNotification(userId, notificationId) {
  const numUserId = Number(userId);
  const notifications = loadNotifications();
  const index = notifications.findIndex((n) => n.id === notificationId && n.userId === numUserId);
  if (index === -1) return false;
  notifications.splice(index, 1);
  persistNotifications();
  return true;
}

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};

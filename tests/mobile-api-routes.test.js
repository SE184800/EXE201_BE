const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { createNotificationRoutes } = require('../routes/notificationRoutes');
const notifications = require('../services/notificationService');

// Examine actual mounted Express layers: a global auth gate returning 401 does
// not prove that the endpoint exists behind it. Never invoke business mutations.
function registered(stack, method, url) {
  return stack.some(layer => {
    if (!layer.match(url)) return false;
    if (layer.route) return Boolean(layer.route.methods[method]);
    return layer.handle?.stack && registered(layer.handle.stack, method, url.slice(layer.path.length) || '/');
  });
}
const config = readConfig({ JWT_SECRET: 'mobile-route-test-only-secret-not-a-real-key', FRONTEND_URL: 'http://localhost:5173' });
const app = createApp({}, config);
const routes = [
  ['get', '/inventory'], ['get', '/inventory/history'], ['get', '/inventory/revenue'],
  ['post', '/inventory/sales/batch'], ['post', '/inventory/7/movements'],
  ['get', '/orders'], ['post', '/orders'], ['post', '/orders/7/deposit'],
  ['post', '/orders/7/deposit/wallet'], ['post', '/orders/7/reschedule'], ['post', '/orders/7/cancel'],
  ['post', '/orders/7/approve'], ['post', '/orders/7/confirm-arrival'], ['post', '/orders/7/pay'],
  ['post', '/orders/7/complete'], ['get', '/orders/7/import-inventory'], ['post', '/orders/7/import-inventory'],
  ['get', '/wallet'], ['get', '/wallet/transactions'], ['get', '/wallet/payments'],
  ['get', '/wallet/qr-config'], ['post', '/wallet/deposits/qr'], ['get', '/wallet/deposits/qr/7'],
  ['get', '/wallet/deposits'], ['post', '/wallet/withdrawals'], ['get', '/wallet/withdrawals'],
  ['get', '/profile'], ['put', '/profile'], ['post', '/profile/upload-bank-qr'],
  ['get', '/profile/store'], ['put', '/profile/store'], ['get', '/profile/verify-address'],
  ['get', '/subscription'], ['post', '/subscription/renew'],
  ['get', '/notifications'], ['get', '/notifications/unread-count'],
  ['patch', '/notifications/notif-test/read'], ['post', '/notifications/mark-all-read'], ['delete', '/notifications/notif-test'],
  ['post', '/complaints'], ['post', '/complaints/7/respond'],
  ['get', '/auth/me'], ['post', '/auth/login'], ['post', '/auth/logout'],
];
test('APK inventory, sales, orders, wallet, account and notification routes are mounted', () => {
  for (const [method, path] of routes)
    assert.ok(registered(app._router.stack, method, '/api' + path), `${method.toUpperCase()} /api${path}`);
  assert.equal(registered(app._router.stack, 'get', '/api/does-not-exist'), false);
});
test('mounted notification endpoints require a session', async () => {
  for (const [method, path] of routes.filter(([, path]) => path.startsWith('/notifications')))
    await request(app)[method]('/api' + path).set('Origin', config.origin).set('X-CSRF-Protection', 'sg-restock-web').expect(401);
});
test('notification router uses authenticated owner and preserves business 404s', async t => {
  const routerApp = express();
  let authCalls = 0;
  routerApp.use('/api/notifications', createNotificationRoutes({}, (req, res, next) => {
    authCalls++;
    req.auth = { user: { id: 17 } };
    next();
  }));
  t.mock.method(notifications, 'getNotifications', async (id, options) => {
    assert.equal(id, 17); assert.equal(options.page, 2);
    return { items: [], unreadCount: 0, page: 2 };
  });
  t.mock.method(notifications, 'getUnreadCount', async id => { assert.equal(id, 17); return 3; });
  t.mock.method(notifications, 'markAsRead', async (id, key) => { assert.equal(id, 17); return key === 'owned' ? { id: key, isRead: true } : null; });
  t.mock.method(notifications, 'markAllAsRead', async id => { assert.equal(id, 17); return { updatedCount: 3 }; });
  t.mock.method(notifications, 'deleteNotification', async (id, key) => { assert.equal(id, 17); return key === 'owned'; });
  await request(routerApp).get('/api/notifications?page=2&userId=99').expect(200);
  const count = await request(routerApp).get('/api/notifications/unread-count').expect(200);
  assert.equal(count.body.unreadCount, 3);
  await request(routerApp).patch('/api/notifications/owned/read').expect(200);
  const missing = await request(routerApp).patch('/api/notifications/foreign/read').expect(404);
  assert.equal(missing.body.code, undefined);
  await request(routerApp).post('/api/notifications/mark-all-read').expect(200);
  await request(routerApp).delete('/api/notifications/foreign').expect(404);
  await request(routerApp).delete('/api/notifications/owned').expect(200);
  assert.equal(authCalls, 7);
});

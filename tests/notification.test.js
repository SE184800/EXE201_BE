const test = require('node:test');
const assert = require('node:assert/strict');
const notificationService = require('../services/notificationService');

test('Notification Service Test Suite', async (t) => {
  const testUserId = 999991;

  await t.test('1. Create notification with valid data', async () => {
    const notif = await notificationService.createNotification({
      userId: testUserId,
      title: 'Đơn hàng mới #101',
      message: 'Cửa hàng đã đặt đơn hàng mới.',
      type: 'ORDER_CREATED',
      orderId: 101,
      link: '/supplier/orders',
    });

    assert.ok(notif, 'Notification should be created');
    assert.equal(notif.userId, testUserId);
    assert.equal(notif.title, 'Đơn hàng mới #101');
    assert.equal(notif.isRead, false);
    assert.equal(notif.orderId, 101);
  });

  await t.test('2. Get notifications and unread count', async () => {
    const list = await notificationService.getNotifications(testUserId);
    assert.ok(list.total >= 1, 'Should have at least 1 notification');
    assert.ok(list.unreadCount >= 1, 'Unread count should be >= 1');

    const unread = await notificationService.getUnreadCount(testUserId);
    assert.equal(unread, list.unreadCount);
  });

  await t.test('3. Mark single notification as read', async () => {
    const list = await notificationService.getNotifications(testUserId);
    const first = list.items[0];
    assert.ok(first, 'First item must exist');

    const updated = await notificationService.markAsRead(testUserId, first.id);
    assert.equal(updated.isRead, true);

    const recheck = await notificationService.getUnreadCount(testUserId);
    assert.equal(recheck, list.unreadCount - 1);
  });

  await t.test('4. Mark all notifications as read', async () => {
    // Add another unread notification
    await notificationService.createNotification({
      userId: testUserId,
      title: 'Đang giao hàng',
      message: 'Tài xế đang giao.',
      type: 'ORDER_SHIPPING',
    });

    const res = await notificationService.markAllAsRead(testUserId);
    assert.ok(res.updatedCount >= 1);

    const count = await notificationService.getUnreadCount(testUserId);
    assert.equal(count, 0, 'All should be read now');
  });

  await t.test('5. Delete notification', async () => {
    const list = await notificationService.getNotifications(testUserId);
    const first = list.items[0];
    const ok = await notificationService.deleteNotification(testUserId, first.id);
    assert.equal(ok, true);

    const recheckList = await notificationService.getNotifications(testUserId);
    assert.equal(recheckList.total, list.total - 1);
  });

  await t.test('6. Edge cases: invalid userId or missing notification', async () => {
    const res = await notificationService.createNotification({ userId: null });
    assert.equal(res, null);

    const notFound = await notificationService.markAsRead(testUserId, 'non-existent-id');
    assert.equal(notFound, null);

    const deleteNotFound = await notificationService.deleteNotification(testUserId, 'non-existent-id');
    assert.equal(deleteNotFound, false);
  });
});

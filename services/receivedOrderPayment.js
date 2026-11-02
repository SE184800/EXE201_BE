const { Prisma } = require('@prisma/client');
const delivery = require('./deliveryService');
const { paymentDue } = require('./orderPaymentPolicy');
const { ensureWallet, applyBalance } = require('./walletService');
const { audit, problem } = require('./platformPolicy');

async function payReceivedOrder(prisma, buyerId, id, expectedAmount, include) {
  return prisma.$transaction(async tx => {
    const resource = `SupplyMindOrderPayment:${id}`;
    const lock = await tx.$queryRaw`DECLARE @result INT; EXEC @result = sys.sp_getapplock @Resource = ${resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; SELECT @result AS code;`;
    if (lock[0].code < 0) throw problem(409, 'Đơn đang thanh toán. Hãy thử lại.');
    const order = await tx.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
    if (!order) throw problem(404, 'Không tìm thấy đơn hàng.');
    if (order.orderPayment?.refund || order.orderPayment?.status === 'REFUNDED') throw problem(409, 'Đơn đã hoàn tiền.');
    if (order.orderPayment) return { order, alreadyPaid: true };
    if (!['ISSUE_HANDLING', 'DELIVERED'].includes(order.status)) throw problem(409, 'Nhận hàng trước khi trả tiền.');
    if (order.complaint && ['OPEN', 'IN_REVIEW'].includes(order.complaint.status)) throw problem(409, 'Cần xử lý xong sự cố trước khi trả tiền.');
    const info = delivery.getDriverInfo(id);
    if (['PENDING_SUPPLIER_CONFIRM', 'CONFIRMED'].includes(info?.paymentInfo?.status)) throw problem(409, 'Đơn đã báo trả tiền bằng cách khác.');
    const due = new Prisma.Decimal(paymentDue(order, info));
    if (expectedAmount !== undefined && (typeof expectedAmount !== 'number' || !Number.isFinite(expectedAmount) || Math.abs(expectedAmount - Number(due)) > 0.01)) throw problem(400, 'Số tiền đã thay đổi. Hãy tải lại đơn.');
    const wallet = await ensureWallet(tx, buyerId);
    if (wallet.balance.lessThan(due)) throw problem(409, 'Số dư ví không đủ để trả tiền.');
    const commission = order.commissionRate === null ? null : due.mul(order.commissionRate).div(100).toDecimalPlaces(2);
    const payment = await tx.orderPayment.create({ data: {
      orderId: id, buyerId, supplierUserId: order.supplier.userId, amount: due,
      commissionAmount: commission, supplierAmount: commission === null ? due : due.sub(commission),
      status: 'PAID', reference: `ORDER-WALLET-${id}`,
    } });
    if (due.greaterThan(0)) await applyBalance(tx, { wallet, userId: buyerId, type: 'ORDER_PAYMENT', direction: 'DEBIT', amount: due, orderId: id, reference: `ORDER-WALLET-${id}`, method: 'WALLET', note: `Trả phần còn lại đơn #${id}` });
    await tx.wholesaleOrder.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: order.deliveredAt || new Date() } });
    await audit(tx, buyerId, 'ORDER_PAID_WITH_WALLET', 'ORDER', id, { paymentId: payment.id, amount: due.toString() });
    return { order: await tx.wholesaleOrder.findUniqueOrThrow({ where: { id }, include }), alreadyPaid: false };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
}
module.exports = { payReceivedOrder };

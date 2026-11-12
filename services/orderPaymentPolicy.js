const { getAgreedCodDeduction } = require('./complaintWorkflowService');

const problem = message => Object.assign(new Error(message), { status: 409 });

function paymentDue(order, driverInfo) {
  const report = driverInfo?.incidentReport;
  if (report?.action === 'RETURN_ALL') throw problem('Đơn trả lại hàng không thể thanh toán.');
  let loss = 0;
  if (report?.action === 'DEDUCT_COD') {
    if (typeof report.lossAmount === 'number' && Number.isFinite(report.lossAmount) && report.lossAmount >= 0) loss = report.lossAmount;
    else for (const damaged of report.damagedItems || []) {
      const item = order.items.find(line => line.productId === damaged.productId || line.productName === damaged.productName);
      if (!item) throw problem('Cần đối chiếu lại hàng hỏng trước khi thanh toán.');
      const loose = String(damaged.productName).match(/Hỏng lẻ\s+(\d+)\/(\d+)/i);
      const quantity = loose ? Number(loose[1]) / Number(loose[2]) : Number(damaged.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) throw problem('Số lượng hàng hỏng chưa hợp lệ.');
      loss += Math.min(quantity, item.quantity) * Number(item.unitPrice);
    }
  }
  const complaintDeduct = Number(order?.complaint?.workflow?.agreedDeductAmount || (order?.id ? getAgreedCodDeduction(order.id) : 0) || 0);
  if (Number.isFinite(complaintDeduct) && complaintDeduct > 0) {
    loss += complaintDeduct;
  }
  const total = Math.max(0, Number(order.subtotal) - Math.min(Number(order.subtotal), Math.round(loss))) + Number(order.deliveryFee);
  return Math.max(0, total - (order.depositStatus === 'PAID' ? Number(order.depositAmount) : 0));
}

function fullyPaidByWallet(order, driverInfo) {
  const payment = order.orderPayment;
  return Boolean(payment && !payment.refund && ['PAID', 'SETTLED'].includes(payment.status) && Number(payment.amount) >= paymentDue(order, driverInfo));
}

module.exports = { paymentDue, fullyPaidByWallet };

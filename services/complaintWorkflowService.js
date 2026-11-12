const fs = require('node:fs');
const path = require('node:path');
const { Prisma } = require('@prisma/client');
const documents = require('./documentStorage');
const { walletService, refundPaidOrder } = require('./walletService');
const notificationService = require('./notificationService');
const { audit } = require('./platformPolicy');

const MAX_NEGOTIATION_ROUNDS = null;
const RESPONSE_TIMEOUT_HOURS = null;

const CLOSED_COMPLAINT_STATUSES = [
  'RESOLVED',
  'CLOSED_UNRESOLVED',
  'CLOSED_TIMEOUT',
  'ADMIN_RESOLVED_BUYER',
  'ADMIN_RESOLVED_SUPPLIER',
];

const ACTIVE_COMPLAINT_STATUSES = ['OPEN', 'IN_REVIEW', 'ESCALATED'];

const SUPPLIER_ACTION_LABELS = {
  AGREE_REPLACE_0VND: 'Giao bù hàng mới (Tạo đơn bổ sung 0đ)',
  DEDUCT_COD: 'Giảm trừ tiền hàng hỏng vào COD',
  RETURN_REFUND: 'Nhận lại hàng & Hoàn 100% tiền cọc / tiền đã trả về Ví',
  DISCUSS: 'Trao đổi phương án xử lý với cửa hàng',
  REJECT: 'Từ chối bồi thường (Hàng giao đúng quy chuẩn)',
};

const OUTCOME_LABELS = {
  AGREED_REPLACE_0VND: 'Hai bên thống nhất: Giao bù hàng mới (đơn 0đ)',
  AGREED_DEDUCT_COD: 'Hai bên thống nhất: Giảm trừ tiền hàng hỏng vào COD',
  AGREED_RETURN_REFUND: 'Hai bên thống nhất: Trả hàng & Hoàn tiền cọc/ví',
  STORE_ACCEPTED: 'Hai bên thống nhất kết thúc / Cửa hàng chấp nhận giải trình',
  STORE_WITHDRAWN: 'Cửa hàng chủ động rút khiếu nại',
  TIMEOUT_SUPPLIER_AUTO_REFUND: 'Tự đóng (Vựa quá hạn 48h không phản hồi — Hoàn cọc & hủy đơn theo Điều 6.4)',
  TIMEOUT_SUPPLIER_IMPORTED: 'Tự đóng (Vựa quá hạn 48h — Đơn đã nhập kho nên giữ nguyên đơn theo Điều 6.4)',
  TIMEOUT_BUYER_CLOSED: 'Tự đóng (Tiệm quá hạn 48h không phản hồi — Đóng theo phản hồi cuối của Vựa theo Điều 6.4)',
  DEADLOCK_AUTO_REFUND: 'Tự đóng (Hết 2 vòng thương lượng — Chưa nhập kho nên hoàn cọc & hủy đơn theo Điều 6.5)',
  DEADLOCK_KEPT_IMPORTED: 'Tự đóng (Hết 2 vòng thương lượng — Đã nhập kho nên không hoàn tiền theo Điều 6.5)',
};

const dataDir = path.join(__dirname, '../data');
const workflowFile = path.join(dataDir, 'complaints_workflow.json');

let workflowCache = null;

function defaultStore() {
  return { complaints: {}, orderDeductions: {} };
}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(workflowFile)) {
    fs.writeFileSync(workflowFile, JSON.stringify(defaultStore(), null, 2), 'utf8');
  }
}

function loadStore() {
  if (documents.active()) {
    const doc = documents.readDocument('complaints_workflow', defaultStore());
    if (!doc.complaints) doc.complaints = {};
    if (!doc.orderDeductions) doc.orderDeductions = {};
    return doc;
  }
  ensureDataFile();
  if (workflowCache) return workflowCache;
  try {
    const raw = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
    workflowCache = {
      complaints: raw?.complaints && typeof raw.complaints === 'object' ? raw.complaints : {},
      orderDeductions: raw?.orderDeductions && typeof raw.orderDeductions === 'object' ? raw.orderDeductions : {},
    };
  } catch {
    workflowCache = defaultStore();
  }
  return workflowCache;
}

function persistStore() {
  if (documents.active()) {
    const current = documents.readDocument('complaints_workflow', defaultStore());
    return documents.writeDocument('complaints_workflow', current);
  }
  ensureDataFile();
  const tmp = `${workflowFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(workflowCache || defaultStore(), null, 2), 'utf8');
  fs.renameSync(tmp, workflowFile);
}

function addHoursIso(hours = RESPONSE_TIMEOUT_HOURS, baseDate = new Date()) {
  return new Date(baseDate.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function buildFallbackWorkflow(complaint, { includeResponseHistory = true } = {}) {
  if (!complaint) return null;
  const createdIso = complaint.createdAt ? new Date(complaint.createdAt).toISOString() : new Date().toISOString();
  const updatedIso = complaint.updatedAt ? new Date(complaint.updatedAt).toISOString() : createdIso;
  const st = complaint.status || 'OPEN';
  const isClosed = CLOSED_COMPLAINT_STATUSES.includes(st);

  let pendingParty = null;
  if (st === 'OPEN') pendingParty = 'SUPPLIER';
  else if (st === 'IN_REVIEW' || st === 'REJECTED') pendingParty = 'STORE_OWNER';

  const history = [
    {
      at: createdIso,
      actorRole: 'STORE_OWNER',
      actorName: 'Tiệm tạp hóa',
      round: 1,
      action: 'CREATE_COMPLAINT',
      label: 'Tạo khiếu nại',
      note: complaint.description || complaint.reason || '',
    },
  ];
  if (includeResponseHistory && complaint.response) {
    history.push({
      at: updatedIso,
      actorRole: 'SUPPLIER',
      actorName: 'Chủ vựa',
      round: 1,
      action: st === 'REJECTED' ? 'REJECT' : 'PROPOSE',
      label: st === 'REJECTED' ? 'Chủ vựa từ chối' : 'Chủ vựa phản hồi',
      note: complaint.response,
    });
  }

  return {
    complaintId: Number(complaint.id),
    orderId: Number(complaint.orderId),
    round: 1,
    maxRounds: MAX_NEGOTIATION_ROUNDS,
    pendingParty,
    deadlineAt: null,
    proposedAction: st === 'REJECTED' ? 'REJECT' : null,
    proposedDeductAmount: null,
    agreedDeductAmount: null,
    proposedNote: complaint.response || null,
    finalOutcome: isClosed ? st : null,
    finalSummary: isClosed ? (OUTCOME_LABELS[st] || complaint.response || 'Đã xử lý xong') : null,
    closedReason: isClosed && complaint.response && complaint.response !== (OUTCOME_LABELS[st] || 'Đã xử lý xong')
      ? complaint.response
      : null,
    resolvedAt: isClosed ? updatedIso : null,
    history,
  };
}

function getComplaintWorkflow(complaint, options = {}) {
  if (!complaint) return null;
  const store = loadStore();
  const saved = store.complaints[String(complaint.id)];
  if (!saved) return buildFallbackWorkflow(complaint, options);
  return {
    ...saved,
    maxRounds: null,
    deadlineAt: null,
    history: Array.isArray(saved.history) ? saved.history : [],
  };
}

function saveComplaintWorkflow(record) {
  if (!record || !record.complaintId) return null;
  const store = loadStore();
  store.complaints[String(record.complaintId)] = record;
  if (record.orderId && typeof record.agreedDeductAmount === 'number' && record.agreedDeductAmount > 0) {
    store.orderDeductions[String(record.orderId)] = Math.round(record.agreedDeductAmount);
  }
  persistStore();
  return record;
}

function getAgreedCodDeduction(orderId) {
  if (!orderId) return 0;
  const store = loadStore();
  const amount = Number(store.orderDeductions[String(orderId)] || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function initComplaintWorkflow(complaint, actorName = 'Tiệm tạp hóa') {
  const now = new Date();
  const record = {
    complaintId: Number(complaint.id),
    orderId: Number(complaint.orderId),
    round: 1,
    maxRounds: null,
    pendingParty: 'SUPPLIER',
    deadlineAt: null,
    proposedAction: null,
    proposedDeductAmount: null,
    agreedDeductAmount: null,
    proposedNote: null,
    finalOutcome: null,
    finalSummary: null,
    closedReason: null,
    resolvedAt: null,
    history: [
      {
        at: now.toISOString(),
        actorRole: 'STORE_OWNER',
        actorName: actorName || 'Tiệm tạp hóa',
        round: 1,
        action: 'CREATE_COMPLAINT',
        label: 'Bắt đầu · Tạo khiếu nại',
        note: complaint.description || complaint.reason || '',
      },
    ],
  };
  return saveComplaintWorkflow(record);
}

function recordSupplierProposal(complaint, { supplierName, action, deductAmount = null, note }) {
  const current = getComplaintWorkflow(complaint, { includeResponseHistory: false });
  const now = new Date();
  const round = current?.round || 1;
  const actionLabel = SUPPLIER_ACTION_LABELS[action] || action;
  const history = [...(current?.history || [])];
  const noteWithAmount = action === 'DEDUCT_COD' && deductAmount > 0
    ? `${note} (Đề xuất giảm COD: ${Math.round(deductAmount).toLocaleString('vi-VN')} ₫)`
    : note;

  history.push({
    at: now.toISOString(),
    actorRole: 'SUPPLIER',
    actorName: supplierName || 'Chủ vựa',
    round,
    action,
    label: `Đang xử lý · Chủ vựa đề xuất: ${actionLabel}`,
    note: noteWithAmount,
  });

  const updated = {
    ...current,
    complaintId: Number(complaint.id),
    orderId: Number(complaint.orderId),
    round,
    maxRounds: null,
    pendingParty: 'STORE_OWNER',
    deadlineAt: null,
    proposedAction: action,
    proposedDeductAmount: action === 'DEDUCT_COD' ? Math.round(Number(deductAmount) || 0) : null,
    proposedNote: note,
    history,
  };
  return saveComplaintWorkflow(updated);
}

function recordBuyerCounter(complaint, { buyerName, note }) {
  const current = getComplaintWorkflow(complaint);
  const now = new Date();
  const nextRound = (current?.round || 1) + 1;
  const history = [...(current?.history || [])];
  history.push({
    at: now.toISOString(),
    actorRole: 'STORE_OWNER',
    actorName: buyerName || 'Tiệm tạp hóa',
    round: nextRound,
    action: 'COUNTER_PROPOSAL',
    label: 'Đang xử lý · Tiệm đề xuất lại phương án',
    note,
  });

  const updated = {
    ...current,
    complaintId: Number(complaint.id),
    orderId: Number(complaint.orderId),
    round: nextRound,
    maxRounds: null,
    pendingParty: 'SUPPLIER',
    deadlineAt: null,
    proposedAction: null,
    proposedDeductAmount: null,
    proposedNote: null,
    history,
  };
  return saveComplaintWorkflow(updated);
}

function recordFinalResolution(complaint, {
  actorRole,
  actorName,
  action,
  label,
  finalOutcome,
  finalSummary,
  closedReason,
  agreedDeductAmount = null,
  supplementaryOrderId = null,
}) {
  const current = getComplaintWorkflow(complaint);
  const now = new Date();
  const round = current?.round || 1;
  const history = [...(current?.history || [])];
  history.push({
    at: now.toISOString(),
    actorRole,
    actorName,
    round,
    action,
    label,
    note: closedReason || finalSummary || '',
  });

  const updated = {
    ...current,
    complaintId: Number(complaint.id),
    orderId: Number(complaint.orderId),
    maxRounds: null,
    pendingParty: null,
    deadlineAt: null,
    agreedDeductAmount: agreedDeductAmount && agreedDeductAmount > 0 ? Math.round(agreedDeductAmount) : current?.agreedDeductAmount || null,
    supplementaryOrderId: supplementaryOrderId || current?.supplementaryOrderId || null,
    finalOutcome,
    finalSummary: finalSummary || OUTCOME_LABELS[finalOutcome] || finalOutcome,
    closedReason: closedReason || finalSummary || null,
    resolvedAt: now.toISOString(),
    history,
  };
  return saveComplaintWorkflow(updated);
}

async function executeReturnRefundSettlement(tx, { order, supplierId, actorId = null, reason, rejectReason }) {
  for (const item of order.items || []) {
    await tx.supplierProduct.updateMany({
      where: { id: item.productId, supplierId },
      data: { stockQty: { increment: item.quantity } },
    });
  }

  const depositAmt = Number(order.depositAmount || 0);
  const hasPaidDeposit = depositAmt > 0 && order.depositStatus === 'PAID';
  if (hasPaidDeposit) {
    await walletService.refundEscrow(order.buyerId, order.id, depositAmt, reason, { tx });
  }

  if (order.orderPayment && !order.orderPayment.refund) {
    await refundPaidOrder(tx, {
      orderId: order.id,
      actorId: actorId ?? null,
      reason,
    });
  }

  await tx.wholesaleOrder.update({
    where: { id: order.id },
    data: {
      status: 'REJECTED',
      depositStatus: hasPaidDeposit ? 'REFUNDED' : order.depositStatus,
      rejectReason: String(rejectReason || reason).slice(0, 255),
    },
  });

  return { refundedDeposit: hasPaidDeposit ? depositAmt : 0, refundedPayment: Boolean(order.orderPayment && !order.orderPayment.refund) };
}

async function executeReplaceOrderSettlement(tx, { order, note }) {
  return tx.wholesaleOrder.create({
    data: {
      buyerId: order.buyerId,
      supplierId: order.supplierId,
      status: 'PREPARING',
      subtotal: 0,
      deliveryFee: 0,
      total: 0,
      depositRate: 0,
      depositAmount: 0,
      depositStatus: 'NONE',
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      deliveryAddress: order.deliveryAddress,
      note: String(note || `Đơn giao bổ sung 0đ bù hàng sự cố cho đơn #${order.id}`).slice(0, 500),
      items: {
        create: (order.items || []).map((it) => ({
          productId: it.productId,
          productName: it.productName,
          packaging: it.packaging || 'Phần',
          quantity: it.quantity || 1,
          unitPrice: 0,
          lineTotal: 0,
        })),
      },
    },
    include: { items: true },
  });
}

async function closeContractDeadlock(tx, { complaint, order, actorId = null, isTimeout = false, timedOutParty = null }) {
  const imported = Boolean(order.inventoryImportedAt);
  let finalOutcome;
  let finalSummary;
  let closedReason;

  if (isTimeout && timedOutParty === 'STORE_OWNER') {
    finalOutcome = 'TIMEOUT_BUYER_CLOSED';
    finalSummary = OUTCOME_LABELS.TIMEOUT_BUYER_CLOSED;
    closedReason = 'Cửa hàng quá hạn 48 giờ không phản hồi sau khi Chủ vựa đưa phương án/từ chối. Hệ thống tự đóng khiếu nại và mở khóa đơn hàng theo Điều 6.4 Hợp đồng.';
    await tx.orderComplaint.update({
      where: { id: complaint.id },
      data: {
        status: 'CLOSED_TIMEOUT',
        response: complaint.response || closedReason,
      },
    });
  } else {
    if (isTimeout) {
      finalOutcome = imported ? 'TIMEOUT_SUPPLIER_IMPORTED' : 'TIMEOUT_SUPPLIER_AUTO_REFUND';
    } else {
      finalOutcome = imported ? 'DEADLOCK_KEPT_IMPORTED' : 'DEADLOCK_AUTO_REFUND';
    }
    finalSummary = OUTCOME_LABELS[finalOutcome];

    if (!imported) {
      closedReason = isTimeout
        ? 'Chủ vựa quá hạn 48 giờ không phản hồi. Tiệm chưa nhập kho nên hệ thống tự động hoàn cọc/tiền ví và hủy đơn theo Điều 6.4 Hợp đồng.'
        : 'Hết 02 vòng thương lượng nhưng không đạt thỏa thuận. Tiệm chưa nhập kho nên hệ thống tự động hoàn cọc/tiền ví và hủy đơn theo Điều 6.5 Hợp đồng.';

      await executeReturnRefundSettlement(tx, {
        order,
        supplierId: order.supplierId,
        actorId,
        reason: closedReason,
        rejectReason: closedReason,
      });
    } else {
      closedReason = isTimeout
        ? 'Chủ vựa quá hạn 48 giờ nhưng Tiệm đã xác nhận nhập kho trước đó. Hệ thống tự đóng khiếu nại không hoàn tiền theo Điều 6.4 Hợp đồng.'
        : 'Hết 02 vòng thương lượng nhưng không đạt thỏa thuận và Tiệm đã nhập kho. Hệ thống đóng khiếu nại không hoàn tiền và mở khóa tất toán đơn theo Điều 6.5 Hợp đồng.';
    }

    await tx.orderComplaint.update({
      where: { id: complaint.id },
      data: {
        status: isTimeout ? 'CLOSED_TIMEOUT' : 'CLOSED_UNRESOLVED',
        response: complaint.response ? `${complaint.response}\n[Hệ thống]: ${closedReason}`.slice(0, 1000) : `[Hệ thống]: ${closedReason}`.slice(0, 1000),
      },
    });
  }

  return { finalOutcome, finalSummary, closedReason };
}

async function evaluateAndApplyExpiredTimeouts() {
  // Temporarily paused: persistent-dispute 48h auto-timeout is disabled while focusing on basic consensual result recording.
  return;
}

async function _legacyEvaluateAndApplyExpiredTimeouts(prisma, whereFilter = {}, now = new Date()) {
  const store = loadStore();
  const candidates = await prisma.orderComplaint.findMany({
    where: {
      ...whereFilter,
      status: { in: ['OPEN', 'IN_REVIEW'] },
    },
    select: { id: true, orderId: true, status: true },
  });

  const expiredList = [];
  for (const c of candidates) {
    const wf = store.complaints[String(c.id)];
    if (wf && wf.deadlineAt && new Date(wf.deadlineAt).getTime() <= now.getTime()) {
      expiredList.push({ id: c.id, timedOutParty: wf.pendingParty || (c.status === 'OPEN' ? 'SUPPLIER' : 'STORE_OWNER') });
    }
  }

  for (const item of expiredList) {
    try {
      const closed = await prisma.$transaction(async (tx) => {
        const current = await tx.orderComplaint.findUnique({
          where: { id: item.id },
          include: {
            order: {
              include: { items: true, orderPayment: { include: { refund: true } } },
            },
            supplier: true,
          },
        });
        if (!current || !['OPEN', 'IN_REVIEW'].includes(current.status)) return null;

        const outcome = await closeContractDeadlock(tx, {
          complaint: current,
          order: current.order,
          actorId: null,
          isTimeout: true,
          timedOutParty: item.timedOutParty,
        });

        await audit(tx, null, 'COMPLAINT_AUTO_TIMEOUT_CLOSED', 'COMPLAINT', current.id, {
          orderId: current.orderId,
          timedOutParty: item.timedOutParty,
          finalOutcome: outcome.finalOutcome,
        });

        return { current, outcome };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (closed) {
        const { current, outcome } = closed;
        recordFinalResolution(current, {
          actorRole: 'SYSTEM',
          actorName: 'Hệ thống tự động (Điều 6.4)',
          action: 'AUTO_TIMEOUT_CLOSE',
          label: 'Tự động đóng do quá hạn 48 giờ',
          finalOutcome: outcome.finalOutcome,
          finalSummary: outcome.finalSummary,
          closedReason: outcome.closedReason,
        });

        try {
          await notificationService.createNotification({
            userId: current.buyerId,
            title: `Khiếu nại đơn #${current.orderId} đã tự động đóng`,
            message: outcome.closedReason,
            type: 'COMPLAINT_CLOSED',
            orderId: current.orderId,
            link: '/orders',
          });
          if (current.supplier?.userId) {
            await notificationService.createNotification({
              userId: current.supplier.userId,
              title: `Khiếu nại đơn #${current.orderId} đã tự động đóng`,
              message: outcome.closedReason,
              type: 'COMPLAINT_CLOSED',
              orderId: current.orderId,
              link: '/supplier/orders',
            });
          }
        } catch {}
      }
    } catch (err) {
      console.error('[COMPLAINT TIMEOUT] Lỗi tự đóng khiếu nại quá hạn:', err.message);
    }
  }
}

function deleteWorkflowsByComplaintIds(complaintIds = [], orderIds = []) {
  const store = loadStore();
  let changed = false;
  for (const id of complaintIds || []) {
    if (store.complaints[String(id)]) {
      delete store.complaints[String(id)];
      changed = true;
    }
  }
  for (const oid of orderIds || []) {
    if (store.orderDeductions[String(oid)]) {
      delete store.orderDeductions[String(oid)];
      changed = true;
    }
  }
  if (changed) persistStore();
}

function clearWorkflowCacheForTests() {
  workflowCache = null;
}

module.exports = {
  MAX_NEGOTIATION_ROUNDS,
  RESPONSE_TIMEOUT_HOURS,
  CLOSED_COMPLAINT_STATUSES,
  ACTIVE_COMPLAINT_STATUSES,
  SUPPLIER_ACTION_LABELS,
  OUTCOME_LABELS,
  getComplaintWorkflow,
  saveComplaintWorkflow,
  getAgreedCodDeduction,
  initComplaintWorkflow,
  recordSupplierProposal,
  recordBuyerCounter,
  recordFinalResolution,
  executeReturnRefundSettlement,
  executeReplaceOrderSettlement,
  closeContractDeadlock,
  evaluateAndApplyExpiredTimeouts,
  deleteWorkflowsByComplaintIds,
  clearWorkflowCacheForTests,
};

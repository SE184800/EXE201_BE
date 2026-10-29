const { Prisma } = require('@prisma/client');
const { audit, problem } = require('./platformPolicy');
const { buildVietQrPayload } = require('./vietQrService');

const ZERO = new Prisma.Decimal(0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = new Prisma.Decimal('1000000000000');

const TRANSACTION_TYPES = Object.freeze({
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL_HOLD: 'WITHDRAWAL_HOLD',
  WITHDRAWAL_RELEASE: 'WITHDRAWAL_RELEASE',
  WITHDRAWAL_PAYOUT: 'WITHDRAWAL_PAYOUT',
  ORDER_PAYMENT: 'ORDER_PAYMENT',
  ORDER_RECEIVE: 'ORDER_RECEIVE',
  REFUND: 'REFUND',
  REFUND_RECEIVED: 'REFUND_RECEIVED',
  SANDBOX_DEPOSIT: 'SANDBOX_DEPOSIT',
  SANDBOX_WITHDRAWAL: 'SANDBOX_WITHDRAWAL',
  QR_DEPOSIT: 'QR_DEPOSIT',
});

// REAL money needs an admin review, SANDBOX money settles instantly.
const METHODS = Object.freeze({ REAL: 'REAL', SANDBOX: 'SANDBOX' });

const STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Hoàn tất',
  FAILED: 'Thất bại',
  PAID: 'Đã thanh toán',
});

function number(value) {
  return typeof value === 'object' && value !== null && typeof value.toNumber === 'function'
    ? value.toNumber()
    : Number(value || 0);
}

function toDecimal(value) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function money(value) {
  return Number(toDecimal(value).toFixed(2));
}

/**
 * Validates a positive money amount coming from the client.
 * The backend always re-reads the real amount from the database for orders,
 * this helper only guards user-entered wallet amounts.
 */
function parseAmount(value, { min = 0.01, max = MAX_AMOUNT } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw problem(400, 'Số tiền không hợp lệ.');
  }
  const amount = new Prisma.Decimal(value.toFixed(2));
  if (amount.lessThan(min) || amount.greaterThan(max)) {
    throw problem(400, 'Số tiền phải lớn hơn 0 và không vượt quá 1.000 tỷ đồng.');
  }
  return amount;
}

function text(value, max = 500) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) {
    throw problem(400, 'Nội dung không hợp lệ.');
  }
  return value.trim();
}

/**
 * Money never moves without a wallet row. `ensureWallet` is idempotent so a
 * missing wallet can be created lazily the first time a user touches money.
 */
async function ensureWallet(tx, userId) {
  const existing = await tx.wallet.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await tx.wallet.create({ data: { userId } });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    return tx.wallet.findUniqueOrThrow({ where: { userId } });
  }
}

/**
 * Applies a balance change and appends the ledger row inside the same
 * transaction. `balanceAfter` is captured from the row we just wrote so the
 * history can always be replayed.
 */
async function applyBalance(tx, {
  wallet,
  userId,
  type,
  direction,
  amount,
  reference,
  orderId = null,
  note = null,
  method = METHODS.REAL,
}) {
  const delta = direction === 'CREDIT' ? amount : amount.neg();
  const nextBalance = wallet.balance.add(delta);
  if (nextBalance.lessThan(0)) {
    throw problem(409, 'Số dư ví không đủ để thực hiện giao dịch.');
  }
  const saved = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: nextBalance },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId,
      type,
      direction,
      amount,
      balanceAfter: nextBalance,
      reference,
      status: 'COMPLETED',
      method,
      orderId,
      note,
    },
  });
  return saved;
}

async function applyHeldDelta(tx, { wallet, amount, reference, userId, type, direction, note }) {
  const delta = direction === 'CREDIT' ? amount : amount.neg();
  const nextHeld = wallet.heldBalance.add(delta);
  if (nextHeld.lessThan(0)) {
    throw problem(409, 'Số tiền đang giữ không đủ để thực hiện giao dịch.');
  }
  const saved = await tx.wallet.update({
    where: { id: wallet.id },
    data: { heldBalance: nextHeld },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId,
      type,
      direction,
      amount,
      balanceAfter: saved.balance,
      reference,
      status: 'COMPLETED',
      note,
    },
  });
  return saved;
}

/**
 * Moves money from the spendable balance into the held balance in one step.
 * Used when a withdrawal request is created.
 */
async function holdAmount(tx, { wallet, userId, amount, reference, note }) {
  const nextBalance = wallet.balance.sub(amount);
  const nextHeld = wallet.heldBalance.add(amount);
  if (nextBalance.lessThan(0)) {
    throw problem(409, 'Số dư khả dụng không đủ để thực hiện giao dịch.');
  }
  const saved = await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: nextBalance, heldBalance: nextHeld },
  });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId,
      type: TRANSACTION_TYPES.WITHDRAWAL_HOLD,
      direction: 'DEBIT',
      amount,
      balanceAfter: nextBalance,
      reference,
      status: 'COMPLETED',
      note,
    },
  });
  return saved;
}

function serializeTransaction(transaction) {
  return {
    id: transaction.id,
    type: transaction.type,
    typeLabel: STATUS_LABELS[transaction.type] || transaction.type,
    direction: transaction.direction,
    amount: money(transaction.amount),
    balanceAfter: money(transaction.balanceAfter),
    reference: transaction.reference,
    status: transaction.status,
    method: transaction.method || METHODS.REAL,
    orderId: transaction.orderId,
    note: transaction.note,
    createdAt: transaction.createdAt,
  };
}

function serializeWallet(wallet) {
  return {
    id: wallet.id,
    balance: money(wallet.balance),
    heldBalance: money(wallet.heldBalance),
    total: money(toDecimal(wallet.balance).add(toDecimal(wallet.heldBalance))),
    currency: wallet.currency,
    updatedAt: wallet.updatedAt,
  };
}

function serializeDeposit(request) {
  return {
    id: request.id,
    userId: request.userId,
    userName: request.user ? request.user.name : null,
    username: request.user ? request.user.username : null,
    amount: money(request.amount),
    method: request.method,
    isSandbox: Boolean(request.isSandbox),
    bankName: request.bankName,
    bankAccountNumber: request.bankAccountNumber,
    bankAccountHolder: request.bankAccountHolder,
    reference: request.reference,
    status: request.status,
    statusLabel: STATUS_LABELS[request.status] || request.status,
    note: request.note,
    adminNote: request.adminNote,
    reviewedAt: request.reviewedAt,
    createdAt: request.createdAt,
  };
}

function serializeWithdrawal(request) {
  return {
    id: request.id,
    userId: request.userId,
    userName: request.user ? request.user.name : null,
    username: request.user ? request.user.username : null,
    amount: money(request.amount),
    isSandbox: Boolean(request.isSandbox),
    bankName: request.bankName,
    bankAccountNumber: request.bankAccountNumber,
    bankAccountHolder: request.bankAccountHolder,
    note: request.note,
    status: request.status,
    statusLabel: STATUS_LABELS[request.status] || request.status,
    adminNote: request.adminNote,
    reference: request.reference,
    reviewedAt: request.reviewedAt,
    completedAt: request.completedAt,
    createdAt: request.createdAt,
  };
}

function serializeOrderPayment(payment) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    buyerId: payment.buyerId,
    supplierUserId: payment.supplierUserId,
    buyerName: payment.buyer ? payment.buyer.name : null,
    supplierName: payment.supplier ? payment.supplier.name : null,
    amount: money(payment.amount),
    commissionAmount: payment.commissionAmount === null ? null : money(payment.commissionAmount),
    supplierAmount: payment.supplierAmount === null ? null : money(payment.supplierAmount),
    status: payment.status,
    statusLabel: STATUS_LABELS[payment.status] || payment.status,
    reference: payment.reference,
    paidAt: payment.paidAt,
    refunded: Boolean(payment.refund),
  };
}

/**
 * Credits the supplier wallet once the order is delivered.
 * This runs inside the order status transaction so no new order state and no
 * separate settlement job is needed. The payment status guard makes it safe to
 * call more than once.
 */
async function settleOrderToSupplier(tx, order) {
  const payment = await tx.orderPayment.findUnique({ where: { orderId: order.id } });
  if (!payment) return null;
  if (payment.status === 'SETTLED' || payment.status === 'REFUNDED') return null;
  const supplierWallet = await ensureWallet(tx, payment.supplierUserId);
  const amount = payment.supplierAmount === null ? payment.amount : payment.supplierAmount;
  if (amount.lessThanOrEqualTo(0)) return null;
  await applyBalance(tx, {
    wallet: supplierWallet,
    userId: payment.supplierUserId,
    type: TRANSACTION_TYPES.ORDER_RECEIVE,
    direction: 'CREDIT',
    amount,
    reference: `OP-RECV-${payment.id}`,
    orderId: order.id,
    note: `Tiền đơn hàng #${order.id} sau khi giao`,
  });
  await tx.orderPayment.update({
    where: { id: payment.id },
    data: { status: 'SETTLED' },
  });
  await audit(tx, null, 'ORDER_SETTLED_TO_SUPPLIER', 'ORDER', order.id, {
    paymentId: payment.id, amount: amount.toString(), supplierUserId: payment.supplierUserId,
  });
  return payment;
}

/**
 * Returns the money of a paid order to the buyer wallet.
 * The refund row is unique per payment so the money can never be returned twice.
 * When the order was already settled to the supplier, the same amount is taken
 * back from the supplier wallet.
 */
async function refundPaidOrder(tx, { orderId, actorId, reason }) {
  const payment = await tx.orderPayment.findUnique({
    where: { orderId },
    include: { refund: true },
  });
  if (!payment) throw problem(409, 'Đơn hàng này chưa được thanh toán bằng ví nên không thể hoàn tiền.');
  if (payment.refund) throw problem(409, 'Đơn hàng này đã được hoàn tiền trước đó.');
  const refund = await tx.refund.create({
    data: {
      orderId,
      orderPaymentId: payment.id,
      amount: payment.amount,
      reason,
      status: 'COMPLETED',
      reference: `RF-${orderId}-${Date.now()}`,
      createdBy: actorId ?? null,
    },
  });
  const buyerWallet = await ensureWallet(tx, payment.buyerId);
  await applyBalance(tx, {
    wallet: buyerWallet,
    userId: payment.buyerId,
    type: TRANSACTION_TYPES.REFUND,
    direction: 'CREDIT',
    amount: payment.amount,
    reference: `RF-BUY-${refund.id}`,
    orderId,
    note: `Hoàn tiền đơn hàng #${orderId}`,
  });
  if (payment.status === 'SETTLED') {
    // The supplier already received the money, take it back from their wallet.
    const supplierWallet = await ensureWallet(tx, payment.supplierUserId);
    const supplierAmount = payment.supplierAmount === null ? payment.amount : payment.supplierAmount;
    if (supplierAmount.greaterThan(0)) {
      await applyBalance(tx, {
        wallet: supplierWallet,
        userId: payment.supplierUserId,
        type: TRANSACTION_TYPES.REFUND_RECEIVED,
        direction: 'DEBIT',
        amount: supplierAmount,
        reference: `RF-SUP-${refund.id}`,
        orderId,
        note: `Thu hồi tiền đơn hàng #${orderId} do hoàn tiền`,
      });
    }
  }
  await tx.orderPayment.update({
    where: { id: payment.id },
    data: { status: 'REFUNDED' },
  });
  await audit(tx, actorId ?? null, 'ORDER_REFUNDED', 'ORDER', orderId, {
    refundId: refund.id, amount: payment.amount.toString(), reason,
  });
  return refund;
}

function createWalletService(prisma, qrBank = {}) {
  /** Wallet overview for the signed-in user. */
  async function getWallet(userId) {
    const wallet = await ensureWallet(prisma, userId);
    const [pendingDeposits, pendingWithdrawals] = await Promise.all([
      prisma.depositRequest.count({ where: { userId, status: 'PENDING' } }),
      prisma.withdrawalRequest.count({ where: { userId, status: 'PENDING' } }),
    ]);
    return {
      wallet: serializeWallet(wallet),
      pendingDeposits,
      pendingWithdrawals,
    };
  }

  /** Ledger of the signed-in user. */
  async function listTransactions(userId, query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const type = text(query.type, 30);
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      throw problem(400, 'Trang không hợp lệ.');
    }
    const allowed = Object.values(TRANSACTION_TYPES);
    if (type && !allowed.includes(type)) {
      throw problem(400, 'Loại giao dịch không hợp lệ.');
    }
    const where = { userId, ...(type ? { type } : {}) };
    const [rows, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.walletTransaction.count({ where }),
    ]);
    return {
      transactions: rows.map(serializeTransaction),
      total,
      page,
      hasMore: page * 20 < total,
    };
  }

  /** Creates a manual deposit request; an admin confirms it later. */
  async function createDepositRequest(userId, body = {}) {
    const amount = parseAmount(body.amount);
    const bankName = text(body.bankName, 100);
    const bankAccountNumber = text(body.bankAccountNumber, 34).replace(/\s+/g, '');
    const bankAccountHolder = text(body.bankAccountHolder, 100);
    const reference = text(body.reference, 100);
    const note = text(body.note, 500);
    if (bankName.length < 2 || !/^[A-Za-z0-9]{4,34}$/.test(bankAccountNumber) || bankAccountHolder.length < 2) {
      throw problem(400, 'Cần nhập ngân hàng, số tài khoản và chủ tài khoản để gửi yêu cầu nạp tiền.');
    }
    return prisma.$transaction(async tx => {
      const request = await tx.depositRequest.create({
        data: {
          userId,
          amount,
          method: 'BANK_TRANSFER',
          bankName,
          bankAccountNumber,
          bankAccountHolder,
          reference: reference || null,
          note: note || null,
          status: 'PENDING',
        },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      await audit(tx, userId, 'DEPOSIT_REQUESTED', 'DEPOSIT_REQUEST', request.id, {
        amount: amount.toString(), method: 'BANK_TRANSFER',
      });
      return serializeDeposit(request);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Sandbox deposit: simulated money that settles instantly.
   * The request is created already approved so the history keeps the same
   * shape as a real deposit, and the ledger row is tagged as SANDBOX.
   */
  async function createSandboxDepositRequest(userId, body = {}) {
    const amount = parseAmount(body.amount);
    const note = text(body.note, 500);
    return prisma.$transaction(async tx => {
      const request = await tx.depositRequest.create({
        data: {
          userId,
          amount,
          method: 'SANDBOX',
          isSandbox: true,
          bankName: 'SANDBOX',
          bankAccountNumber: 'SANDBOX',
          bankAccountHolder: 'SANDBOX',
          reference: `SANDBOX-DEP-${Date.now()}`,
          note: note || null,
          status: 'PENDING',
        },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      // Claim the pending row before crediting so the money is added once.
      const changed = await tx.depositRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedAt: new Date() },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu nạp sandbox vừa được xử lý.');
      const wallet = await ensureWallet(tx, userId);
      await applyBalance(tx, {
        wallet,
        userId,
        type: TRANSACTION_TYPES.SANDBOX_DEPOSIT,
        direction: 'CREDIT',
        amount,
        reference: `SANDBOX-DEP-${request.id}`,
        method: METHODS.SANDBOX,
        note: note || 'Nạp tiền ảo (sandbox).',
      });
      await audit(tx, userId, 'SANDBOX_DEPOSIT_CREATED', 'DEPOSIT_REQUEST', request.id, {
        amount: amount.toString(),
      });
      const saved = await tx.depositRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeDeposit(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Creates a VietQR deposit ticket and returns the QR payload for it.
   * The ticket stays PENDING until the user confirms the transfer, so the
   * admin still has a record of every QR deposit.
   */
  async function createQrDepositRequest(userId, body = {}) {
    const amount = parseAmount(body.amount);
    const note = text(body.note, 500);
    const request = await prisma.depositRequest.create({
      data: {
        userId,
        amount,
        method: 'VIET_QR',
        isSandbox: true,
        bankName: qrBank.name || 'QR',
        bankAccountNumber: qrBank.accountNumber,
        bankAccountHolder: qrBank.accountHolder,
        reference: `QR-DEP-${Date.now()}`,
        note: note || null,
        status: 'PENDING',
      },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    await audit(prisma, userId, 'QR_DEPOSIT_REQUESTED', 'DEPOSIT_REQUEST', request.id, {
      amount: amount.toString(), method: 'VIET_QR',
    });
    const payload = buildVietQrPayload({
      bank: qrBank,
      amount: amount.toNumber(),
      billNumber: request.reference,
      memo: `NAP TIEN VI ${request.id}`,
    });
    return {
      request: serializeDeposit(request),
      qr: {
        payload,
        bankCode: qrBank.code,
        bankName: qrBank.name,
        accountNumber: qrBank.accountNumber,
        accountHolder: qrBank.accountHolder,
        amount: amount.toNumber(),
        billNumber: request.reference,
      },
    };
  }

  /**
   * Confirms a QR deposit: the money is credited right away and the ticket is
   * closed so the same QR can never be settled twice.
   */
  async function confirmQrDeposit(userId, id, body = {}) {
    const reference = text(body.reference, 100);
    return prisma.$transaction(async tx => {
      const request = await tx.depositRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy phiếu nạp QR.');
      if (request.userId !== userId) throw problem(403, 'Bạn không có quyền xác nhận phiếu này.');
      if (request.status !== 'PENDING') {
        throw problem(409, 'Phiếu nạp QR đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.depositRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedAt: new Date(),
          reference: reference || request.reference,
        },
      });
      if (!changed.count) throw problem(409, 'Phiếu nạp QR vừa được xử lý.');
      const wallet = await ensureWallet(tx, userId);
      await applyBalance(tx, {
        wallet,
        userId,
        type: TRANSACTION_TYPES.QR_DEPOSIT,
        direction: 'CREDIT',
        amount: request.amount,
        reference: `QR-DEP-${request.id}`,
        method: METHODS.SANDBOX,
        note: request.note || 'Nạp tiền qua mã QR.',
      });
      await audit(tx, userId, 'QR_DEPOSIT_CONFIRMED', 'DEPOSIT_REQUEST', request.id, {
        amount: request.amount.toString(),
      });
      const saved = await tx.depositRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeDeposit(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function listDepositRequests(userId, query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const status = text(query.status, 20);
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      throw problem(400, 'Trang không hợp lệ.');
    }
    if (status && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      throw problem(400, 'Trạng thái yêu cầu nạp tiền không hợp lệ.');
    }
    const where = { userId, ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
      prisma.depositRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.depositRequest.count({ where }),
    ]);
    return {
      requests: rows.map(serializeDeposit),
      total,
      page,
      hasMore: page * 20 < total,
    };
  }

  /**
   * Admin confirms a deposit: the money is credited to the wallet exactly once
   * because the request row is claimed with a status check first.
   */
  async function approveDeposit(actorId, id, body = {}) {
    const adminNote = text(body.adminNote, 500);
    const reference = text(body.reference, 100);
    return prisma.$transaction(async tx => {
      const request = await tx.depositRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy yêu cầu nạp tiền.');
      if (request.status !== 'PENDING') {
        throw problem(409, 'Yêu cầu nạp tiền đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.depositRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          adminNote: adminNote || null,
          reference: reference || request.reference || null,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu nạp tiền vừa được xử lý. Tải lại danh sách.');
      const wallet = await ensureWallet(tx, request.userId);
      await applyBalance(tx, {
        wallet,
        userId: request.userId,
        type: TRANSACTION_TYPES.DEPOSIT,
        direction: 'CREDIT',
        amount: request.amount,
        reference: `DEP-${request.id}`,
        note: adminNote || 'Quản trị viên xác nhận nạp tiền.',
      });
      await audit(tx, actorId, 'DEPOSIT_APPROVED', 'DEPOSIT_REQUEST', id, {
        userId: request.userId, amount: request.amount.toString(),
        reference: reference || `DEP-${request.id}`,
      });
      const saved = await tx.depositRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeDeposit(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function rejectDeposit(actorId, id, body = {}) {
    const adminNote = text(body.adminNote, 500);
    if (adminNote.length < 3) throw problem(400, 'Cần nhập lý do từ chối từ 3–500 ký tự.');
    return prisma.$transaction(async tx => {
      const request = await tx.depositRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy yêu cầu nạp tiền.');
      if (request.status !== 'PENDING') {
        throw problem(409, 'Yêu cầu nạp tiền đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.depositRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          adminNote,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu nạp tiền vừa được xử lý. Tải lại danh sách.');
      await audit(tx, actorId, 'DEPOSIT_REJECTED', 'DEPOSIT_REQUEST', id, {
        userId: request.userId, amount: request.amount.toString(), adminNote,
      });
      const saved = await tx.depositRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeDeposit(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Creates a withdrawal request. The amount leaves the spendable balance and
   * is parked in `heldBalance` until an admin completes or rejects it.
   */
  async function createWithdrawalRequest(userId, body = {}) {
    const amount = parseAmount(body.amount);
    const bankName = text(body.bankName, 100);
    const bankAccountNumber = text(body.bankAccountNumber, 34).replace(/\s+/g, '');
    const bankAccountHolder = text(body.bankAccountHolder, 100);
    const note = text(body.note, 500);
    if (bankName.length < 2 || !/^[A-Za-z0-9]{4,34}$/.test(bankAccountNumber) || bankAccountHolder.length < 2) {
      throw problem(400, 'Cần nhập ngân hàng, số tài khoản và chủ tài khoản để rút tiền.');
    }
    return prisma.$transaction(async tx => {
      const wallet = await ensureWallet(tx, userId);
      if (wallet.balance.lessThan(amount)) {
        throw problem(409, 'Số dư khả dụng không đủ để rút tiền.');
      }
      const request = await tx.withdrawalRequest.create({
        data: {
          userId,
          amount,
          bankName,
          bankAccountNumber,
          bankAccountHolder,
          note: note || null,
          status: 'PENDING',
        },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      // Move the money from the spendable balance into the held balance.
      await holdAmount(tx, {
        wallet,
        userId,
        amount,
        reference: `WD-HOLD-${request.id}`,
        note: 'Giữ tiền cho yêu cầu rút tiền.',
      });
      await audit(tx, userId, 'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_REQUEST', request.id, {
        amount: amount.toString(), bankName, bankAccountNumber,
      });
      return serializeWithdrawal(request);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Sandbox withdrawal: simulated money that leaves the wallet instantly.
   * The request is created already completed so the history keeps the same
   * shape as a real withdrawal, and the ledger row is tagged as SANDBOX.
   */
  async function createSandboxWithdrawalRequest(userId, body = {}) {
    const amount = parseAmount(body.amount);
    const note = text(body.note, 500);
    return prisma.$transaction(async tx => {
      const wallet = await ensureWallet(tx, userId);
      if (wallet.balance.lessThan(amount)) {
        throw problem(409, 'Số dư khả dụng không đủ để rút tiền.');
      }
      const request = await tx.withdrawalRequest.create({
        data: {
          userId,
          amount,
          isSandbox: true,
          bankName: 'SANDBOX',
          bankAccountNumber: 'SANDBOX',
          bankAccountHolder: 'SANDBOX',
          note: note || null,
          status: 'PENDING',
        },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      // Claim the pending row before paying out so the money leaves once.
      const changed = await tx.withdrawalRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: {
          status: 'COMPLETED',
          reference: `SANDBOX-WD-${request.id}`,
          reviewedAt: new Date(),
          completedAt: new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu rút sandbox vừa được xử lý.');
      await applyBalance(tx, {
        wallet,
        userId,
        type: TRANSACTION_TYPES.SANDBOX_WITHDRAWAL,
        direction: 'DEBIT',
        amount,
        reference: `SANDBOX-WD-${request.id}`,
        method: METHODS.SANDBOX,
        note: note || 'Rút tiền ảo (sandbox).',
      });
      await audit(tx, userId, 'SANDBOX_WITHDRAWAL_CREATED', 'WITHDRAWAL_REQUEST', request.id, {
        amount: amount.toString(),
      });
      const saved = await tx.withdrawalRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeWithdrawal(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function listWithdrawalRequests(userId, query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const status = text(query.status, 20);
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      throw problem(400, 'Trang không hợp lệ.');
    }
    if (status && !['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED'].includes(status)) {
      throw problem(400, 'Trạng thái yêu cầu rút tiền không hợp lệ.');
    }
    const where = { userId, ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.withdrawalRequest.count({ where }),
    ]);
    return {
      requests: rows.map(serializeWithdrawal),
      total,
      page,
      hasMore: page * 20 < total,
    };
  }

  /**
   * Admin approves a withdrawal. The money stays held until the transfer is
   * confirmed by `completeWithdrawal`.
   */
  async function approveWithdrawal(actorId, id, body = {}) {
    const adminNote = text(body.adminNote, 500);
    return prisma.$transaction(async tx => {
      const request = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy yêu cầu rút tiền.');
      if (request.status !== 'PENDING') {
        throw problem(409, 'Yêu cầu rút tiền đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.withdrawalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          adminNote: adminNote || null,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu rút tiền vừa được xử lý. Tải lại danh sách.');
      await audit(tx, actorId, 'WITHDRAWAL_APPROVED', 'WITHDRAWAL_REQUEST', id, {
        userId: request.userId, amount: request.amount.toString(),
      });
      const saved = await tx.withdrawalRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeWithdrawal(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Admin rejects a withdrawal: the held money returns to the spendable balance.
   */
  async function rejectWithdrawal(actorId, id, body = {}) {
    const adminNote = text(body.adminNote, 500);
    if (adminNote.length < 3) throw problem(400, 'Cần nhập lý do từ chối từ 3–500 ký tự.');
    return prisma.$transaction(async tx => {
      const request = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy yêu cầu rút tiền.');
      if (!['PENDING', 'APPROVED'].includes(request.status)) {
        throw problem(409, 'Yêu cầu rút tiền đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.withdrawalRequest.updateMany({
        where: { id, status: request.status },
        data: {
          status: 'REJECTED',
          adminNote,
          reviewedBy: actorId,
          reviewedAt: new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu rút tiền vừa được xử lý. Tải lại danh sách.');
      await releaseHeld(tx, request, 'WITHDRAWAL_REJECTED', adminNote);
      await audit(tx, actorId, 'WITHDRAWAL_REJECTED', 'WITHDRAWAL_REQUEST', id, {
        userId: request.userId, amount: request.amount.toString(), adminNote,
      });
      const saved = await tx.withdrawalRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeWithdrawal(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** Admin confirms the bank transfer actually happened. */
  async function completeWithdrawal(actorId, id, body = {}) {
    const reference = text(body.reference, 100);
    const adminNote = text(body.adminNote, 500);
    if (reference.length < 3) throw problem(400, 'Cần nhập mã giao dịch chuyển khoản từ 3–100 ký tự.');
    return prisma.$transaction(async tx => {
      const request = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy yêu cầu rút tiền.');
      if (!['PENDING', 'APPROVED'].includes(request.status)) {
        throw problem(409, 'Yêu cầu rút tiền đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.withdrawalRequest.updateMany({
        where: { id, status: request.status },
        data: {
          status: 'COMPLETED',
          reference,
          adminNote: adminNote || null,
          reviewedBy: request.reviewedBy || actorId,
          reviewedAt: request.reviewedAt || new Date(),
          completedBy: actorId,
          completedAt: new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu rút tiền vừa được xử lý. Tải lại danh sách.');
      const wallet = await ensureWallet(tx, request.userId);
      const held = wallet.heldBalance;
      if (held.lessThan(request.amount)) {
        throw problem(409, 'Số tiền đang giữ không đủ để hoàn tất rút tiền. Kiểm tra lại ví.');
      }
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { heldBalance: held.sub(request.amount) },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: request.userId,
          type: TRANSACTION_TYPES.WITHDRAWAL_PAYOUT,
          direction: 'DEBIT',
          amount: request.amount,
          balanceAfter: wallet.balance,
          reference: `WD-PAYOUT-${request.id}`,
          status: 'COMPLETED',
          note: `Chuyển khoản rút tiền · mã giao dịch ${reference}`,
        },
      });
      await audit(tx, actorId, 'WITHDRAWAL_COMPLETED', 'WITHDRAWAL_REQUEST', id, {
        userId: request.userId, amount: request.amount.toString(), reference,
      });
      const saved = await tx.withdrawalRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeWithdrawal(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** Admin marks the transfer as failed: the held money goes back. */
  async function failWithdrawal(actorId, id, body = {}) {
    const adminNote = text(body.adminNote, 500);
    if (adminNote.length < 3) throw problem(400, 'Cần nhập lý do thất bại từ 3–500 ký tự.');
    return prisma.$transaction(async tx => {
      const request = await tx.withdrawalRequest.findUnique({ where: { id } });
      if (!request) throw problem(404, 'Không tìm thấy yêu cầu rút tiền.');
      if (!['PENDING', 'APPROVED'].includes(request.status)) {
        throw problem(409, 'Yêu cầu rút tiền đã được xử lý. Tải lại danh sách.');
      }
      const changed = await tx.withdrawalRequest.updateMany({
        where: { id, status: request.status },
        data: {
          status: 'FAILED',
          adminNote,
          reviewedBy: request.reviewedBy || actorId,
          reviewedAt: request.reviewedAt || new Date(),
        },
      });
      if (!changed.count) throw problem(409, 'Yêu cầu rút tiền vừa được xử lý. Tải lại danh sách.');
      await releaseHeld(tx, request, 'WITHDRAWAL_FAILED', adminNote);
      await audit(tx, actorId, 'WITHDRAWAL_FAILED', 'WITHDRAWAL_REQUEST', id, {
        userId: request.userId, amount: request.amount.toString(), adminNote,
      });
      const saved = await tx.withdrawalRequest.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return serializeWithdrawal(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** Returns held money of a rejected/failed withdrawal to the balance. */
  async function releaseHeld(tx, request, reason, note) {
    const wallet = await ensureWallet(tx, request.userId);
    const held = wallet.heldBalance;
    if (held.lessThan(request.amount)) {
      throw problem(409, 'Số tiền đang giữ không đủ để hoàn lại. Kiểm tra lại ví.');
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        heldBalance: held.sub(request.amount),
        balance: wallet.balance.add(request.amount),
      },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: request.userId,
        type: TRANSACTION_TYPES.WITHDRAWAL_RELEASE,
        direction: 'CREDIT',
        amount: request.amount,
        balanceAfter: wallet.balance.add(request.amount),
        reference: `WD-RETURN-${request.id}`,
        status: 'COMPLETED',
        note: note || reason,
      },
    });
  }

  /**
   * Pays a wholesale order with the buyer wallet.
   * The amount always comes from the order row in the database, the client can
   * never choose how much to pay.
   */
  async function payOrder(buyerId, orderId) {
    return prisma.$transaction(async tx => {
      const order = await tx.wholesaleOrder.findUnique({
        where: { id: orderId },
        include: { supplier: { include: { user: true } } },
      });
      if (!order) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (order.buyerId !== buyerId) {
        throw problem(403, 'Bạn không có quyền thanh toán đơn hàng này.');
      }
      if (['REJECTED', 'DELIVERED'].includes(order.status)) {
        throw problem(409, 'Đơn hàng không ở trạng thái có thể thanh toán bằng ví.');
      }
      const existing = await tx.orderPayment.findUnique({ where: { orderId } });
      if (existing) {
        throw problem(409, 'Đơn hàng này đã được thanh toán bằng ví.');
      }
      const amount = order.total;
      if (amount.lessThanOrEqualTo(0)) {
        throw problem(409, 'Đơn hàng không có số tiền hợp lệ để thanh toán.');
      }
      const wallet = await ensureWallet(tx, buyerId);
      if (wallet.balance.lessThan(amount)) {
        throw problem(409, 'Số dư khả dụng không đủ để thanh toán đơn hàng.');
      }
      const commissionAmount = order.commissionRate === null
        ? null
        : amount.mul(order.commissionRate).div(100).toDecimalPlaces(2);
      const supplierAmount = commissionAmount === null ? amount : amount.sub(commissionAmount);
      const payment = await tx.orderPayment.create({
        data: {
          orderId,
          buyerId,
          supplierUserId: order.supplier.userId,
          amount,
          commissionAmount,
          supplierAmount,
          status: 'PAID',
          reference: `OP-${orderId}-${Date.now()}`,
        },
      });
      await applyBalance(tx, {
        wallet,
        userId: buyerId,
        type: TRANSACTION_TYPES.ORDER_PAYMENT,
        direction: 'DEBIT',
        amount,
        reference: `OP-PAY-${payment.id}`,
        orderId,
        note: `Thanh toán đơn hàng #${orderId}`,
      });
      await audit(tx, buyerId, 'ORDER_PAID_WITH_WALLET', 'ORDER', orderId, {
        paymentId: payment.id, amount: amount.toString(),
        commissionAmount: commissionAmount ? commissionAmount.toString() : null,
        supplierAmount: supplierAmount ? supplierAmount.toString() : null,
      });
      return serializeOrderPayment(payment);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Credits the supplier wallet once the order is delivered.
   * Called from the existing order status flow so no new order state is needed.
   */
  async function creditSupplierForOrder(tx, order) {
    return settleOrderToSupplier(tx, order);
  }

  /**
   * Refunds a paid order. The refund row is unique per payment so the money
   * can never be returned twice.
   */
  async function refundOrder(actorId, orderId, body = {}) {
    const reason = text(body.reason, 500);
    if (reason.length < 3) throw problem(400, 'Cần nhập lý do hoàn tiền từ 3–500 ký tự.');
    return prisma.$transaction(async tx => {
      const order = await tx.wholesaleOrder.findUnique({ where: { id: orderId } });
      if (!order) throw problem(404, 'Không tìm thấy đơn hàng.');
      const refund = await refundPaidOrder(tx, { orderId, actorId, reason });
      return { id: refund.id, orderId, amount: money(refund.amount), reason, status: refund.status };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function listOrderPayments(userId, query = {}) {
    const page = query.page === undefined ? 1 : Number(query.page);
    const scope = text(query.scope, 20);
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      throw problem(400, 'Trang không hợp lệ.');
    }
    if (scope && !['BUYER', 'SUPPLIER'].includes(scope)) {
      throw problem(400, 'Phạm vi không hợp lệ.');
    }
    const where = scope === 'SUPPLIER'
      ? { supplierUserId: userId }
      : { buyerId: userId };
    const [rows, total] = await Promise.all([
      prisma.orderPayment.findMany({
        where,
        include: {
          buyer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          refund: { select: { id: true, status: true, amount: true, reason: true } },
        },
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.orderPayment.count({ where }),
    ]);
    return {
      payments: rows.map(serializeOrderPayment),
      total,
      page,
      hasMore: page * 20 < total,
    };
  }

  return {
    getWallet,
    listTransactions,
    createDepositRequest,
    createSandboxDepositRequest,
    createQrDepositRequest,
    confirmQrDeposit,
    listDepositRequests,
    approveDeposit,
    rejectDeposit,
    createWithdrawalRequest,
    createSandboxWithdrawalRequest,
    listWithdrawalRequests,
    approveWithdrawal,
    rejectWithdrawal,
    completeWithdrawal,
    failWithdrawal,
    payOrder,
    creditSupplierForOrder,
    refundOrder,
    listOrderPayments,
  };
}

module.exports = {
  createWalletService,
  ensureWallet,
  applyBalance,
  holdAmount,
  settleOrderToSupplier,
  refundPaidOrder,
  TRANSACTION_TYPES,
  METHODS,
  STATUS_LABELS,
  serializeWallet,
  serializeTransaction,
  serializeDeposit,
  serializeWithdrawal,
  serializeOrderPayment,
  parseAmount,
  money,
  UUID,
};

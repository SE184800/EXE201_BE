const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const {
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
} = require('../services/walletService');

const ZERO = new Prisma.Decimal(0);

// Helper to simulate wallet balance state transitions without requiring a live SQL Server connection.
class MockWalletLedger {
  constructor(initialBalance = 0, initialHeld = 0) {
    this.balance = new Prisma.Decimal(initialBalance);
    this.heldBalance = new Prisma.Decimal(initialHeld);
    this.transactions = [];
  }

  get available() {
    return money(this.balance);
  }

  get held() {
    return money(this.heldBalance);
  }

  get total() {
    return money(this.balance.add(this.heldBalance));
  }

  // 1. Credit Deposit
  deposit(amountNum, type = TRANSACTION_TYPES.DEPOSIT, ref = 'DEP-001') {
    const amount = parseAmount(amountNum);
    this.balance = this.balance.add(amount);
    const tx = {
      type,
      direction: 'CREDIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      reference: ref,
      status: 'COMPLETED',
    };
    this.transactions.push(tx);
    return tx;
  }

  // 2. Lock Escrow (Cọc ký quỹ)
  lockEscrow(amountNum, orderId = 1) {
    const amount = parseAmount(amountNum);
    if (this.balance.lessThan(amount)) {
      throw new Error('Số dư ví khả dụng không đủ để ký quỹ cọc.');
    }
    this.balance = this.balance.sub(amount);
    this.heldBalance = this.heldBalance.add(amount);
    const tx = {
      type: TRANSACTION_TYPES.ESCROW_LOCK,
      direction: 'DEBIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      orderId,
      status: 'COMPLETED',
    };
    this.transactions.push(tx);
    return tx;
  }

  // 3. Release Escrow to Supplier (Thành công khi giao hàng)
  releaseEscrowToSupplier(amountNum, supplierLedger, commissionRate = 2.5, orderId = 1) {
    const depositAmount = parseAmount(amountNum);
    if (this.heldBalance.lessThan(depositAmount)) {
      throw new Error('Số tiền ký quỹ đang giữ không đủ để giải phóng.');
    }
    this.heldBalance = this.heldBalance.sub(depositAmount);
    if (this.heldBalance.lessThan(0)) this.heldBalance = ZERO;

    this.transactions.push({
      type: TRANSACTION_TYPES.ESCROW_RELEASE,
      direction: 'DEBIT',
      amount: money(depositAmount),
      balanceAfter: money(this.balance),
      orderId,
    });

    // Supplier receives deposit minus platform commission
    const commission = commissionRate > 0
      ? depositAmount.mul(commissionRate).div(100).toDecimalPlaces(2)
      : ZERO;
    const netSupplier = depositAmount.sub(commission);

    supplierLedger.balance = supplierLedger.balance.add(netSupplier);
    supplierLedger.transactions.push({
      type: TRANSACTION_TYPES.ESCROW_RECEIVED,
      direction: 'CREDIT',
      amount: money(netSupplier),
      commissionAmount: money(commission),
      balanceAfter: money(supplierLedger.balance),
      orderId,
    });

    return {
      depositAmount: money(depositAmount),
      commissionAmount: money(commission),
      supplierAmount: money(netSupplier),
    };
  }

  // 4. Refund Escrow to Buyer (Admin phán quyết Tạp hóa thắng khiếu nại)
  refundEscrow(amountNum, orderId = 1, reason = 'Admin xử khiếu nại thắng') {
    const amount = parseAmount(amountNum);
    if (this.heldBalance.lessThan(amount)) {
      throw new Error('Số tiền đang giữ không đủ để hoàn cọc.');
    }
    this.heldBalance = this.heldBalance.sub(amount);
    if (this.heldBalance.lessThan(0)) this.heldBalance = ZERO;
    this.balance = this.balance.add(amount);

    const tx = {
      type: TRANSACTION_TYPES.ESCROW_REFUND,
      direction: 'CREDIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      orderId,
      note: reason,
    };
    this.transactions.push(tx);
    return tx;
  }

  // 5. Confiscate Escrow for Supplier (Tạp hóa vi phạm / Chủ vựa thắng)
  confiscateEscrow(amountNum, supplierLedger, orderId = 1, reason = 'Bồi thường chủ vựa') {
    const amount = parseAmount(amountNum);
    if (this.heldBalance.lessThan(amount)) {
      throw new Error('Số tiền đang giữ không đủ để bồi thường.');
    }
    this.heldBalance = this.heldBalance.sub(amount);
    if (this.heldBalance.lessThan(0)) this.heldBalance = ZERO;

    this.transactions.push({
      type: TRANSACTION_TYPES.PENALTY_CONFISCATION,
      direction: 'DEBIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      orderId,
      note: reason,
    });

    supplierLedger.balance = supplierLedger.balance.add(amount);
    supplierLedger.transactions.push({
      type: TRANSACTION_TYPES.COMPENSATION_RECEIVED,
      direction: 'CREDIT',
      amount: money(amount),
      balanceAfter: money(supplierLedger.balance),
      orderId,
      note: reason,
    });
  }

  // 6. Create Withdrawal Request (Chủ vựa / Tạp hóa xin rút tiền)
  requestWithdrawal(amountNum) {
    const amount = parseAmount(amountNum);
    if (this.balance.lessThan(amount)) {
      throw new Error('Số dư khả dụng không đủ để rút tiền.');
    }
    this.balance = this.balance.sub(amount);
    this.heldBalance = this.heldBalance.add(amount);
    const tx = {
      type: TRANSACTION_TYPES.WITHDRAWAL_HOLD,
      direction: 'DEBIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      status: 'PENDING',
    };
    this.transactions.push(tx);
    return tx;
  }

  // 7. Complete Withdrawal (Admin xác nhận đã chuyển khoản thành công)
  completeWithdrawal(amountNum, ref = 'BANK-REF-999') {
    const amount = parseAmount(amountNum);
    if (this.heldBalance.lessThan(amount)) {
      throw new Error('Số tiền đang giữ không đủ để hoàn tất rút tiền.');
    }
    this.heldBalance = this.heldBalance.sub(amount);
    const tx = {
      type: TRANSACTION_TYPES.WITHDRAWAL_PAYOUT,
      direction: 'DEBIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      reference: ref,
      status: 'COMPLETED',
    };
    this.transactions.push(tx);
    return tx;
  }

  // 8. Reject / Fail Withdrawal (Admin từ chối -> hoàn tiền về số dư khả dụng)
  rejectWithdrawal(amountNum, reason = 'Sai số tài khoản') {
    const amount = parseAmount(amountNum);
    if (this.heldBalance.lessThan(amount)) {
      throw new Error('Số tiền đang giữ không đủ để hoàn lại.');
    }
    this.heldBalance = this.heldBalance.sub(amount);
    this.balance = this.balance.add(amount);
    const tx = {
      type: TRANSACTION_TYPES.WITHDRAWAL_RELEASE,
      direction: 'CREDIT',
      amount: money(amount),
      balanceAfter: money(this.balance),
      note: reason,
      status: 'COMPLETED',
    };
    this.transactions.push(tx);
    return tx;
  }
}

test('Admin Financial Ledger & Money Movement Suite', async (t) => {
  await t.test('1. Nạp tiền (Deposits) - Happy, Worst, and Edge cases', () => {
    const store = new MockWalletLedger(0, 0);

    // Happy case: Nạp 2,000,000 đ thành công
    store.deposit(2000000, TRANSACTION_TYPES.DEPOSIT, 'DEP-001');
    assert.equal(store.available, 2000000);
    assert.equal(store.held, 0);
    assert.equal(store.total, 2000000);
    assert.equal(store.transactions[0].direction, 'CREDIT');
    assert.equal(store.transactions[0].balanceAfter, 2000000);

    // Nạp thêm 500,000 đ qua Sandbox
    store.deposit(500000, TRANSACTION_TYPES.SANDBOX_DEPOSIT, 'SANDBOX-002');
    assert.equal(store.available, 2500000);
    assert.equal(store.total, 2500000);

    // Worst case 1: Nạp số âm hoặc 0
    assert.throws(() => store.deposit(0), /Số tiền phải lớn hơn 0/);
    assert.throws(() => store.deposit(-100000), /Số tiền phải lớn hơn 0/);

    // Worst case 2: Nạp chuỗi không hợp lệ
    assert.throws(() => store.deposit('abc'), /Số tiền không hợp lệ/);
    assert.throws(() => store.deposit(NaN), /Số tiền không hợp lệ/);
    assert.throws(() => store.deposit(Infinity), /Số tiền không hợp lệ/);

    // Edge case: Nạp vượt giới hạn 1.000 tỷ đồng
    assert.throws(() => store.deposit(1000000000001), /không vượt quá 1.000 tỷ/);
  });

  await t.test('2. Ký quỹ Escrow 10% - Happy, Insufficient Balance & Total Integrity', () => {
    const buyer = new MockWalletLedger(1000000, 0);

    // Happy case: Đơn hàng 5,000,000 đ -> cọc 10% = 500,000 đ
    buyer.lockEscrow(500000, 101);
    assert.equal(buyer.available, 500000, 'Khả dụng giảm còn 500k');
    assert.equal(buyer.held, 500000, 'Held tăng lên 500k');
    assert.equal(buyer.total, 1000000, 'Tổng tài sản không thay đổi (bảo toàn)');

    // Worst case: Tiếp tục đặt cọc đơn khác 600,000 đ trong khi chỉ còn 500k khả dụng
    assert.throws(() => buyer.lockEscrow(600000, 102), /Số dư ví khả dụng không đủ để ký quỹ cọc/);

    // Tiền vẫn giữ nguyên vẹn
    assert.equal(buyer.available, 500000);
    assert.equal(buyer.held, 500000);
    assert.equal(buyer.total, 1000000);
  });

  await t.test('3. Quyết toán đơn hàng & Trích hoa hồng sàn (2.5%) - Happy case & Math Precision', () => {
    const buyer = new MockWalletLedger(500000, 500000); // 500k khả dụng, 500k cọc đang giữ
    const supplier = new MockWalletLedger(0, 0);

    // Giao hàng thành công: Giải phóng 500,000 đ cọc cho chủ vựa, hoa hồng sàn 2.5%
    const result = buyer.releaseEscrowToSupplier(500000, supplier, 2.5, 101);

    // Kiểm tra tính toán hoa hồng: 500,000 * 2.5% = 12,500 đ
    assert.equal(result.depositAmount, 500000);
    assert.equal(result.commissionAmount, 12500);
    assert.equal(result.supplierAmount, 487500);

    // Kiểm tra ví buyer: cọc held giảm về 0, available giữ nguyên 500,000
    assert.equal(buyer.held, 0);
    assert.equal(buyer.available, 500000);
    assert.equal(buyer.total, 500000);

    // Kiểm tra ví supplier: nhận 487,500 đ khả dụng
    assert.equal(supplier.available, 487500);
    assert.equal(supplier.held, 0);
    assert.equal(supplier.total, 487500);
    assert.equal(supplier.transactions[0].direction, 'CREDIT');
    assert.equal(supplier.transactions[0].type, TRANSACTION_TYPES.ESCROW_RECEIVED);
  });

  await t.test('4. Phân xử khiếu nại (Admin Dispute Arbitration) - Hoàn cọc & Tịch thu bồi thường', () => {
    // Kịch bản A: Admin phán quyết Tạp hóa thắng -> Hoàn cọc 100%
    const buyerA = new MockWalletLedger(200000, 300000); // 300k đang bị khóa cọc
    buyerA.refundEscrow(300000, 201, 'Hàng vỡ, admin xử tạp hóa thắng');
    assert.equal(buyerA.held, 0, 'Cọc held giảm về 0');
    assert.equal(buyerA.available, 500000, 'Tiền cọc trả về available');
    assert.equal(buyerA.total, 500000, 'Tổng tài sản bảo toàn');
    assert.equal(buyerA.transactions.at(-1).type, TRANSACTION_TYPES.ESCROW_REFUND);
    assert.equal(buyerA.transactions.at(-1).direction, 'CREDIT');

    // Kịch bản B: Admin phán quyết Tạp hóa bùng hàng / Chủ vựa thắng -> Tịch thu bồi thường
    const buyerB = new MockWalletLedger(100000, 300000);
    const supplierB = new MockWalletLedger(0, 0);
    buyerB.confiscateEscrow(300000, supplierB, 202, 'Tạp hóa từ chối nhận hàng không lý do');
    
    assert.equal(buyerB.held, 0, 'Cọc held bị trừ hết');
    assert.equal(buyerB.available, 100000, 'Available không được cộng');
    assert.equal(buyerB.total, 100000, 'Buyer mất 300k cọc');

    assert.equal(supplierB.available, 300000, 'Supplier nhận 300k bồi thường');
    assert.equal(supplierB.transactions.at(-1).type, TRANSACTION_TYPES.COMPENSATION_RECEIVED);
  });

  await t.test('5. Rút tiền về ngân hàng (Withdrawal Flow) - Happy case, Reject, and Double payout protection', () => {
    const supplier = new MockWalletLedger(3000000, 0);

    // Bước 1: Yêu cầu rút 1,000,000 đ
    supplier.requestWithdrawal(1000000);
    assert.equal(supplier.available, 2000000, 'Khả dụng giảm còn 2M');
    assert.equal(supplier.held, 1000000, 'Held tăng 1M để chờ admin duyệt');
    assert.equal(supplier.total, 3000000, 'Tổng tiền vẫn 3M');

    // Bước 2 (Edge case): Cố tình rút thêm 2,500,000 đ trong khi chỉ còn 2M khả dụng
    assert.throws(() => supplier.requestWithdrawal(2500000), /Số dư khả dụng không đủ để rút tiền/);

    // Kịch bản A: Admin từ chối rút tiền (do sai số tài khoản ngân hàng)
    supplier.rejectWithdrawal(1000000, 'Sai số tài khoản Vietcombank');
    assert.equal(supplier.held, 0, 'Held giải phóng');
    assert.equal(supplier.available, 3000000, 'Tiền hoàn lại ví khả dụng');
    assert.equal(supplier.transactions.at(-1).type, TRANSACTION_TYPES.WITHDRAWAL_RELEASE);

    // Kịch bản B: Rút lại và Admin duyệt thành công
    supplier.requestWithdrawal(1500000);
    assert.equal(supplier.available, 1500000);
    assert.equal(supplier.held, 1500000);

    supplier.completeWithdrawal(1500000, 'VCB-FT-20261106-999');
    assert.equal(supplier.held, 0, 'Held bị trừ hết sau khi chuyển khoản');
    assert.equal(supplier.available, 1500000, 'Khả dụng giữ nguyên 1.5M');
    assert.equal(supplier.total, 1500000, 'Tổng ví phản ánh đúng sau khi rút');
    assert.equal(supplier.transactions.at(-1).type, TRANSACTION_TYPES.WITHDRAWAL_PAYOUT);

    // Edge case: Cố tình hoàn tất rút tiền thêm lần nữa khi held đã về 0
    assert.throws(() => supplier.completeWithdrawal(1500000), /Số tiền đang giữ không đủ/);
  });

  await t.test('6. Định dạng và hiển thị (Serialization & Decimals) - Không bị sai số dấu phẩy động', () => {
    // 0.1 + 0.2 trong JavaScript bằng 0.30000000000000004
    // Prisma.Decimal và hàm money() phải chuẩn hóa về chính xác 0.3
    const d1 = new Prisma.Decimal('0.1');
    const d2 = new Prisma.Decimal('0.2');
    const sum = d1.add(d2);
    assert.equal(money(sum), 0.3, 'Decimal arithmetic không bị trôi số');

    // Kiểm tra serializeWallet
    const rawWallet = {
      id: 42,
      balance: new Prisma.Decimal('1250000.50'),
      heldBalance: new Prisma.Decimal('250000.25'),
      currency: 'VND',
      updatedAt: new Date(),
    };
    const serialized = serializeWallet(rawWallet);
    assert.equal(serialized.balance, 1250000.5);
    assert.equal(serialized.heldBalance, 250000.25);
    assert.equal(serialized.total, 1500000.75);
    assert.equal(serialized.currency, 'VND');

    // Kiểm tra nhãn trạng thái giao dịch
    assert.equal(STATUS_LABELS.PENDING, 'Chờ duyệt');
    assert.equal(STATUS_LABELS.APPROVED, 'Đã duyệt');
    assert.equal(STATUS_LABELS.REJECTED, 'Đã từ chối');
    assert.equal(STATUS_LABELS.COMPLETED, 'Hoàn tất');
  });
});

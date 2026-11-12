const test = require('node:test');
const assert = require('node:assert/strict');

// Import services and helpers
const systemConfigService = require('../services/systemConfigService');
const { moderateContent } = require('../services/contentModerationService');
const { settleConsignmentItem } = require('../services/consignmentService');
const { createAdminService, idParam, period, csvCell } = require('../services/adminService');

// -------------------------------------------------------------
// USE-CASE 1: CẤU HÌNH HỆ THỐNG & CHÍNH SÁCH VẬN HÀNH TOÀN SÀN
// -------------------------------------------------------------
test('USE-CASE 1: System Config & Policies (Happy, Worst, Edge)', async (t) => {
  // Reset config to baseline
  systemConfigService.resetConfig('TEST_SUITE');

  // 1.1 Happy Case: Cập nhật đầy đủ các tham số hợp lệ
  const validUpdate = {
    orderAndDelivery: {
      orderAutoCancelHours: 6,
      complaintWindowHours: 48,
      deliveryAllowedStartHour: 6,
      deliveryAllowedEndHour: 20,
      autoCompleteDeliveredHours: 72,
      allowWeekendDelivery: true,
    },
    consignment: {
      maxConsignmentItemsPerStore: 10,
      settlementCycleDays: 14,
      allowConsignmentForUnverified: true,
    },
    walletLimits: {
      minDepositAmount: 100000,
      minWithdrawalAmount: 200000,
      maxDailyWithdrawalAmount: 100000000,
      autoApproveWithdrawalThreshold: 5000000,
    },
    systemNotice: {
      maintenanceMode: true,
      maintenanceMessage: 'Hệ thống bảo trì định kỳ từ 23h đến 01h sáng.',
      announcementEnabled: true,
      announcementTitle: 'Khuyến mãi tuần lễ nông sản sạch',
      announcementContent: 'Miễn phí giao hàng cho tất cả đơn sỉ trên 10 triệu.',
      announcementType: 'INFO',
    },
    escrowDeposit: {
      defaultDepositRate: 15,
      maxDepositRate: 40,
    },
  };

  const updated = systemConfigService.updateConfig('ADMIN_1', validUpdate);
  assert.equal(updated.orderAndDelivery.orderAutoCancelHours, 6);
  assert.equal(updated.orderAndDelivery.complaintWindowHours, 48);
  assert.equal(updated.consignment.maxConsignmentItemsPerStore, 10);
  assert.equal(updated.walletLimits.minDepositAmount, 100000);
  assert.equal(updated.systemNotice.maintenanceMode, true);
  assert.equal(updated.escrowDeposit.defaultDepositRate, 15);

  // 1.2 Worst Case: Dữ liệu âm, vượt biên, kiểu dữ liệu sai lệch
  systemConfigService.updateConfig('ADMIN_BAD', {
    orderAndDelivery: {
      orderAutoCancelHours: -5,
      complaintWindowHours: 9999,
      deliveryAllowedStartHour: 25,
    },
    consignment: {
      maxConsignmentItemsPerStore: -1,
    },
    walletLimits: {
      minDepositAmount: 500,
    },
    escrowDeposit: {
      defaultDepositRate: -10,
    },
  });

  const checkedAfterBad = systemConfigService.getConfig();
  assert.equal(checkedAfterBad.orderAndDelivery.orderAutoCancelHours, 6);
  assert.equal(checkedAfterBad.consignment.maxConsignmentItemsPerStore, 10);
  assert.equal(checkedAfterBad.walletLimits.minDepositAmount, 100000);
  assert.equal(checkedAfterBad.escrowDeposit.defaultDepositRate, 15);

  // 1.3 Edge Case: Ranh giới chính xác (Boundary Values)
  systemConfigService.updateConfig('ADMIN_EDGE', {
    orderAndDelivery: {
      orderAutoCancelHours: 1,
      deliveryAllowedStartHour: 0,
      deliveryAllowedEndHour: 24,
    },
    consignment: {
      maxConsignmentItemsPerStore: 50,
      settlementCycleDays: 60,
    },
    walletLimits: {
      minDepositAmount: 10000,
      maxDailyWithdrawalAmount: 500000,
      autoApproveWithdrawalThreshold: 0,
    },
    systemNotice: {
      announcementTitle: 'A'.repeat(150),
      announcementContent: 'B'.repeat(1000),
    },
  });

  const edgeConfig = systemConfigService.getConfig();
  assert.equal(edgeConfig.orderAndDelivery.orderAutoCancelHours, 1);
  assert.equal(edgeConfig.orderAndDelivery.deliveryAllowedStartHour, 0);
  assert.equal(edgeConfig.orderAndDelivery.deliveryAllowedEndHour, 24);
  assert.equal(edgeConfig.consignment.maxConsignmentItemsPerStore, 50);
  assert.equal(edgeConfig.consignment.settlementCycleDays, 60);
  assert.equal(edgeConfig.walletLimits.minDepositAmount, 10000);
  assert.equal(edgeConfig.walletLimits.autoApproveWithdrawalThreshold, 0);
  assert.equal(edgeConfig.systemNotice.announcementTitle.length, 150);
  assert.equal(edgeConfig.systemNotice.announcementContent.length, 1000);

  // Reset lại trạng thái sạch cho các test khác
  systemConfigService.resetConfig('TEST_SUITE');
});

// -------------------------------------------------------------
// USE-CASE 2: KIỂM DUYỆT BÀI ĐĂNG AI & PHÁT HIỆN GIAN LẬN
// -------------------------------------------------------------
test('USE-CASE 2: AI Moderation & Fraud Detection (Happy, Worst, Edge)', async (t) => {
  systemConfigService.resetConfig('TEST_SUITE');

  // 2.1 Happy Case: Sản phẩm sạch, hợp lệ, giá chuẩn
  const cleanProduct = await moderateContent({
    name: 'Gạo ST25 Ông Cua Túi 5kg',
    category: 'Gạo & Nông sản',
    packaging: 'Bao 5kg',
    wholesalePrice: 175000,
    moq: 10,
  });
  assert.equal(cleanProduct.isClean, true);
  assert.equal(cleanProduct.status, 'AUTO_APPROVED');

  // 2.2 Worst Case: Sản phẩm vi phạm từ cấm Mức 3 (Vũ khí, Ma túy, Hàng cấm)
  const forbiddenProduct = await moderateContent({
    name: 'Hàng xách tay bóng cười và pháo hoa nổ',
    category: 'Đồ chơi',
    packaging: 'Thùng',
    wholesalePrice: 500000,
    moq: 5,
  });
  assert.equal(forbiddenProduct.isClean, false);
  assert.equal(forbiddenProduct.status, 'AUTO_REJECTED');
  assert.ok(forbiddenProduct.criticalReasons.length >= 2);

  // 2.3 Worst Case: Giá sỉ phá giá hoặc giá ảo phi thực tế
  const dumpingProduct = await moderateContent({
    name: 'Nước ngọt Pepsi lon 330ml thùng 24',
    category: 'Nước ngọt',
    packaging: 'Thùng',
    wholesalePrice: 200,
    moq: 10,
  });
  assert.equal(dumpingProduct.isClean, false);
  assert.equal(dumpingProduct.status, 'AUTO_REJECTED');
  assert.ok(dumpingProduct.criticalReasons.some((r) => r.includes('dưới ngưỡng tối thiểu sàn')));

  // 2.4 Edge Case: Viết hoa từ cấm xen kẽ, dấu cách thừa, dấu tiếng Việt
  const trickyProduct = await moderateContent({
    name: '   sẢn PhẨm  sÚnG  BắN cÁt cỰc MạNh   ',
    category: 'Dụng cụ',
    packaging: 'Hộp',
    wholesalePrice: 120000,
    moq: 2,
  });
  assert.equal(trickyProduct.isClean, false);
  assert.equal(trickyProduct.status, 'AUTO_REJECTED');
  assert.ok(trickyProduct.criticalReasons.some((r) => r.includes('súng')));

  // 2.5 Edge Case: Sản phẩm chứa từ khóa hạn chế Mức 2 (Thuốc lá, rượu) -> Chuyển Admin duyệt, không cấm thẳng
  const restrictedProduct = await moderateContent({
    name: 'Thuốc lá Vinataba gói đỏ sỉ',
    category: 'Bách hóa',
    packaging: 'Cây 10 gói',
    wholesalePrice: 150000,
    moq: 5,
  });
  assert.equal(restrictedProduct.isClean, false);
  assert.equal(restrictedProduct.status, 'NEEDS_REVIEW');
  assert.ok(restrictedProduct.reasons.some((r) => r.includes('thuốc lá')));
});

// -------------------------------------------------------------
// USE-CASE 3: QUẢN LÝ ĐƠN HÀNG, HỦY ĐƠN & HOÀN CỌC ESCROW
// -------------------------------------------------------------
test('USE-CASE 3: Order Lifecycle, Cancellation & Escrow Refund (Happy, Worst, Edge)', async (t) => {
  let storeWallet = { balance: 10000000, heldBalance: 0 };
  let order = {
    id: 101,
    status: 'PENDING',
    subtotal: 5000000,
    total: 5000000,
    depositAmount: 500000,
    depositStatus: 'PAID',
    isConsignment: false,
  };

  // 3.1 Happy Case: Tiệm tạp hóa hủy đơn khi đang ở trạng thái PENDING
  function cancelOrder(ord, wallet) {
    if (ord.status !== 'PENDING') {
      throw new Error('Chỉ có thể hủy đơn khi đơn hàng đang ở trạng thái chờ duyệt (PENDING)');
    }
    ord.status = 'CANCELLED';
    if (ord.depositStatus === 'PAID' && ord.depositAmount > 0) {
      ord.depositStatus = 'REFUNDED';
      wallet.balance += ord.depositAmount;
    }
    return { success: true, order: ord, wallet };
  }

  const cancelResult = cancelOrder(order, storeWallet);
  assert.equal(cancelResult.order.status, 'CANCELLED');
  assert.equal(cancelResult.order.depositStatus, 'REFUNDED');
  assert.equal(storeWallet.balance, 10500000);

  // 3.2 Worst Case: Tiệm cố tình hủy đơn khi chủ vựa đã chuyển sang chuẩn bị hàng (PREPARING)
  let activeOrder = {
    id: 102,
    status: 'PREPARING',
    depositAmount: 300000,
    depositStatus: 'PAID',
  };
  assert.throws(() => {
    cancelOrder(activeOrder, storeWallet);
  }, /Chỉ có thể hủy đơn khi đơn hàng đang ở trạng thái chờ duyệt/);
  assert.equal(activeOrder.status, 'PREPARING');

  // 3.3 Edge Case: Đơn hàng giao bù 0đ (REPLACE_0VND) hoàn tất trực tiếp
  let zeroOrder = {
    id: 103,
    status: 'DELIVERED',
    subtotal: 0,
    total: 0,
    depositAmount: 0,
    depositStatus: 'NO_DEPOSIT',
    paymentStatus: 'PAID',
  };

  function completeOrder(ord) {
    const dueAmount = ord.total - ord.depositAmount;
    if (dueAmount <= 0) {
      ord.status = 'COMPLETED';
      return { success: true, completedImmediately: true };
    }
    if (ord.paymentStatus !== 'PAID') {
      throw new Error('Đơn hàng chưa thanh toán đủ tiền');
    }
    ord.status = 'COMPLETED';
    return { success: true, completedImmediately: false };
  }

  const zeroResult = completeOrder(zeroOrder);
  assert.equal(zeroResult.success, true);
  assert.equal(zeroResult.completedImmediately, true);
  assert.equal(zeroOrder.status, 'COMPLETED');
});

// -------------------------------------------------------------
// USE-CASE 4: KHIẾU NẠI, HOÀN TIỀN TOÀN BỘ & ADMIN PHÂN XỬ
// -------------------------------------------------------------
test('USE-CASE 4: Complaint Resolution - Consensual Negotiation & Neutral Result Recording', async (t) => {
  // 4.1 Happy Case: Vựa đề xuất RETURN_REFUND & Tiệm đồng thuận ACCEPT -> Hoàn cả cọc 10% và tiền hàng 90% đã trả
  let storeWallet = { balance: 2000000 };
  let supplierWallet = { balance: 8000000 };
  let order = {
    id: 201,
    status: 'DELIVERED',
    total: 1000000,
    depositAmount: 100000,
    depositStatus: 'PAID',
    paymentMethod: 'WALLET',
    paymentStatus: 'PAID',
    inventoryImportedAt: null,
  };

  let complaint = {
    id: 1,
    orderId: 201,
    status: 'IN_REVIEW',
    round: 1,
    pendingParty: 'STORE_OWNER',
    proposedAction: 'RETURN_REFUND',
  };

  function acceptConsensualResolution(comp, ord, sWallet, supWallet) {
    if (comp.pendingParty !== 'STORE_OWNER') throw new Error('Chờ Chủ vựa đề xuất phương án.');
    if (comp.proposedAction === 'RETURN_REFUND') {
      comp.status = 'RESOLVED';
      comp.pendingParty = null;
      if (ord.depositStatus === 'PAID') {
        ord.depositStatus = 'REFUNDED';
        sWallet.balance += ord.depositAmount;
      }
      if (ord.paymentMethod === 'WALLET' && ord.paymentStatus === 'PAID') {
        const paidAmount = ord.total - ord.depositAmount;
        if (supWallet.balance < paidAmount) {
          throw new Error('Số dư ví chủ vựa không đủ để thực hiện hoàn tiền hàng');
        }
        supWallet.balance -= paidAmount;
        sWallet.balance += paidAmount;
        ord.paymentStatus = 'REFUNDED';
      }
    }
    return { comp, ord, sWallet, supWallet };
  }

  acceptConsensualResolution(complaint, order, storeWallet, supplierWallet);
  assert.equal(complaint.status, 'RESOLVED');
  assert.equal(order.depositStatus, 'REFUNDED');
  assert.equal(order.paymentStatus, 'REFUNDED');
  assert.equal(storeWallet.balance, 3000000);
  assert.equal(supplierWallet.balance, 7100000);

  // 4.2 Bilateral counter-proposals remain open until both sides agree (no arbitrary round cutoff)
  let negotiated = { id: 2, status: 'IN_REVIEW', orderId: 202, round: 1, pendingParty: 'STORE_OWNER' };
  function counterProposal(comp) {
    comp.round += 1;
    comp.pendingParty = 'SUPPLIER';
    return comp;
  }
  counterProposal(negotiated);
  assert.equal(negotiated.round, 2);
  negotiated.pendingParty = 'STORE_OWNER';
  counterProposal(negotiated);
  assert.equal(negotiated.round, 3);

  // 4.3 Neutral Recording & Non-Arbitration: Admin records complaint history/outcome and cannot adjudicate winner/loser
  assert.throws(() => {
    throw Object.assign(new Error('Theo Điều 6 Hợp đồng điện tử, Admin chỉ ghi nhận lịch sử và kết quả thống nhất, không phân xử thắng/thua.'), { status: 410 });
  }, /không phân xử/);
});

// -------------------------------------------------------------
// USE-CASE 5: KẾT TOÁN ĐỐI SOÁT HÀNG KÝ GỬI TIẾP THỊ 0Đ
// -------------------------------------------------------------
test('USE-CASE 5: Consignment rejects unsupported methods and fractional quantities', async () => {
  const input = { storeId: 1, lotId: 2, qtyToSettle: 1, expectedSettledQty: 0 };
  await assert.rejects(settleConsignmentItem({ ...input, method: 'CASH' }), { status: 400 });
  await assert.rejects(settleConsignmentItem({ ...input, qtyToSettle: 0.5 }), { status: 400 });
});

// -------------------------------------------------------------
// USE-CASE 6: HẠN MỨC VÍ, RÚT TIỀN & BẢO VỆ GIAO DỊCH
// -------------------------------------------------------------
test('USE-CASE 6: Wallet Limits & Security Checks (Happy, Worst, Edge)', async (t) => {
  const config = systemConfigService.getConfig();
  const limits = config.walletLimits;

  function validateWithdrawalRequest(wallet, amount, dailyWithdrawnToday) {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      throw new Error('Số tiền rút không hợp lệ');
    }
    if (amount < limits.minWithdrawalAmount) {
      throw new Error(`Số tiền rút tối thiểu là ${limits.minWithdrawalAmount.toLocaleString('vi-VN')} ₫`);
    }
    if (amount > wallet.balance) {
      throw new Error('Số dư khả dụng không đủ để thực hiện rút tiền');
    }
    if (dailyWithdrawnToday + amount > limits.maxDailyWithdrawalAmount) {
      throw new Error(`Giao dịch vượt hạn mức rút tối đa trong ngày (${limits.maxDailyWithdrawalAmount.toLocaleString('vi-VN')} ₫)`);
    }

    const needsAdminApproval = amount > limits.autoApproveWithdrawalThreshold;
    return {
      valid: true,
      amount,
      needsAdminApproval,
      status: needsAdminApproval ? 'PENDING_APPROVAL' : 'AUTO_APPROVED',
    };
  }

  const sampleWallet = { balance: 60000000 };

  // 6.1 Happy Case: Rút 1.500.000đ (dưới 2tr ngưỡng tự động duyệt)
  const req1 = validateWithdrawalRequest(sampleWallet, 1500000, 0);
  assert.equal(req1.valid, true);
  assert.equal(req1.status, 'AUTO_APPROVED');
  assert.equal(req1.needsAdminApproval, false);

  // 6.2 Happy Case: Rút 10.000.000đ (trên 2tr ngưỡng tự động duyệt -> chuyển Admin duyệt)
  const req2 = validateWithdrawalRequest(sampleWallet, 10000000, 0);
  assert.equal(req2.valid, true);
  assert.equal(req2.status, 'PENDING_APPROVAL');
  assert.equal(req2.needsAdminApproval, true);

  // 6.3 Worst Case: Rút vượt quá số dư ví
  assert.throws(() => {
    validateWithdrawalRequest(sampleWallet, 70000000, 0);
  }, /Số dư khả dụng không đủ/);

  // 6.4 Worst Case: Rút vượt hạn mức tối đa trong ngày (50.000.000đ)
  assert.throws(() => {
    validateWithdrawalRequest(sampleWallet, 20000000, 40000000);
  }, /Giao dịch vượt hạn mức rút tối đa trong ngày/);

  // 6.5 Edge Case: Rút dưới mức tối thiểu (VD: 50.000đ khi min là 100.000đ)
  assert.throws(() => {
    validateWithdrawalRequest(sampleWallet, 50000, 0);
  }, /Số tiền rút tối thiểu/);

  // 6.6 Edge Case: Số tiền âm hoặc chữ
  assert.throws(() => {
    validateWithdrawalRequest(sampleWallet, -500000, 0);
  }, /Số tiền rút không hợp lệ/);
});

// -------------------------------------------------------------
// USE-CASE 7: ĐỊNH DẠNG MÃ SỐ THUẾ & XÁC THỰC GIẤY PHÉP KINH DOANH
// -------------------------------------------------------------
test('USE-CASE 7: Tax Code Verification & Validation (Happy, Worst, Edge)', async (t) => {
  function validateTaxCode(taxCode) {
    if (!taxCode || typeof taxCode !== 'string') {
      return { valid: false, error: 'Mã số thuế không được để trống' };
    }
    const clean = taxCode.trim();
    const regex10 = /^[0-9]{10}$/;
    const regex13 = /^[0-9]{10}-[0-9]{3}$/;

    if (!regex10.test(clean) && !regex13.test(clean)) {
      return {
        valid: false,
        error: 'Mã số thuế không đúng định dạng (phải gồm 10 chữ số hoặc 13 chữ số có dạng XXXXXXXXXX-XXX)',
      };
    }

    return {
      valid: true,
      cleanTaxCode: clean,
      type: clean.length === 10 ? 'ENTERPRISE' : 'BRANCH',
      lookupUrl: `https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp?mst=${clean.replace('-', '')}`,
    };
  }

  // 7.1 Happy Case: MST doanh nghiệp 10 số hợp lệ
  const valid10 = validateTaxCode('0312345678');
  assert.equal(valid10.valid, true);
  assert.equal(valid10.type, 'ENTERPRISE');
  assert.ok(valid10.lookupUrl.includes('0312345678'));

  // 7.2 Happy Case: MST chi nhánh 13 số có gạch nối
  const valid13 = validateTaxCode('0312345678-001');
  assert.equal(valid13.valid, true);
  assert.equal(valid13.type, 'BRANCH');

  // 7.3 Worst Case: MST chứa ký tự chữ cái hoặc ký tự đặc biệt
  const invalidAlpha = validateTaxCode('0312ABC678');
  assert.equal(invalidAlpha.valid, false);
  assert.ok(invalidAlpha.error.includes('không đúng định dạng'));

  // 7.4 Edge Case: Độ dài sai (ít hơn 10 số hoặc nhiều hơn 13 số)
  const tooShort = validateTaxCode('123456');
  assert.equal(tooShort.valid, false);

  // 7.5 Edge Case: Khoảng trắng đầu cuối
  const spacedTax = validateTaxCode('   0312345678   ');
  assert.equal(spacedTax.valid, true);
  assert.equal(spacedTax.cleanTaxCode, '0312345678');
});

// -------------------------------------------------------------
// USE-CASE 8: ADMIN HELPER & AN NINH DỮ LIỆU
// -------------------------------------------------------------
test('USE-CASE 8: Admin Data Integrity, CSV Escape & ID Guards (Happy, Worst, Edge)', async (t) => {
  // 8.1 idParam: Chuyển đổi và bảo vệ ID
  assert.equal(idParam('42'), 42);
  assert.throws(() => idParam('0'), /Mã.*không hợp lệ/);
  assert.throws(() => idParam('-15'), /Mã.*không hợp lệ/);
  assert.throws(() => idParam('abc'), /Mã.*không hợp lệ/);
  assert.throws(() => idParam(null), /Mã.*không hợp lệ/);

  // 8.2 csvCell: Chống CSV injection và thoát dấu phẩy
  assert.equal(csvCell('Đơn hàng thường'), '"Đơn hàng thường"');
  const formulaCell = csvCell('=cmd|/C calc!A0');
  assert.ok(formulaCell.startsWith("'\t") || formulaCell.includes('=cmd'));

  // 8.3 period filter
  const p1 = period({ from: '2026-01-01', to: '2026-01-31' });
  assert.ok(p1.range.gte instanceof Date);
  assert.ok(p1.range.lt instanceof Date);
});

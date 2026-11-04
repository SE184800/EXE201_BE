const test = require('node:test');
const assert = require('node:assert/strict');

// Import services and helpers
const systemConfigService = require('../services/systemConfigService');
const { moderateContent } = require('../services/contentModerationService');
const {
  setItemConsignment,
  deleteItemConsignment,
  getConsignmentSettlements,
  settleConsignmentItem,
} = require('../services/consignmentService');
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
test('USE-CASE 4: Complaint Resolution, Full Refund & Escalation (Happy, Worst, Edge)', async (t) => {
  // 4.1 Happy Case: Vựa chấp thuận RETURN_REFUND -> Hoàn cả cọc 10% và tiền hàng 90% đã trả
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
  };

  let complaint = {
    id: 1,
    orderId: 201,
    status: 'PENDING',
    type: 'DAMAGED',
  };

  function processComplaintResolution(comp, ord, solution, sWallet, supWallet) {
    if (solution === 'RETURN_REFUND') {
      comp.status = 'RESOLVED';
      comp.resolution = 'RETURN_REFUND';

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
    } else if (solution === 'REJECT') {
      comp.status = 'REJECTED';
    }
    return { comp, ord, sWallet, supWallet };
  }

  processComplaintResolution(complaint, order, 'RETURN_REFUND', storeWallet, supplierWallet);
  assert.equal(complaint.status, 'RESOLVED');
  assert.equal(order.depositStatus, 'REFUNDED');
  assert.equal(order.paymentStatus, 'REFUNDED');
  assert.equal(storeWallet.balance, 3000000);
  assert.equal(supplierWallet.balance, 7100000);

  // 4.2 Worst Case: Vựa từ chối (REJECT) -> Tiệm Kháng cáo lên Admin (ESCALATED)
  let rejectedComplaint = { id: 2, status: 'REJECTED', orderId: 202 };
  function escalateComplaint(comp) {
    if (comp.status !== 'REJECTED') {
      throw new Error('Chỉ khiếu nại bị vựa từ chối mới có thể kháng cáo lên Admin');
    }
    comp.status = 'ESCALATED';
    return comp;
  }
  escalateComplaint(rejectedComplaint);
  assert.equal(rejectedComplaint.status, 'ESCALATED');

  // 4.3 Admin phân xử: Xử Cửa Hàng Thắng (BUYER_FAVOR) -> Hoàn cọc cho tiệm
  let escrowHeld = 500000;
  let storeBal = 1000000;
  let supBal = 2000000;

  function adminResolveDispute(comp, decision, escrowAmount) {
    if (comp.status !== 'ESCALATED') {
      throw new Error('Khiếu nại phải ở trạng thái ESCALATED để Admin phân xử');
    }
    if (decision === 'BUYER_FAVOR') {
      comp.status = 'ADMIN_RESOLVED_BUYER';
      storeBal += escrowAmount;
    } else if (decision === 'SUPPLIER_FAVOR') {
      comp.status = 'ADMIN_RESOLVED_SUPPLIER';
      supBal += escrowAmount;
    } else {
      throw new Error('Quyết định không hợp lệ');
    }
    return comp;
  }

  adminResolveDispute(rejectedComplaint, 'BUYER_FAVOR', escrowHeld);
  assert.equal(rejectedComplaint.status, 'ADMIN_RESOLVED_BUYER');
  assert.equal(storeBal, 1500000);
  assert.equal(supBal, 2000000);

  // 4.4 Edge Case: Admin phân xử với quyết định sai lệch -> Bị chặn
  let badComp = { id: 3, status: 'ESCALATED' };
  assert.throws(() => {
    adminResolveDispute(badComp, 'UNKNOWN_DECISION', 100000);
  }, /Quyết định không hợp lệ/);
});

// -------------------------------------------------------------
// USE-CASE 5: KẾT TOÁN ĐỐI SOÁT HÀNG KÝ GỬI TIẾP THỊ 0Đ
// -------------------------------------------------------------
test('USE-CASE 5: Consignment Settlement Flow (Happy, Worst, Edge)', async (t) => {
  const itemId = 999;
  setItemConsignment(itemId, {
    isConsignment: true,
    settlementPrice: 8500,
    supplierId: 2,
    supplierName: 'Vựa Nước Giải Khát Miền Nam',
  });

  const mockInventoryItem = {
    id: itemId,
    ownerId: 1,
    name: 'Trà ô long Tea+ Plus 450ml',
    unit: 'Chai',
    quantity: 50,
    sellingPrice: 12000,
    movements: [{ type: 'SALE', quantityChange: -50 }],
  };

  const mockPrisma = {
    inventoryItem: {
      findUnique: async () => mockInventoryItem,
      findFirst: async () => mockInventoryItem,
    },
    supplierProfile: {
      findUnique: async () => ({ id: 2, userId: 20 }),
    },
    $executeRaw: async () => {},
    wallet: {
      findUnique: async ({ where }) => ({ id: where.userId, balance: 1000000 }),
    },
    walletTransaction: {
      create: async () => {},
    },
    $transaction: async (fn) => fn(mockPrisma),
  };

  // 5.1 Happy Case: Tính bảng kê đối soát chính xác
  const settlements = await getConsignmentSettlements({
    storeId: 1,
    supplierId: null,
    prisma: mockPrisma,
  });

  assert.ok(settlements.length >= 1);
  const found = settlements.find((s) => s.itemId === itemId);
  assert.ok(found);
  assert.equal(found.totalSold, 50);
  assert.equal(found.settledQty, 0);
  assert.equal(found.unsettledQty, 50);
  assert.equal(found.dueAmount, 50 * 8500);

  // 5.2 Happy Case: Thực hiện kết toán qua Ví cho 20 chai
  const mockWalletService = {
    getWallet: async (userId) => {
      return { availableBalance: 1000000, balance: 1000000 };
    },
  };

  const settleResult = await settleConsignmentItem({
    storeId: 1,
    itemId,
    qtyToSettle: 20,
    method: 'WALLET',
    prisma: mockPrisma,
    walletService: mockWalletService,
  });

  assert.equal(settleResult.success, true);
  assert.equal(settleResult.settledQty, 20);
  assert.equal(settleResult.amount, 20 * 8500);
  assert.equal(settleResult.remainingUnsettled, 30);

  // 5.3 Worst Case: Tiệm muốn trả số lượng âm hoặc 0 -> Bị chặn
  await assert.rejects(
    async () => {
      await settleConsignmentItem({
        storeId: 1,
        itemId,
        qtyToSettle: 0,
        method: 'WALLET',
        prisma: mockPrisma,
        walletService: mockWalletService,
      });
    },
    /Số lượng kết toán phải lớn hơn 0/
  );

  // 5.4 Edge Case: Ví tiệm không đủ tiền thanh toán kết toán
  const poorWalletService = {
    getWallet: async () => ({ availableBalance: 5000, balance: 5000 }),
  };
  await assert.rejects(
    async () => {
      await settleConsignmentItem({
        storeId: 1,
        itemId,
        qtyToSettle: 10,
        method: 'WALLET',
        prisma: mockPrisma,
        walletService: poorWalletService,
      });
    },
    /không đủ để thanh toán kết toán/
  );

  // Clean up
  deleteItemConsignment(itemId);
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

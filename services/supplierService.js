const { audit, problem, httpsDocument, verificationComplete } = require('./platformPolicy');
const { moderateContent } = require('./contentModerationService');
const { walletService } = require('./walletService');
const deliveryService = require('./deliveryService');
const ORDER_STATUSES = Object.freeze([
  'PENDING', 'APPROVED', 'REJECTED', 'PREPARING', 'SHIPPING', 'ISSUE_HANDLING', 'DELIVERED',
]);

const STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối',
  PREPARING: 'Đang chuẩn bị', SHIPPING: 'Đang vận chuyển',
  ISSUE_HANDLING: 'Tiếp nhận xử lý', DELIVERED: 'Đã giao',
});

const TRANSITIONS = Object.freeze({
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PREPARING'],
  PREPARING: ['SHIPPING'],
  SHIPPING: ['ISSUE_HANDLING', 'DELIVERED'],
  ISSUE_HANDLING: ['DELIVERED', 'REJECTED'],
  REJECTED: [],
  DELIVERED: [],
});

function numberValue(value) {
  return typeof value === 'object' && value !== null && typeof value.toNumber === 'function'
    ? value.toNumber() : Number(value);
}

function hasTwoDecimals(value) {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
}

async function serializeProduct(product) {
  const latestPrice = product.priceHistory?.[0] || null;
  const changePercent = latestPrice ? numberValue(latestPrice.changePercent) : null;
  const mod = await moderateContent({
    name: product.name,
    category: product.category,
    packaging: product.packaging,
    wholesalePrice: numberValue(product.wholesalePrice),
    moq: product.moq,
  });
  return {
    category: product.category, imageUrl: product.imageUrl,
    id: product.id,
    name: product.name,
    packaging: product.packaging,
    wholesalePrice: numberValue(product.wholesalePrice),
    stockQty: product.stockQty,
    moq: product.moq,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    previousPrice: latestPrice ? numberValue(latestPrice.oldPrice) : null,
    priceChangePercent: changePercent,
    priceChangedAt: latestPrice?.createdAt || null,
    priceChangeReason: latestPrice?.reason || null,
    priceWarning: changePercent !== null && changePercent >= 20,
    moderation: mod,
  };
}

function serializeOrder(order) {
  return {
    commissionRate: order.commissionRate === null ? null : numberValue(order.commissionRate),
    commissionAmount: order.commissionAmount === null ? null : numberValue(order.commissionAmount),
    commissionPaidAt: order.commissionPaidAt, deliveredAt: order.deliveredAt,
    recipientName: order.recipientName, recipientPhone: order.recipientPhone, deliveryAddress: order.deliveryAddress,
    id: order.id,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status] || order.status,
    subtotal: numberValue(order.subtotal),
    deliveryFee: numberValue(order.deliveryFee),
    total: numberValue(order.total),
    dealStatus: order.dealStatus || null,
    proposedTotal: order.proposedTotal === null || order.proposedTotal === undefined ? null : numberValue(order.proposedTotal),
    agreedTotal: order.agreedTotal === null || order.agreedTotal === undefined ? null : numberValue(order.agreedTotal),
    dealResponse: order.dealResponse || null,
    depositRate: numberValue(order.depositRate || 0),
    depositAmount: numberValue(order.depositAmount || 0),
    depositStatus: order.depositStatus || 'NONE',
    depositReference: order.depositReference || null,
    depositBankName: order.depositBankName || null,
    depositBankAccountNumber: order.depositBankAccountNumber || null,
    depositBankAccountHolder: order.depositBankAccountHolder || null,
    depositSubmittedAt: order.depositSubmittedAt || null,
    depositPaidAt: order.depositPaidAt || null,
    depositReviewedAt: order.depositReviewedAt || null,
    depositRejectionReason: order.depositRejectionReason || null,
    depositRefundedAt: order.depositRefundedAt || null,
    depositRefundReference: order.depositRefundReference || null,
    note: order.note,
    rejectReason: order.rejectReason,
    driverInfo: deliveryService.getDriverInfo(order.id),
    complaint: order.complaint ? { id: order.complaint.id, reason: order.complaint.reason, description: order.complaint.description, imageUrl: order.complaint.imageUrl || null, status: order.complaint.status, response: order.complaint.response } : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    buyer: { id: order.buyer.id, name: order.buyer.name, username: order.buyer.username },
    supplier: order.supplier ? {
      id: order.supplier.id,
      businessName: order.supplier.businessName,
      warehouseAddress: order.supplier.warehouseAddress || null,
      deliveryRadiusKm: order.supplier.deliveryRadiusKm ? numberValue(order.supplier.deliveryRadiusKm) : 10,
      phone: order.supplier.user?.phone || '0908 123 789',
    } : null,
    items: order.items.map((item) => ({
      id: item.id, productId: item.productId, productName: item.productName,
      packaging: item.packaging, quantity: item.quantity,
      unitPrice: numberValue(item.unitPrice), lineTotal: numberValue(item.lineTotal),
    })),
  };
}

function validateProfileInput(body = {}) {
  body = body && typeof body === "object" ? body : {};
  const businessName = typeof body.businessName === 'string' ? body.businessName.trim().replace(/\s+/g, ' ') : '';
  const warehouseAddress = typeof body.warehouseAddress === 'string' ? body.warehouseAddress.trim().replace(/\s+/g, ' ') : '';
  const deliveryRadiusKm = typeof body.deliveryRadiusKm === 'number' ? body.deliveryRadiusKm : NaN;
  const errors = {};
  const extras = {};
  for (const [field, max] of [['region', 100], ['taxCode', 30], ['legalRepresentative', 100], ['verificationDocumentUrl', 1000]]) {
    if (body[field] === undefined) continue;
    const value = typeof body[field] === 'string' ? body[field].trim().replace(/\s+/g, ' ') : null;
    if (value === null || value.length > max) errors[field] = `Thông tin cần tối đa ${max} ký tự.`;
    else if (['region', 'legalRepresentative'].includes(field) && value && value.length < 2) errors[field] = 'Nhập ít nhất 2 ký tự.';
    else if (field === 'taxCode' && value && !/^[A-Za-z0-9-]{5,30}$/.test(value)) errors[field] = 'Mã đăng ký kinh doanh/mã số thuế gồm 5–30 chữ, số hoặc dấu gạch ngang.';
    else if (field === 'verificationDocumentUrl' && value && !httpsDocument(value)) errors[field] = 'Giấy tờ cần đường dẫn HTTPS hợp lệ, không chứa mật khẩu.';
    else extras[field] = value || null;
  }
  if (body.deliveryFee !== undefined && (typeof body.deliveryFee !== 'number' || !hasTwoDecimals(body.deliveryFee) || body.deliveryFee < 0 || body.deliveryFee > 1000000000)) errors.deliveryFee = 'Phí giao hàng từ 0 đến 1 tỷ đồng, tối đa 2 số thập phân.';
  const bankFields = {
    bankName: typeof body.bankName === 'string' ? body.bankName.trim().replace(/\s+/g, ' ') : '',
    bankAccountNumber: typeof body.bankAccountNumber === 'string' ? body.bankAccountNumber.trim().replace(/\s+/g, '') : '',
    bankAccountHolder: typeof body.bankAccountHolder === 'string' ? body.bankAccountHolder.trim().replace(/\s+/g, ' ') : '',
  };
  const hasBankInformation = Object.values(bankFields).some(Boolean);
  if (hasBankInformation) {
    if (bankFields.bankName.length < 2 || bankFields.bankName.length > 100) errors.bankName = 'Tên ngân hàng cần từ 2 đến 100 ký tự.';
    if (!/^[A-Za-z0-9]{4,34}$/.test(bankFields.bankAccountNumber)) errors.bankAccountNumber = 'Số tài khoản cần 4–34 chữ hoặc số, không có khoảng trắng.';
    if (bankFields.bankAccountHolder.length < 2 || bankFields.bankAccountHolder.length > 100) errors.bankAccountHolder = 'Tên chủ tài khoản cần từ 2 đến 100 ký tự.';
  }
  if (businessName.length < 2 || businessName.length > 150) errors.businessName = 'Tên gian hàng cần từ 2 đến 150 ký tự.';
  if (warehouseAddress.length < 5 || warehouseAddress.length > 255) errors.warehouseAddress = 'Địa chỉ kho cần từ 5 đến 255 ký tự.';
  if (!hasTwoDecimals(deliveryRadiusKm) || deliveryRadiusKm < 0.01 || deliveryRadiusKm > 500) errors.deliveryRadiusKm = 'Bán kính giao hàng từ 0,01 đến 500 km, tối đa 2 chữ số thập phân.';
  let phone = undefined;
  if (body.phone !== undefined) {
    phone = typeof body.phone === 'string' ? body.phone.trim().replace(/\s+/g, '') : '';
    if (phone && !/^0\d{9}$/.test(phone)) {
      errors.phone = 'Số điện thoại cần 10 số bắt đầu bằng 0.';
    }
  }
  return Object.keys(errors).length ? { errors } : {
    data: {
      businessName,
      warehouseAddress,
      deliveryRadiusKm,
      ...extras,
      ...(phone !== undefined ? { phone } : {}),
      ...(body.deliveryFee === undefined ? {} : { deliveryFee: body.deliveryFee }),
      ...(body.bankName === undefined && body.bankAccountNumber === undefined && body.bankAccountHolder === undefined
        ? {}
        : {
          bankName: hasBankInformation ? bankFields.bankName : null,
          bankAccountNumber: hasBankInformation ? bankFields.bankAccountNumber : null,
          bankAccountHolder: hasBankInformation ? bankFields.bankAccountHolder : null,
        }),
    },
  };
}

function validateProductInput(body = {}) {
  body = body && typeof body === "object" ? body : {};
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const packaging = typeof body.packaging === 'string' ? body.packaging.trim() : '';
  const wholesalePrice = typeof body.wholesalePrice === 'number' ? body.wholesalePrice : NaN;
  const stockQty = typeof body.stockQty === 'number' ? body.stockQty : NaN;
  const moq = typeof body.moq === 'number' ? body.moq : NaN;
  const errors = {};
  const extras = {};
  if (body.priceChangeReason !== undefined) {
    const reason = typeof body.priceChangeReason === 'string' ? body.priceChangeReason.trim().replace(/\s+/g, ' ') : null;
    if (reason === null || reason.length > 500) errors.priceChangeReason = 'Lý do đổi giá cần tối đa 500 ký tự.';
    else extras.priceChangeReason = reason || null;
  }
  if (body.category !== undefined) {
    if (!['Đồ uống', 'Thực phẩm', 'Gia vị', 'Hóa phẩm', 'Chăm sóc cá nhân', 'Khác'].includes(body.category)) errors.category = 'Chọn danh mục sản phẩm hợp lệ.';
    else extras.category = body.category;
  }
  if (body.imageUrl !== undefined) {
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : body.imageUrl;
    if (imageUrl === '' || imageUrl === null) extras.imageUrl = null;
    else if (typeof imageUrl === 'string' && imageUrl.startsWith('/uploads/') && imageUrl.length <= 1000 && !imageUrl.includes('..')) {
      extras.imageUrl = imageUrl;
    } else {
      try {
        const url = new URL(imageUrl);
        if (typeof imageUrl !== 'string' || imageUrl.length > 1000 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
        extras.imageUrl = url.href;
      } catch { errors.imageUrl = 'Ảnh cần đường dẫn hoặc file hợp lệ, tối đa 1.000 ký tự.'; }
    }
  }
  if (name.length < 2 || name.length > 150) errors.name = 'Tên sản phẩm cần từ 2 đến 150 ký tự.';
  if (!packaging || packaging.length > 50) {
    errors.packaging = 'Nhập quy cách đóng gói, ví dụ thùng, lốc hoặc bao.';
  } else {
    const numbersInPackaging = packaging.match(/\d+/g);
    if (numbersInPackaging && numbersInPackaging.some(numStr => Number(numStr) > 100)) {
      errors.packaging = 'Số lượng đơn vị trong quy cách đóng gói tối đa là 100 ngoài thực tế.';
    }
  }
  if (!hasTwoDecimals(wholesalePrice) || wholesalePrice < 0.01 || wholesalePrice > 1_000_000_000) errors.wholesalePrice = 'Giá sỉ từ 0,01 đến 1 tỷ đồng, tối đa 2 chữ số thập phân.';
  if (!Number.isInteger(stockQty) || stockQty < 0 || stockQty > 50000) errors.stockQty = 'Tồn kho phải là số nguyên từ 0 đến 50.000.';
  const effectiveMoq = Number.isInteger(moq) ? moq : (body.moq === undefined ? 1 : NaN);
  if (!Number.isInteger(effectiveMoq) || effectiveMoq < 1 || effectiveMoq > 50000) {
    errors.moq = 'MOQ phải là số nguyên từ 1 đến 50.000.';
  } else if (Number.isInteger(stockQty) && stockQty > 0 && effectiveMoq > stockQty) {
    errors.moq = `Số lượng tối thiểu (MOQ: ${effectiveMoq}) không được lớn hơn tồn kho có sẵn (${stockQty}).`;
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') errors.isActive = 'Trạng thái đăng bán không hợp lệ.';
  return Object.keys(errors).length ? { errors } : { data: { name, packaging, wholesalePrice, stockQty, moq: effectiveMoq, ...extras, ...(body.isActive === undefined ? {} : { isActive: body.isActive }) } };
}

function createSupplierService(prisma) {
  async function getProfile(userId) {
    return prisma.supplierProfile.findUnique({
      where: { userId },
      include: { user: { select: { phone: true, name: true, email: true } } },
    });
  }

  async function upsertProfile(userId, input) {
    const { phone, ...profileData } = input;
    return prisma.$transaction(async tx => {
      if (phone) {
        await tx.user.update({ where: { id: userId }, data: { phone } });
      }
      const old = await tx.supplierProfile.findUnique({ where: { userId } });
      const identityFields = ['businessName', 'warehouseAddress', 'region', 'taxCode', 'legalRepresentative', 'verificationDocumentUrl'];
      const changedIdentity = old && identityFields.some(key => profileData[key] !== undefined && profileData[key] !== old[key]);
      const profile = await tx.supplierProfile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: { ...profileData, ...(changedIdentity ? { verificationStatus: 'DRAFT', verificationNote: null, reviewedAt: null, reviewedBy: null, submittedAt: null, verificationVersion: { increment: 1 } } : {}) },
        include: { user: { select: { phone: true, name: true, email: true } } },
      });
      await audit(tx, userId, 'SUPPLIER_PROFILE_UPDATED', 'SUPPLIER', profile.id, { changedFields: Object.keys(profileData), verificationReset: Boolean(changedIdentity), businessName: profile.businessName });
      return profile;
    }, { isolationLevel: 'Serializable' });
  }

  async function submitVerification(userId) {
    return prisma.$transaction(async tx => {
      const profile = await tx.supplierProfile.findUnique({ where: { userId } });
      if (!profile || !verificationComplete(profile)) throw problem(400, 'Lưu đầy đủ khu vực, mã đăng ký kinh doanh, người đại diện và đường dẫn giấy tờ trước khi gửi duyệt.');
      if (!['DRAFT', 'REJECTED'].includes(profile.verificationStatus)) throw problem(409, 'Hồ sơ đã gửi hoặc đã được duyệt.');
      const changed = await tx.supplierProfile.updateMany({ where: { id: profile.id, verificationVersion: profile.verificationVersion }, data: { verificationStatus: 'PENDING', submittedAt: new Date(), verificationNote: null, reviewedAt: null, reviewedBy: null, verificationVersion: { increment: 1 } } });
      if (!changed.count) throw problem(409, 'Thông tin vừa thay đổi. Tải lại hồ sơ.');
      await audit(tx, userId, 'SUPPLIER_VERIFICATION_SUBMITTED', 'SUPPLIER', profile.id);
      return serializeProfile(await tx.supplierProfile.findUnique({ where: { id: profile.id } }));
    }, { isolationLevel: 'Serializable' });
  }

  async function quickVerify(userId) {
    return prisma.$transaction(async tx => {
      const profile = await tx.supplierProfile.findUnique({ where: { userId } });
      if (!profile) throw problem(404, 'Bạn cần thiết lập thông tin gian hàng trước.');
      const changed = await tx.supplierProfile.update({
        where: { id: profile.id },
        data: {
          verificationStatus: 'APPROVED',
          verificationNote: 'Gian hàng đã được kích hoạt mở bán trên Nguồn sỉ.',
          reviewedAt: new Date(),
          verificationVersion: { increment: 1 },
        },
      });
      await audit(tx, userId, 'SUPPLIER_QUICK_VERIFIED', 'SUPPLIER', profile.id, {
        businessName: profile.businessName,
        status: 'APPROVED',
      });
      return serializeProfile(changed);
    }, { isolationLevel: 'Serializable' });
  }

  async function requireProfile(userId) {
    const profile = await getProfile(userId);
    if (!profile) {
      const error = new Error('Bạn cần thiết lập thông tin gian hàng trước.');
      error.code = 'SUPPLIER_PROFILE_REQUIRED';
      throw error;
    }
    return profile;
  }

  async function listProducts(userId) {
    const profile = await requireProfile(userId);
    const products = await prisma.supplierProduct.findMany({
      include: { priceHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
      where: { supplierId: profile.id },
      orderBy: { updatedAt: 'desc' },
    });
    return Promise.all(products.map(serializeProduct));
  }

  async function createProduct(userId, input) {
    const profile = await requireProfile(userId);
    const { priceChangeReason: _priceChangeReason, ...productInput } = input;
    const mod = await moderateContent({
      name: productInput.name,
      category: productInput.category,
      packaging: productInput.packaging,
      wholesalePrice: numberValue(productInput.wholesalePrice),
      moq: productInput.moq,
    });
    const isClean = mod.status === 'AUTO_APPROVED';
    const dataToCreate = {
      supplierId: profile.id,
      ...productInput,
      isActive: isClean ? (productInput.isActive !== undefined ? Boolean(productInput.isActive) : true) : false,
    };
    const product = await prisma.$transaction(async tx => {
      const created = await tx.supplierProduct.create({ data: dataToCreate });
      await audit(tx, userId, isClean ? 'PRODUCT_CREATED' : 'PRODUCT_CREATED_' + mod.status, 'PRODUCT', created.id, {
        name: created.name,
        price: created.wholesalePrice.toString(),
        stock: created.stockQty,
        isActive: created.isActive,
        moderationStatus: mod.status,
        moderationReasons: mod.reasons,
      });
      return created;
    });
    return await serializeProduct(product);
  }

  async function updateProduct(userId, productId, input, expectedUpdatedAt) {
    const profile = await requireProfile(userId);
    const product = await prisma.supplierProduct.findFirst({ where: { id: productId, supplierId: profile.id } });
    if (!product) return null;
    const { priceChangeReason, ...productInput } = input;

    const targetName = productInput.name !== undefined ? productInput.name : product.name;
    const targetCategory = productInput.category !== undefined ? productInput.category : product.category;
    const targetPackaging = productInput.packaging !== undefined ? productInput.packaging : product.packaging;
    const targetPrice = productInput.wholesalePrice !== undefined ? numberValue(productInput.wholesalePrice) : numberValue(product.wholesalePrice);
    const targetMoq = productInput.moq !== undefined ? productInput.moq : product.moq;

    const mod = await moderateContent({
      name: targetName,
      category: targetCategory,
      packaging: targetPackaging,
      wholesalePrice: targetPrice,
      moq: targetMoq,
    });
    const isClean = mod.status === 'AUTO_APPROVED';

    if (!isClean && productInput.isActive === true) {
      const errPrefix = mod.status === 'AUTO_REJECTED'
        ? 'Không thể mở bán do vi phạm nghiêm trọng'
        : 'Không thể mở bán do đang chờ Quản trị viên kiểm duyệt';
      throw problem(400, `${errPrefix} (${mod.reasons.join('; ')}). Vui lòng sửa thông tin hợp lệ.`);
    }

    const finalProductInput = {
      ...productInput,
      ...(!isClean ? { isActive: false } : {}),
    };

    const oldPrice = numberValue(product.wholesalePrice);
    const priceChanged = productInput.wholesalePrice !== undefined && oldPrice !== Number(productInput.wholesalePrice);
    const normalizedPriceReason = priceChanged
      ? (priceChangeReason && priceChangeReason.length >= 3 ? priceChangeReason : 'Chủ vựa cập nhật giá bán')
      : null;
    return prisma.$transaction(async tx => {
      const changed = await tx.supplierProduct.updateMany({ where: { id: productId, supplierId: profile.id, updatedAt: expectedUpdatedAt }, data: finalProductInput });
      if (!changed.count) throw Object.assign(new Error('Sản phẩm vừa thay đổi.'), { code: 'STALE_PRODUCT' });
      if (priceChanged) {
        const newPrice = Number(productInput.wholesalePrice);
        const changePercent = Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2));
        await tx.supplierProductPriceHistory.create({
          data: { productId, oldPrice, newPrice, changePercent, reason: normalizedPriceReason, changedBy: userId },
        });
      }
      await audit(tx, userId, isClean ? 'PRODUCT_UPDATED' : 'PRODUCT_UPDATED_' + mod.status, 'PRODUCT', productId, {
        before: { price: product.wholesalePrice.toString(), stock: product.stockQty, active: product.isActive },
        after: finalProductInput,
        priceChangeReason: normalizedPriceReason,
        moderationStatus: mod.status,
      });
      return await serializeProduct(await tx.supplierProduct.findUnique({
        where: { id: productId },
        include: { priceHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }));
    });
  }

  async function deactivateProduct(userId, productId) {
    const profile = await requireProfile(userId);
    const product = await prisma.supplierProduct.findFirst({ where: { id: productId, supplierId: profile.id } });
    if (!product) return null;
    return prisma.$transaction(async tx => {
      const saved = await tx.supplierProduct.update({ where: { id: productId }, data: { isActive: false } });
      await audit(tx, userId, 'PRODUCT_HIDDEN', 'PRODUCT', productId);
      return await serializeProduct(saved);
    });
  }

  async function listOrders(userId, query = {}) {
    const profile = await requireProfile(userId);
    const { page, status } = require('./orderQuery').orderQuery(query);
    const where = { supplierId: profile.id, ...(status ? { status } : {}) };
    const [orders, total] = await Promise.all([prisma.wholesaleOrder.findMany({
      where,
      include: { buyer: true, items: true, complaint: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, skip: (page - 1) * 20,
    }), prisma.wholesaleOrder.count({ where })]);
    return { orders: orders.slice(0, 20).map(serializeOrder), total, page, hasMore: orders.length > 20 };
  }

  async function updateOrderStatus(userId, orderId, status, rejectReason, driverInfo) {
    if (!ORDER_STATUSES.includes(status)) {
      const error = new Error('Trạng thái đơn hàng không hợp lệ.');
      error.code = 'INVALID_ORDER_STATUS';
      throw error;
    }
    const profile = await requireProfile(userId);
    const order = await prisma.wholesaleOrder.findFirst({
      where: { id: orderId, supplierId: profile.id }, include: { buyer: true, items: true },
    });
    if (!order) return null;
    if (!TRANSITIONS[order.status].includes(status)) {
      const error = new Error(`Không thể chuyển đơn từ ${STATUS_LABELS[order.status]} sang ${STATUS_LABELS[status]}.`);
      error.code = 'INVALID_ORDER_TRANSITION';
      throw error;
    }
    if (driverInfo) {
      deliveryService.saveDriverInfo(order.id, driverInfo);
    }
    const normalizedRejectReason = typeof rejectReason === 'string' ? rejectReason.trim() : '';
    if (status === 'APPROVED' && numberValue(order.depositAmount || 0) > 0 && order.depositStatus !== 'PAID') {
      const error = new Error('Đơn này yêu cầu đặt cọc. Chỉ duyệt sau khi đã xác nhận tiền vào tài khoản.');
      error.code = 'DEPOSIT_REQUIRED';
      throw error;
    }
    if (status === 'REJECTED' && order.depositStatus === 'SUBMITTED') {
      const error = new Error('Cửa hàng đã báo chuyển cọc. Hãy xác nhận đã nhận hoặc chọn chưa nhận được tiền trước khi từ chối đơn.');
      error.code = 'DEPOSIT_UNRESOLVED';
      throw error;
    }
    if (status === 'REJECTED' && (normalizedRejectReason.length < 3 || normalizedRejectReason.length > 255)) {
      const error = new Error('Cần nhập lý do từ chối đơn hàng.');
      error.code = 'REJECT_REASON_REQUIRED';
      throw error;
    }
    await prisma.$transaction(async (transaction) => {
      if (status === 'APPROVED') {
        const currentProfile = await transaction.supplierProfile.findUnique({ where: { id: profile.id } });
        if (currentProfile.verificationStatus !== 'APPROVED') throw problem(403, 'Gian hàng cần được xác minh trước khi nhận đơn mới.');
      }
      // Claim the current status before changing stock so concurrent approvals cannot deduct twice.
      const changed = await transaction.wholesaleOrder.updateMany({
        where: { id: order.id, supplierId: profile.id, status: order.status },
        data: {
          status,
          rejectReason: status === 'REJECTED' ? normalizedRejectReason : null,
          ...(status === 'REJECTED' && order.depositStatus === 'PAID'
            ? { depositStatus: 'REFUNDED' }
            : {}),
          ...(status === 'DELIVERED' ? { deliveredAt: new Date(), commissionAmount: order.commissionRate === null ? null : order.subtotal.mul(order.commissionRate).div(100).toDecimalPlaces(2) } : {}),
        },
      });
      if (!changed.count) throw Object.assign(new Error('Đơn đã được xử lý. Vui lòng tải lại.'), { code: 'INVALID_ORDER_TRANSITION' });
      if (status === 'APPROVED') {
        for (const item of [...order.items].sort((a, b) => a.productId - b.productId)) {
          const result = await transaction.supplierProduct.updateMany({
            where: { id: item.productId, supplierId: profile.id, isActive: true, stockQty: { gte: item.quantity } },
            data: { stockQty: { decrement: item.quantity } },
          });
          if (result.count !== 1) throw Object.assign(new Error('Sản phẩm “' + item.productName + '” không đủ tồn kho hoặc đã ẩn.'), { code: 'INSUFFICIENT_STOCK' });
        }
      }
      if (status === 'REJECTED' && ['APPROVED', 'PREPARING', 'SHIPPING', 'ISSUE_HANDLING'].includes(order.status)) {
        for (const item of order.items) {
          await transaction.supplierProduct.updateMany({
            where: { id: item.productId, supplierId: profile.id },
            data: { stockQty: { increment: item.quantity } },
          });
        }
      }
      await audit(transaction, userId, 'ORDER_STATUS_CHANGED', 'ORDER', order.id, { before: order.status, after: status, rejectReason: status === 'REJECTED' ? normalizedRejectReason : null });
    }, { isolationLevel: 'Serializable' });

    if (status === 'DELIVERED' && numberValue(order.depositAmount || 0) > 0 && order.depositStatus === 'PAID') {
      try {
        walletService.releaseEscrow(order.buyerId, profile.userId, order.id, numberValue(order.depositAmount), order.commissionRate ? numberValue(order.commissionRate) : 0);
      } catch (err) {
        console.error('Lỗi giải phóng cọc ví:', err.message);
      }
    }
    if (status === 'REJECTED' && numberValue(order.depositAmount || 0) > 0 && order.depositStatus === 'PAID') {
      try {
        walletService.refundEscrow(order.buyerId, order.id, numberValue(order.depositAmount), `Hoàn trả cọc do chủ vựa từ chối đơn #${order.id}: ${normalizedRejectReason}`);
      } catch (err) {
        console.error('Lỗi hoàn cọc ví:', err.message);
      }
    }

    return serializeOrder(await prisma.wholesaleOrder.findUnique({
      where: { id: order.id }, include: { buyer: true, items: true, complaint: true },
    }));
  }

  async function updateDriverInfo(userId, orderId, driverInfo) {
    const profile = await requireProfile(userId);
    const order = await prisma.wholesaleOrder.findFirst({
      where: { id: orderId, supplierId: profile.id },
      include: { buyer: true, items: true, complaint: true },
    });
    if (!order) return null;
    deliveryService.saveDriverInfo(order.id, driverInfo);
    return serializeOrder(order);
  }

  async function updateDeposit(userId, orderId, action, body = {}) {
    const profile = await requireProfile(userId);
    const normalizedAction = typeof action === 'string' ? action.trim().toUpperCase() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!['CONFIRM', 'REJECT', 'REFUND'].includes(normalizedAction)) {
      throw problem(400, 'Thao tác tiền cọc không hợp lệ.');
    }
    if (normalizedAction === 'REJECT' && (reason.length < 3 || reason.length > 255)) {
      throw problem(400, 'Nhập lý do chưa nhận được cọc từ 3 đến 255 ký tự.');
    }
    if (normalizedAction === 'REFUND' && (reference.length < 3 || reference.length > 100)) {
      throw problem(400, 'Nhập mã giao dịch hoàn cọc từ 3 đến 100 ký tự.');
    }
    return prisma.$transaction(async tx => {
      const order = await tx.wholesaleOrder.findFirst({
        where: { id: orderId, supplierId: profile.id },
        include: { buyer: true, items: true, complaint: true },
      });
      if (!order) return null;
      let data;
      let expectedDepositStatus;
      let event;
      if (normalizedAction === 'CONFIRM') {
        if (order.status !== 'PENDING' || order.depositStatus !== 'SUBMITTED') {
          throw problem(409, 'Khoản cọc không còn ở trạng thái chờ xác nhận.');
        }
        expectedDepositStatus = 'SUBMITTED';
        event = 'DEPOSIT_CONFIRMED';
        data = {
          depositStatus: 'PAID',
          depositPaidAt: new Date(),
          depositReviewedAt: new Date(),
          depositRejectionReason: null,
        };
      } else if (normalizedAction === 'REJECT') {
        if (order.status !== 'PENDING' || order.depositStatus !== 'SUBMITTED') {
          throw problem(409, 'Khoản cọc không còn ở trạng thái chờ xác nhận.');
        }
        expectedDepositStatus = 'SUBMITTED';
        event = 'DEPOSIT_REJECTED';
        data = {
          depositStatus: 'PENDING',
          depositReviewedAt: new Date(),
          depositRejectionReason: reason,
        };
      } else {
        if (order.status !== 'REJECTED' || order.depositStatus !== 'REFUND_PENDING') {
          throw problem(409, 'Đơn này không có khoản cọc đang chờ hoàn.');
        }
        expectedDepositStatus = 'REFUND_PENDING';
        event = 'DEPOSIT_REFUNDED';
        data = {
          depositStatus: 'REFUNDED',
          depositRefundedAt: new Date(),
          depositRefundReference: reference,
        };
        try {
          walletService.refundEscrow(order.buyerId, order.id, numberValue(order.depositAmount), `Hoàn tiền cọc đơn #${order.id} (Mã GD: ${reference})`);
        } catch (err) {
          console.error('Lỗi hoàn cọc ví:', err.message);
        }
      }
      const changed = await tx.wholesaleOrder.updateMany({
        where: { id: order.id, supplierId: profile.id, depositStatus: expectedDepositStatus },
        data,
      });
      if (!changed.count) throw problem(409, 'Khoản cọc vừa được xử lý. Tải lại đơn hàng.');
      await audit(tx, userId, event, 'ORDER', order.id, {
        amount: order.depositAmount.toString(),
        ...(reason ? { reason } : {}),
        ...(reference ? { reference } : {}),
      });
      return serializeOrder(await tx.wholesaleOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { buyer: true, items: true, complaint: true },
      }));
    }, { isolationLevel: 'Serializable' });
  }

  async function dashboard(userId) {
    const profile = await getProfile(userId);
    if (!profile) return { profile: null, products: [], orders: [], summary: { productCount: 0, lowStockCount: 0, pendingOrders: 0, pendingDepositConfirmations: 0, deliveredRevenue: 0 } };
    const [products, orders, pendingOrders, pendingDepositConfirmations, delivered] = await Promise.all([
      prisma.supplierProduct.findMany({
        where: { supplierId: profile.id },
        include: { priceHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.wholesaleOrder.findMany({ where: { supplierId: profile.id }, include: { buyer: true, items: true, complaint: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.wholesaleOrder.count({ where: { supplierId: profile.id, status: 'PENDING' } }),
      prisma.wholesaleOrder.count({ where: { supplierId: profile.id, status: 'PENDING', depositStatus: 'SUBMITTED' } }),
      prisma.wholesaleOrder.aggregate({ where: { supplierId: profile.id, status: 'DELIVERED' }, _sum: { total: true } }),
    ]);
    return {
      profile: serializeProfile(profile),
      products: await Promise.all(products.map(serializeProduct)), orders: orders.map(serializeOrder),
      summary: {
        productCount: products.filter((product) => product.isActive).length,
        lowStockCount: products.filter((product) => product.isActive && product.stockQty <= product.moq).length,
        pendingOrders,
        pendingDepositConfirmations,
        deliveredRevenue: numberValue(delivered._sum.total || 0),
      },
    };
  }

  return {
    getProfile, upsertProfile, submitVerification, quickVerify, listProducts, createProduct, updateProduct, deactivateProduct,
    listOrders, updateOrderStatus, updateDriverInfo, updateDeposit, dashboard,
  };
}

function serializeProfile(profile) {
  const {
    id, businessName, warehouseAddress, region, taxCode, legalRepresentative,
    verificationDocumentUrl, verificationStatus, verificationNote, verificationVersion,
    submittedAt, reviewedAt, bankName, bankAccountNumber, bankAccountHolder,
  } = profile;
  return {
    id, businessName, warehouseAddress, region, taxCode, legalRepresentative,
    verificationDocumentUrl, verificationStatus, verificationNote, verificationVersion,
    submittedAt, reviewedAt, bankName, bankAccountNumber, bankAccountHolder,
    phone: profile.user?.phone || profile.phone || null,
    deliveryRadiusKm: numberValue(profile.deliveryRadiusKm),
    deliveryFee: numberValue(profile.deliveryFee),
  };
}
module.exports = { createSupplierService, validateProfileInput, validateProductInput, ORDER_STATUSES, STATUS_LABELS, serializeOrder, serializeProfile };

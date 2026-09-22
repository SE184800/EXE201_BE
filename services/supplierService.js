const { audit, problem, httpsDocument, verificationComplete } = require('./platformPolicy');
const ORDER_STATUSES = Object.freeze([
  'PENDING', 'APPROVED', 'REJECTED', 'PREPARING', 'SHIPPING', 'DELIVERED',
]);

const STATUS_LABELS = Object.freeze({
  PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối',
  PREPARING: 'Đang chuẩn bị', SHIPPING: 'Đang vận chuyển', DELIVERED: 'Đã giao',
});

const TRANSITIONS = Object.freeze({
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PREPARING'],
  PREPARING: ['SHIPPING'],
  SHIPPING: ['DELIVERED'],
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

function serializeProduct(product) {
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
    note: order.note,
    rejectReason: order.rejectReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    buyer: { id: order.buyer.id, name: order.buyer.name, username: order.buyer.username },
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
  if (businessName.length < 2 || businessName.length > 150) errors.businessName = 'Tên gian hàng cần từ 2 đến 150 ký tự.';
  if (warehouseAddress.length < 5 || warehouseAddress.length > 255) errors.warehouseAddress = 'Địa chỉ kho cần từ 5 đến 255 ký tự.';
  if (!hasTwoDecimals(deliveryRadiusKm) || deliveryRadiusKm < 0.01 || deliveryRadiusKm > 500) errors.deliveryRadiusKm = 'Bán kính giao hàng từ 0,01 đến 500 km, tối đa 2 chữ số thập phân.';
  return Object.keys(errors).length ? { errors } : { data: { businessName, warehouseAddress, deliveryRadiusKm, ...extras, ...(body.deliveryFee === undefined ? {} : { deliveryFee: body.deliveryFee }) } };
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
  if (body.category !== undefined) {
    if (!['Đồ uống', 'Thực phẩm', 'Gia vị', 'Hóa phẩm', 'Chăm sóc cá nhân', 'Khác'].includes(body.category)) errors.category = 'Chọn danh mục sản phẩm hợp lệ.';
    else extras.category = body.category;
  }
  if (body.imageUrl !== undefined) {
    const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : body.imageUrl;
    if (imageUrl === '' || imageUrl === null) extras.imageUrl = null;
    else {
      try {
        const url = new URL(imageUrl);
        if (typeof imageUrl !== 'string' || imageUrl.length > 1000 || url.protocol !== 'https:' || url.username || url.password) throw new Error();
        extras.imageUrl = url.href;
      } catch { errors.imageUrl = 'Ảnh cần đường dẫn HTTPS hợp lệ, tối đa 1.000 ký tự.'; }
    }
  }
  if (name.length < 2 || name.length > 150) errors.name = 'Tên sản phẩm cần từ 2 đến 150 ký tự.';
  if (!packaging || packaging.length > 50) errors.packaging = 'Nhập quy cách đóng gói, ví dụ thùng, lốc hoặc bao.';
  if (!hasTwoDecimals(wholesalePrice) || wholesalePrice < 0.01 || wholesalePrice > 1_000_000_000) errors.wholesalePrice = 'Giá sỉ từ 0,01 đến 1 tỷ đồng, tối đa 2 chữ số thập phân.';
  if (!Number.isInteger(stockQty) || stockQty < 0 || stockQty > 2147483647) errors.stockQty = 'Tồn kho phải là số nguyên từ 0.';
  if (!Number.isInteger(moq) || moq < 1 || moq > 2147483647) errors.moq = 'MOQ phải là số nguyên từ 1.';
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') errors.isActive = 'Trạng thái đăng bán không hợp lệ.';
  return Object.keys(errors).length ? { errors } : { data: { name, packaging, wholesalePrice, stockQty, moq, ...extras, ...(body.isActive === undefined ? {} : { isActive: body.isActive }) } };
}

function createSupplierService(prisma) {
  async function getProfile(userId) {
    return prisma.supplierProfile.findUnique({ where: { userId } });
  }

  async function upsertProfile(userId, input) {
    return prisma.$transaction(async tx => {
      const old = await tx.supplierProfile.findUnique({ where: { userId } });
      const identityFields = ['businessName', 'warehouseAddress', 'region', 'taxCode', 'legalRepresentative', 'verificationDocumentUrl'];
      const changedIdentity = old && identityFields.some(key => input[key] !== undefined && input[key] !== old[key]);
      const profile = await tx.supplierProfile.upsert({ where: { userId }, create: { userId, ...input }, update: { ...input, ...(changedIdentity ? { verificationStatus: 'DRAFT', verificationNote: null, reviewedAt: null, reviewedBy: null, submittedAt: null, verificationVersion: { increment: 1 } } : {}) } });
      await audit(tx, userId, 'SUPPLIER_PROFILE_UPDATED', 'SUPPLIER', profile.id, { changedFields: Object.keys(input), verificationReset: Boolean(changedIdentity), businessName: profile.businessName });
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
    const products = await prisma.supplierProduct.findMany({ where: { supplierId: profile.id }, orderBy: { updatedAt: 'desc' } });
    return products.map(serializeProduct);
  }

  async function createProduct(userId, input) {
    const profile = await requireProfile(userId);
    const product = await prisma.$transaction(async tx => {
      const created = await tx.supplierProduct.create({ data: { supplierId: profile.id, ...input } });
      await audit(tx, userId, 'PRODUCT_CREATED', 'PRODUCT', created.id, { name: created.name, price: created.wholesalePrice.toString(), stock: created.stockQty });
      return created;
    });
    return serializeProduct(product);
  }

  async function updateProduct(userId, productId, input, expectedUpdatedAt) {
    const profile = await requireProfile(userId);
    const product = await prisma.supplierProduct.findFirst({ where: { id: productId, supplierId: profile.id } });
    if (!product) return null;
    return prisma.$transaction(async tx => {
      const changed = await tx.supplierProduct.updateMany({ where: { id: productId, supplierId: profile.id, updatedAt: expectedUpdatedAt }, data: input });
      if (!changed.count) throw Object.assign(new Error('Sản phẩm vừa thay đổi.'), { code: 'STALE_PRODUCT' });
      await audit(tx, userId, 'PRODUCT_UPDATED', 'PRODUCT', productId, { before: { price: product.wholesalePrice.toString(), stock: product.stockQty, active: product.isActive }, after: input });
      return serializeProduct(await tx.supplierProduct.findUnique({ where: { id: productId } }));
    });
  }

  async function deactivateProduct(userId, productId) {
    const profile = await requireProfile(userId);
    const product = await prisma.supplierProduct.findFirst({ where: { id: productId, supplierId: profile.id } });
    if (!product) return null;
    return prisma.$transaction(async tx => {
      const saved = await tx.supplierProduct.update({ where: { id: productId }, data: { isActive: false } });
      await audit(tx, userId, 'PRODUCT_HIDDEN', 'PRODUCT', productId);
      return serializeProduct(saved);
    });
  }

  async function listOrders(userId, query = {}) {
    const profile = await requireProfile(userId);
    const { page, status } = require('./orderQuery').orderQuery(query);
    const where = { supplierId: profile.id, ...(status ? { status } : {}) };
    const [orders, total] = await Promise.all([prisma.wholesaleOrder.findMany({
      where,
      include: { buyer: true, items: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, skip: (page - 1) * 20,
    }), prisma.wholesaleOrder.count({ where })]);
    return { orders: orders.slice(0, 20).map(serializeOrder), total, page, hasMore: orders.length > 20 };
  }

  async function updateOrderStatus(userId, orderId, status, rejectReason) {
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
    const normalizedRejectReason = typeof rejectReason === 'string' ? rejectReason.trim() : '';
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
        data: { status, rejectReason: status === 'REJECTED' ? normalizedRejectReason : null, ...(status === 'DELIVERED' ? { deliveredAt: new Date(), commissionAmount: order.commissionRate === null ? null : order.subtotal.mul(order.commissionRate).div(100).toDecimalPlaces(2) } : {}) },
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
      await audit(transaction, userId, 'ORDER_STATUS_CHANGED', 'ORDER', order.id, { before: order.status, after: status, rejectReason: status === 'REJECTED' ? normalizedRejectReason : null });
    }, { isolationLevel: 'Serializable' });
    return serializeOrder(await prisma.wholesaleOrder.findUnique({
      where: { id: order.id }, include: { buyer: true, items: true },
    }));
  }

  async function dashboard(userId) {
    const profile = await getProfile(userId);
    if (!profile) return { profile: null, products: [], orders: [], summary: { productCount: 0, lowStockCount: 0, pendingOrders: 0, deliveredRevenue: 0 } };
    const [products, orders, pendingOrders, delivered] = await Promise.all([
      prisma.supplierProduct.findMany({ where: { supplierId: profile.id }, orderBy: { updatedAt: 'desc' } }),
      prisma.wholesaleOrder.findMany({ where: { supplierId: profile.id }, include: { buyer: true, items: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.wholesaleOrder.count({ where: { supplierId: profile.id, status: 'PENDING' } }),
      prisma.wholesaleOrder.aggregate({ where: { supplierId: profile.id, status: 'DELIVERED' }, _sum: { total: true } }),
    ]);
    return {
      profile: serializeProfile(profile),
      products: products.map(serializeProduct), orders: orders.map(serializeOrder),
      summary: {
        productCount: products.filter((product) => product.isActive).length,
        lowStockCount: products.filter((product) => product.isActive && product.stockQty <= product.moq).length,
        pendingOrders,
        deliveredRevenue: numberValue(delivered._sum.total || 0),
      },
    };
  }

  return {
    getProfile, upsertProfile, submitVerification, listProducts, createProduct, updateProduct, deactivateProduct,
    listOrders, updateOrderStatus, dashboard,
  };
}

function serializeProfile(profile) {
  const { id, businessName, warehouseAddress, region, taxCode, legalRepresentative, verificationDocumentUrl, verificationStatus, verificationNote, verificationVersion, submittedAt, reviewedAt } = profile;
  return { id, businessName, warehouseAddress, region, taxCode, legalRepresentative, verificationDocumentUrl, verificationStatus, verificationNote, verificationVersion, submittedAt, reviewedAt, deliveryRadiusKm: numberValue(profile.deliveryRadiusKm), deliveryFee: numberValue(profile.deliveryFee) };
}
module.exports = { createSupplierService, validateProfileInput, validateProductInput, ORDER_STATUSES, STATUS_LABELS, serializeOrder, serializeProfile };

const { validateProfileInput, validateProductInput } = require('../services/supplierService');

function idFrom(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function createSupplierController(service) {
  return {
    async dashboard(req, res, next) {
      try { return res.json({ success: true, ...(await service.dashboard(req.auth.user.id)) }); } catch (error) { return next(error); }
    },
    async getProfile(req, res, next) {
      try {
        const profile = await service.getProfile(req.auth.user.id);
        return res.json({ success: true, profile: profile ? { id: profile.id, businessName: profile.businessName, warehouseAddress: profile.warehouseAddress, deliveryRadiusKm: Number(profile.deliveryRadiusKm) } : null });
      } catch (error) { return next(error); }
    },
    async saveProfile(req, res, next) {
      const validation = validateProfileInput(req.body);
      if (!validation.data) return res.status(400).json({ success: false, message: 'Thông tin gian hàng chưa hợp lệ.', errors: validation.errors });
      try {
        const profile = await service.upsertProfile(req.auth.user.id, validation.data);
        return res.json({ success: true, profile: { id: profile.id, businessName: profile.businessName, warehouseAddress: profile.warehouseAddress, deliveryRadiusKm: Number(profile.deliveryRadiusKm) } });
      } catch (error) { return next(error); }
    },
    async listProducts(req, res, next) {
      try { return res.json({ success: true, products: await service.listProducts(req.auth.user.id) }); } catch (error) { return next(error); }
    },
    async createProduct(req, res, next) {
      const validation = validateProductInput(req.body);
      if (!validation.data) return res.status(400).json({ success: false, message: 'Thông tin sản phẩm chưa hợp lệ.', errors: validation.errors });
      try { return res.status(201).json({ success: true, product: await service.createProduct(req.auth.user.id, validation.data) }); } catch (error) { return next(error); }
    },
    async updateProduct(req, res, next) {
      const productId = idFrom(req.params.productId);
      const validation = validateProductInput(req.body);
      if (!productId) return res.status(400).json({ success: false, message: 'Mã sản phẩm không hợp lệ.' });
      if (!validation.data) return res.status(400).json({ success: false, message: 'Thông tin sản phẩm chưa hợp lệ.', errors: validation.errors });
      try {
        const expectedUpdatedAt = req.body?.expectedUpdatedAt;
        if (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt))) return res.status(400).json({ message: 'Tải lại sản phẩm trước khi sửa.' });
        const product = await service.updateProduct(req.auth.user.id, productId, validation.data, new Date(expectedUpdatedAt));
        return product ? res.json({ success: true, product }) : res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm.' });
      } catch (error) { return next(error); }
    },
    async deactivateProduct(req, res, next) {
      const productId = idFrom(req.params.productId);
      if (!productId) return res.status(400).json({ success: false, message: 'Mã sản phẩm không hợp lệ.' });
      try {
        const product = await service.deactivateProduct(req.auth.user.id, productId);
        return product ? res.json({ success: true, product }) : res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm.' });
      } catch (error) { return next(error); }
    },
    async listOrders(req, res, next) {
      try { return res.json({ success: true, orders: await service.listOrders(req.auth.user.id) }); } catch (error) { return next(error); }
    },
    async updateOrderStatus(req, res, next) {
      const orderId = idFrom(req.params.orderId);
      const status = req.body?.status;
      if (!orderId) return res.status(400).json({ success: false, message: 'Mã đơn hàng không hợp lệ.' });
      try {
        const order = await service.updateOrderStatus(req.auth.user.id, orderId, status, req.body?.rejectReason);
        return order ? res.json({ success: true, order }) : res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });
      } catch (error) {
        if (['INVALID_ORDER_STATUS', 'INVALID_ORDER_TRANSITION', 'REJECT_REASON_REQUIRED', 'INSUFFICIENT_STOCK'].includes(error.code)) return res.status(400).json({ success: false, message: error.message });
        return next(error);
      }
    },
  };
}

module.exports = { createSupplierController };

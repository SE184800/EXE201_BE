const express = require('express');
const {
  getOrCreateUserContract,
  signContract,
  getContractByUserId,
  getCanonicalContractText,
  formatRawKey,
} = require('../services/contractService');
const { getStoreProfile } = require('../services/storeService');

function createContractRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth);

  // Helper to fetch store/supplier details for the current user
  async function resolveProfileInfo(req) {
    const user = req.auth.user;
    const roleCode = user.role?.code || user.role || 'STORE_OWNER';

    if (roleCode === 'STORE_OWNER') {
      const store = getStoreProfile(user.id, user.phone);
      return store || {};
    }

    if (roleCode === 'SUPPLIER') {
      try {
        const supplier = await prisma.user.findUnique({
          where: { id: user.id },
          include: { supplierProfile: true },
        });
        if (supplier?.supplierProfile) {
          return {
            businessName: supplier.supplierProfile.businessName,
            warehouseAddress: supplier.supplierProfile.warehouseAddress,
            taxCode: supplier.supplierProfile.taxCode || '',
            storePhone: user.phone || '',
          };
        }
      } catch {
        // Fallback if DB is not reachable
      }
      return {
        businessName: 'Vựa Sỉ Đối Tác',
        warehouseAddress: 'Tổng kho phân phối sỉ SupplyMind',
        storePhone: user.phone || '',
      };
    }

    return {};
  }

  // GET /api/contracts/my-contract
  router.get('/my-contract', async (req, res, next) => {
    try {
      const profileInfo = await resolveProfileInfo(req);
      const contract = getOrCreateUserContract(req.auth.user, profileInfo);
      const canonicalText = getCanonicalContractText(contract);
      const rawPrivateKey = !contract.isSigned
        ? (contract.rawPrivateKey || (contract.privateKey ? formatRawKey(contract.privateKey) : undefined))
        : undefined;

      return res.json({
        success: true,
        contract: {
          userId: contract.userId,
          username: contract.username,
          role: contract.role,
          contractNumber: contract.contractNumber,
          isSigned: contract.isSigned,
          signedAt: contract.signedAt,
          contractHash: contract.contractHash,
          signerInfo: contract.signerInfo,
          stamp: contract.stamp,
          rawPrivateKey,
        },
        canonicalText,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/contracts/sign
  router.post('/sign', async (req, res) => {
    const { privateKey, agreedTerms } = req.body || {};

    if (!agreedTerms) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng tích chọn đồng ý với tất cả điều khoản hợp đồng trước khi xác nhận.',
      });
    }

    if (!privateKey || typeof privateKey !== 'string' || !privateKey.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng dán khóa bí mật cá nhân (Private Key) để thực hiện ký số.',
      });
    }

    try {
      const signedContract = signContract(
        req.auth.user.id,
        privateKey.trim(),
        Boolean(agreedTerms),
        { ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1' }
      );

      return res.json({
        success: true,
        message: 'Ký kết hợp đồng điện tử thành công! Chào mừng bạn gia nhập nền tảng SupplyMind.',
        contract: {
          userId: signedContract.userId,
          contractNumber: signedContract.contractNumber,
          isSigned: signedContract.isSigned,
          signedAt: signedContract.signedAt,
          contractHash: signedContract.contractHash,
          stamp: signedContract.stamp,
        },
      });
    } catch (error) {
      return res.status(error.status || 400).json({
        success: false,
        message: error.message || 'Lỗi ký hợp đồng điện tử.',
        detail: error.detail,
      });
    }
  });

  // GET /api/contracts/status
  router.get('/status', (req, res) => {
    const contract = getContractByUserId(req.auth.user.id);
    return res.json({
      success: true,
      isSigned: Boolean(contract?.isSigned),
      contractNumber: contract?.contractNumber || null,
      signedAt: contract?.signedAt || null,
    });
  });

  return router;
}

module.exports = { createContractRoutes };

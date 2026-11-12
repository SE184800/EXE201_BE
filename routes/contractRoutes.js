const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getOrCreateUserContract,
  signContract,
  getContractByUserId,
  getCanonicalContractText,
  formatRawKey,
} = require('../services/contractService');
const { getStoreProfile, setStoreContractSigned } = require('../services/storeService');
const { maskPrivateKey } = require('../services/contractMailService');

function createContractRoutes(prisma, requireAuth, config = {}) {
  const router = express.Router();

  // GET /api/contracts/reveal-key?token=... (public signed-link endpoint from email)
  router.get('/reveal-key', async (req, res, next) => {
    try {
      const token = String(req.query.token || '').trim();
      if (!token) {
        return res.status(400).json({ success: false, message: 'Thiếu mã xác thực xem khóa bí mật.' });
      }
      const jwtSecret = config?.jwtSecret || process.env.JWT_SECRET;
      if (!jwtSecret) {
        return res.status(500).json({ success: false, message: 'Hệ thống chưa cấu hình khóa xác thực.' });
      }
      let payload;
      try {
        payload = jwt.verify(token, jwtSecret, {
          algorithms: ['HS256'],
          issuer: 'sg-restock-api',
          audience: 'sg-restock-contract-key',
        });
      } catch {
        return res.status(401).json({ success: false, message: 'Liên kết xem khóa đã hết hạn hoặc không hợp lệ.' });
      }
      if (!payload || payload.purpose !== 'contract-key-reveal' || !payload.sub) {
        return res.status(401).json({ success: false, message: 'Liên kết xem khóa không hợp lệ.' });
      }

      const contract = getContractByUserId(String(payload.sub));
      if (!contract || (payload.contractNumber && contract.contractNumber !== payload.contractNumber)) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy hợp đồng hoặc khóa bí mật tương ứng.' });
      }

      const rawPrivateKey = contract.rawPrivateKey || (contract.privateKey ? formatRawKey(contract.privateKey) : '');
      if (!rawPrivateKey) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy khóa bí mật của hợp đồng này.' });
      }

      return res.json({
        success: true,
        contractNumber: contract.contractNumber,
        maskedPrivateKey: maskPrivateKey(rawPrivateKey),
        rawPrivateKey,
        isSigned: Boolean(contract.isSigned),
      });
    } catch (err) {
      return next(err);
    }
  });

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
        },
        canonicalText,
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/contracts/sign
  router.post('/sign', async (req, res) => {
    const { method = 'PRIVATE_KEY', privateKey, agreedTerms } = req.body || {};
    if (method !== 'PRIVATE_KEY') return res.status(400).json({ success: false, message: 'Phương thức ký chưa được hỗ trợ.' });

    if (agreedTerms !== true) {
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
        {
          method,
          privateKey: privateKey ? privateKey.trim() : undefined,
        },
        Boolean(agreedTerms),
        { ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1' }
      );

      // Transition verification status to PENDING upon contract signing
      const roleCode = req.auth.user.role?.code || req.auth.user.role || 'STORE_OWNER';
      if (roleCode === 'STORE_OWNER') {
        setStoreContractSigned(req.auth.user.id);
      } else if (roleCode === 'SUPPLIER') {
        try {
          await prisma.supplierProfile.updateMany({
            where: {
              userId: req.auth.user.id,
              verificationStatus: { in: ['DRAFT', ''] },
            },
            data: {
              verificationStatus: 'PENDING',
              submittedAt: new Date(),
              verificationVersion: { increment: 1 },
            },
          });
        } catch (err) {
          console.error('[CONTRACT SIGN] Supplier verification update error:', err.message);
        }
      }

      return res.json({
        success: true,
        message: 'Đã ký bằng khóa cá nhân của tài khoản.',
        contract: {
          userId: signedContract.userId,
          contractNumber: signedContract.contractNumber,
          isSigned: signedContract.isSigned,
          signedAt: signedContract.signedAt,
          contractHash: signedContract.contractHash,
          signingMethod: signedContract.signingMethod,
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

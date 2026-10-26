const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '../data');
const walletsFile = path.join(dataDir, 'wallets.json');

const DEFAULT_MOCK_BALANCE = 10000000; // 10,000,000 VND initial mock balance for testing

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(walletsFile)) {
    fs.writeFileSync(walletsFile, JSON.stringify({ wallets: {}, transactions: [] }, null, 2), 'utf8');
  }
}

function loadData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(walletsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.wallets) parsed.wallets = {};
    if (!Array.isArray(parsed.transactions)) parsed.transactions = [];
    return parsed;
  } catch (error) {
    return { wallets: {}, transactions: [] };
  }
}

function saveData(data) {
  ensureDataFile();
  const tempFile = `${walletsFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, walletsFile);
}

function getOrCreateWallet(data, userId) {
  const key = String(userId);
  if (!data.wallets[key]) {
    data.wallets[key] = {
      userId: Number(userId),
      availableBalance: DEFAULT_MOCK_BALANCE,
      lockedBalance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(userId),
      type: 'INITIAL_MOCK',
      amount: DEFAULT_MOCK_BALANCE,
      balanceBefore: 0,
      balanceAfter: DEFAULT_MOCK_BALANCE,
      description: 'Số dư thử nghiệm khởi tạo hệ thống SupplyMind AI',
      createdAt: new Date().toISOString(),
    });
  }
  return data.wallets[key];
}

const walletService = {
  getWallet(userId) {
    const data = loadData();
    const wallet = getOrCreateWallet(data, userId);
    saveData(data);
    return {
      userId: wallet.userId,
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      totalBalance: wallet.availableBalance + wallet.lockedBalance,
      updatedAt: wallet.updatedAt,
    };
  },

  getTransactions(userId, { limit = 30, page = 1 } = {}) {
    const data = loadData();
    getOrCreateWallet(data, userId);
    saveData(data);
    const userTxs = data.transactions.filter(tx => tx.userId === Number(userId));
    const total = userTxs.length;
    const startIndex = (page - 1) * limit;
    const items = userTxs.slice(startIndex, startIndex + limit);
    return { transactions: items, total, page, limit };
  },

  addMockFunds(userId, amount = 5000000) {
    const data = loadData();
    const wallet = getOrCreateWallet(data, userId);
    const numAmount = Math.max(0, Number(amount) || 0);
    const balanceBefore = wallet.availableBalance;
    wallet.availableBalance += numAmount;
    wallet.updatedAt = new Date().toISOString();

    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(userId),
      type: 'MOCK_ADD',
      amount: numAmount,
      balanceBefore,
      balanceAfter: wallet.availableBalance,
      description: `Nạp thêm ${numAmount.toLocaleString('vi-VN')} ₫ số dư thử nghiệm`,
      createdAt: new Date().toISOString(),
    });

    saveData(data);
    return this.getWallet(userId);
  },

  resetMockBalance(userId, amount = DEFAULT_MOCK_BALANCE) {
    const data = loadData();
    const wallet = getOrCreateWallet(data, userId);
    const numAmount = Math.max(0, Number(amount) || 0);
    const balanceBefore = wallet.availableBalance;
    wallet.availableBalance = numAmount;
    wallet.lockedBalance = 0;
    wallet.updatedAt = new Date().toISOString();

    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(userId),
      type: 'MOCK_RESET',
      amount: numAmount - balanceBefore,
      balanceBefore,
      balanceAfter: wallet.availableBalance,
      description: `Đặt lại số dư thử nghiệm: ${numAmount.toLocaleString('vi-VN')} ₫`,
      createdAt: new Date().toISOString(),
    });

    saveData(data);
    return this.getWallet(userId);
  },

  lockEscrow(buyerId, orderId, amount, note = '') {
    const data = loadData();
    const wallet = getOrCreateWallet(data, buyerId);
    const numAmount = Number(amount) || 0;
    if (numAmount <= 0) return wallet;

    if (wallet.availableBalance < numAmount) {
      const err = new Error(`Số dư ví khả dụng không đủ (${wallet.availableBalance.toLocaleString('vi-VN')} ₫). Cần ${numAmount.toLocaleString('vi-VN')} ₫ để đặt cọc.`);
      err.status = 400;
      err.code = 'INSUFFICIENT_WALLET_BALANCE';
      throw err;
    }

    const balanceBefore = wallet.availableBalance;
    wallet.availableBalance -= numAmount;
    wallet.lockedBalance += numAmount;
    wallet.updatedAt = new Date().toISOString();

    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(buyerId),
      orderId: Number(orderId),
      type: 'ESCROW_LOCK',
      amount: -numAmount,
      balanceBefore,
      balanceAfter: wallet.availableBalance,
      description: note || `Tạm khóa tiền cọc đơn hàng #${orderId}`,
      createdAt: new Date().toISOString(),
    });

    saveData(data);
    return wallet;
  },

  releaseEscrow(buyerId, supplierUserId, orderId, depositAmount, commissionRate = 0) {
    const data = loadData();
    const buyerWallet = getOrCreateWallet(data, buyerId);
    const numAmount = Number(depositAmount) || 0;
    if (numAmount <= 0) return;

    // Deduct from buyer's locked balance
    buyerWallet.lockedBalance = Math.max(0, buyerWallet.lockedBalance - numAmount);
    buyerWallet.updatedAt = new Date().toISOString();

    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(buyerId),
      orderId: Number(orderId),
      type: 'ESCROW_RELEASE',
      amount: 0,
      balanceBefore: buyerWallet.availableBalance,
      balanceAfter: buyerWallet.availableBalance,
      description: `Giải phóng cọc ${numAmount.toLocaleString('vi-VN')} ₫ cho đơn hàng #${orderId} (Đã giao hàng)`,
      createdAt: new Date().toISOString(),
    });

    // Credit to supplier if supplierUserId provided
    if (supplierUserId) {
      const supplierWallet = getOrCreateWallet(data, supplierUserId);
      const rate = Number(commissionRate) || 0;
      const commission = Math.round(numAmount * rate / 100);
      const netToSupplier = Math.max(0, numAmount - commission);
      const suppBefore = supplierWallet.availableBalance;

      supplierWallet.availableBalance += netToSupplier;
      supplierWallet.updatedAt = new Date().toISOString();

      data.transactions.unshift({
        id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId: Number(supplierUserId),
        orderId: Number(orderId),
        type: 'ESCROW_RECEIVED',
        amount: netToSupplier,
        balanceBefore: suppBefore,
        balanceAfter: supplierWallet.availableBalance,
        description: `Nhận tiền cọc đơn hàng #${orderId}${commission > 0 ? ` (Đã trừ phí sàn: ${commission.toLocaleString('vi-VN')} ₫)` : ''}`,
        createdAt: new Date().toISOString(),
      });
    }

    saveData(data);
  },

  refundEscrow(buyerId, orderId, depositAmount, reason = '') {
    const data = loadData();
    const buyerWallet = getOrCreateWallet(data, buyerId);
    const numAmount = Number(depositAmount) || 0;
    if (numAmount <= 0) return;

    // Release from locked and refund to available
    buyerWallet.lockedBalance = Math.max(0, buyerWallet.lockedBalance - numAmount);
    const balanceBefore = buyerWallet.availableBalance;
    buyerWallet.availableBalance += numAmount;
    buyerWallet.updatedAt = new Date().toISOString();

    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(buyerId),
      orderId: Number(orderId),
      type: 'ESCROW_REFUND',
      amount: numAmount,
      balanceBefore,
      balanceAfter: buyerWallet.availableBalance,
      description: reason || `Hoàn trả cọc ${numAmount.toLocaleString('vi-VN')} ₫ đơn hàng #${orderId}`,
      createdAt: new Date().toISOString(),
    });

    saveData(data);
  },

  confiscateEscrow(buyerId, supplierUserId, orderId, depositAmount, reason = '') {
    const data = loadData();
    const buyerWallet = getOrCreateWallet(data, buyerId);
    const numAmount = Number(depositAmount) || 0;
    if (numAmount <= 0) return;

    // Deduct from locked balance of buyer (penalized)
    buyerWallet.lockedBalance = Math.max(0, buyerWallet.lockedBalance - numAmount);
    buyerWallet.updatedAt = new Date().toISOString();

    data.transactions.unshift({
      id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId: Number(buyerId),
      orderId: Number(orderId),
      type: 'PENALTY_CONFISCATION',
      amount: -numAmount,
      balanceBefore: buyerWallet.availableBalance,
      balanceAfter: buyerWallet.availableBalance,
      description: reason || `Tịch thu tiền cọc đơn hàng #${orderId} do vi phạm/bùng hàng`,
      createdAt: new Date().toISOString(),
    });

    // Credit compensation to supplier
    if (supplierUserId) {
      const supplierWallet = getOrCreateWallet(data, supplierUserId);
      const suppBefore = supplierWallet.availableBalance;
      supplierWallet.availableBalance += numAmount;
      supplierWallet.updatedAt = new Date().toISOString();

      data.transactions.unshift({
        id: `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId: Number(supplierUserId),
        orderId: Number(orderId),
        type: 'COMPENSATION_RECEIVED',
        amount: numAmount,
        balanceBefore: suppBefore,
        balanceAfter: supplierWallet.availableBalance,
        description: `Bồi thường tiền cọc đơn hàng #${orderId} do bên mua vi phạm`,
        createdAt: new Date().toISOString(),
      });
    }

    saveData(data);
  },
};

module.exports = { walletService, DEFAULT_MOCK_BALANCE };

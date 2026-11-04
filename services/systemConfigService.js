const fs = require('node:fs');
const documents = require('./documentStorage');
const path = require('node:path');

const dataDir = path.join(__dirname, '../data');
const configFile = path.join(dataDir, 'systemConfig.json');

const DEFAULT_CONFIG = {
  aiModeration: {
    autoModerationEnabled: true,
    strictness: 'STANDARD', // 'STANDARD' | 'STRICT' | 'LENIENT'
    criticalForbiddenKeywords: [
      'chất cấm',
      'ma túy',
      'bóng cười',
      'vũ khí',
      'súng',
      'đạn',
      'đao kiếm',
      'cờ bạc',
      'lừa đảo',
      'hàng giả',
      'hàng nhái',
      'kích dục',
      'độc hại',
      'rượu lậu',
      'tiền giả',
      'pháo nổ',
      'pháo hoa nổ',
      'ngà voi',
      'sừng tê giác',
      'cỏ mỹ',
      'tê tê',
    ],
    restrictedKeywords: [
      'thuốc lá',
      'xì gà',
      'rượu mạnh',
    ],
    minSuspiciousPrice: 500,
    warningLowPrice: 2000,
    maxSuspiciousPrice: 500000000,
    maxMoq: 50000,
    warningMoq: 5000,
  },
  escrowDeposit: {
    defaultDepositRate: 10, // 10%
    minDepositRate: 0,
    maxDepositRate: 50, // Max 50%
    requireDepositForHighValue: true,
    highValueThreshold: 5000000, // 5,000,000 VND
    escrowHoldDays: 3, // 3 days hold before completion
    description: 'Chính sách tỷ lệ phần trăm ký quỹ bảo đảm và đặt cọc đơn hàng sỉ toàn sàn.',
  },
  orderAndDelivery: {
    orderAutoCancelHours: 4, // 4 giờ vựa phải nhận đơn trước khi tự hủy & hoàn cọc
    complaintWindowHours: 24, // 24 giờ khiếu nại sau khi giao
    deliveryAllowedStartHour: 5, // 05:00 sáng
    deliveryAllowedEndHour: 21, // 21:00 tối
    autoCompleteDeliveredHours: 48, // 48 giờ tự động hoàn tất nếu không khiếu nại
    allowWeekendDelivery: true,
  },
  consignment: {
    maxConsignmentItemsPerStore: 5, // Tối đa 5 mặt hàng ký gửi / cặp tiệm - vựa
    settlementCycleDays: 7, // Chu kỳ nhắc nhở kết toán định kỳ (ngày)
    allowConsignmentForUnverified: false, // Chỉ vựa đã xác minh mới được ký gửi
  },
  walletLimits: {
    minDepositAmount: 50000, // Nạp tối thiểu 50.000đ
    minWithdrawalAmount: 100000, // Rút tối thiểu 100.000đ
    maxDailyWithdrawalAmount: 50000000, // Rút tối đa 50.000.000đ/ngày
    autoApproveWithdrawalThreshold: 2000000, // Dưới 2.000.000đ tự động duyệt
  },
  systemNotice: {
    maintenanceMode: false,
    maintenanceMessage: 'Hệ thống SupplyMind đang bảo trì nâng cấp hệ thống định kỳ. Quý khách vui lòng quay lại sau.',
    announcementEnabled: false,
    announcementTitle: 'Thông báo từ Ban Quản Trị Sàn SupplyMind',
    announcementContent: '',
    announcementType: 'INFO', // 'INFO' | 'WARNING' | 'ALERT'
  },
  updatedAt: new Date().toISOString(),
  updatedBy: null,
};

let cachedConfig = null;

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  }
}

function loadConfig() {
  if (documents.active()) return documents.readDocument('systemConfig', DEFAULT_CONFIG);
  ensureDataFile();
  try {
    const raw = fs.readFileSync(configFile, 'utf8');
    const parsed = JSON.parse(raw);
    cachedConfig = {
      aiModeration: {
        ...DEFAULT_CONFIG.aiModeration,
        ...(parsed.aiModeration || {}),
        criticalForbiddenKeywords: Array.isArray(parsed.aiModeration?.criticalForbiddenKeywords)
          ? parsed.aiModeration.criticalForbiddenKeywords
          : [...DEFAULT_CONFIG.aiModeration.criticalForbiddenKeywords],
        restrictedKeywords: Array.isArray(parsed.aiModeration?.restrictedKeywords)
          ? parsed.aiModeration.restrictedKeywords
          : [...DEFAULT_CONFIG.aiModeration.restrictedKeywords],
      },
      escrowDeposit: {
        ...DEFAULT_CONFIG.escrowDeposit,
        ...(parsed.escrowDeposit || {}),
      },
      orderAndDelivery: {
        ...DEFAULT_CONFIG.orderAndDelivery,
        ...(parsed.orderAndDelivery || {}),
      },
      consignment: {
        ...DEFAULT_CONFIG.consignment,
        ...(parsed.consignment || {}),
      },
      walletLimits: {
        ...DEFAULT_CONFIG.walletLimits,
        ...(parsed.walletLimits || {}),
      },
      systemNotice: {
        ...DEFAULT_CONFIG.systemNotice,
        ...(parsed.systemNotice || {}),
      },
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      updatedBy: parsed.updatedBy || null,
    };
    return cachedConfig;
  } catch (error) {
    cachedConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    return cachedConfig;
  }
}

function saveConfig(config) {
  if (documents.active()) return documents.writeDocument('systemConfig', config);
  ensureDataFile();
  const tempFile = `${configFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tempFile, configFile);
  cachedConfig = config;
}

function getConfig() {
  if (documents.active()) return loadConfig();
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}

function updateConfig(actorId, updates = {}) {
  const current = getConfig();

  const nextAi = { ...current.aiModeration };
  const nextEscrow = { ...current.escrowDeposit };
  const nextOrder = { ...current.orderAndDelivery };
  const nextConsignment = { ...current.consignment };
  const nextWallet = { ...current.walletLimits };
  const nextNotice = { ...current.systemNotice };

  if (updates.aiModeration) {
    const ai = updates.aiModeration;
    if (typeof ai.autoModerationEnabled === 'boolean') {
      nextAi.autoModerationEnabled = ai.autoModerationEnabled;
    }
    if (['STANDARD', 'STRICT', 'LENIENT'].includes(ai.strictness)) {
      nextAi.strictness = ai.strictness;
    }
    if (Array.isArray(ai.criticalForbiddenKeywords)) {
      nextAi.criticalForbiddenKeywords = Array.from(
        new Set(
          ai.criticalForbiddenKeywords
            .filter((w) => typeof w === 'string' && w.trim().length > 0)
            .map((w) => w.trim().toLowerCase())
        )
      );
    }
    if (Array.isArray(ai.restrictedKeywords)) {
      nextAi.restrictedKeywords = Array.from(
        new Set(
          ai.restrictedKeywords
            .filter((w) => typeof w === 'string' && w.trim().length > 0)
            .map((w) => w.trim().toLowerCase())
        )
      );
    }
    if (typeof ai.minSuspiciousPrice === 'number' && ai.minSuspiciousPrice >= 0) {
      nextAi.minSuspiciousPrice = Math.round(ai.minSuspiciousPrice);
    }
    if (typeof ai.warningLowPrice === 'number' && ai.warningLowPrice >= nextAi.minSuspiciousPrice) {
      nextAi.warningLowPrice = Math.round(ai.warningLowPrice);
    }
    if (typeof ai.maxSuspiciousPrice === 'number' && ai.maxSuspiciousPrice > nextAi.warningLowPrice) {
      nextAi.maxSuspiciousPrice = Math.round(ai.maxSuspiciousPrice);
    }
    if (typeof ai.maxMoq === 'number' && ai.maxMoq >= 1) {
      nextAi.maxMoq = Math.round(ai.maxMoq);
    }
    if (typeof ai.warningMoq === 'number' && ai.warningMoq >= 1 && ai.warningMoq <= nextAi.maxMoq) {
      nextAi.warningMoq = Math.round(ai.warningMoq);
    }
  }

  if (updates.escrowDeposit) {
    const esc = updates.escrowDeposit;
    if (typeof esc.defaultDepositRate === 'number' && esc.defaultDepositRate >= 0 && esc.defaultDepositRate <= 100) {
      nextEscrow.defaultDepositRate = Number(esc.defaultDepositRate.toFixed(2));
    }
    if (typeof esc.minDepositRate === 'number' && esc.minDepositRate >= 0 && esc.minDepositRate <= 100) {
      nextEscrow.minDepositRate = Number(esc.minDepositRate.toFixed(2));
    }
    if (
      typeof esc.maxDepositRate === 'number' &&
      esc.maxDepositRate >= nextEscrow.minDepositRate &&
      esc.maxDepositRate <= 100
    ) {
      nextEscrow.maxDepositRate = Number(esc.maxDepositRate.toFixed(2));
    }
    if (typeof esc.requireDepositForHighValue === 'boolean') {
      nextEscrow.requireDepositForHighValue = esc.requireDepositForHighValue;
    }
    if (typeof esc.highValueThreshold === 'number' && esc.highValueThreshold >= 0) {
      nextEscrow.highValueThreshold = Math.round(esc.highValueThreshold);
    }
    if (typeof esc.escrowHoldDays === 'number' && esc.escrowHoldDays >= 0 && esc.escrowHoldDays <= 30) {
      nextEscrow.escrowHoldDays = Math.round(esc.escrowHoldDays);
    }
    if (typeof esc.description === 'string') {
      nextEscrow.description = esc.description.slice(0, 500);
    }
  }

  if (updates.orderAndDelivery) {
    const o = updates.orderAndDelivery;
    if (typeof o.orderAutoCancelHours === 'number' && o.orderAutoCancelHours >= 1 && o.orderAutoCancelHours <= 72) {
      nextOrder.orderAutoCancelHours = Math.round(o.orderAutoCancelHours);
    }
    if (typeof o.complaintWindowHours === 'number' && o.complaintWindowHours >= 1 && o.complaintWindowHours <= 168) {
      nextOrder.complaintWindowHours = Math.round(o.complaintWindowHours);
    }
    if (typeof o.deliveryAllowedStartHour === 'number' && o.deliveryAllowedStartHour >= 0 && o.deliveryAllowedStartHour <= 23) {
      nextOrder.deliveryAllowedStartHour = Math.round(o.deliveryAllowedStartHour);
    }
    if (typeof o.deliveryAllowedEndHour === 'number' && o.deliveryAllowedEndHour >= 1 && o.deliveryAllowedEndHour <= 24) {
      nextOrder.deliveryAllowedEndHour = Math.round(o.deliveryAllowedEndHour);
    }
    if (typeof o.autoCompleteDeliveredHours === 'number' && o.autoCompleteDeliveredHours >= 1 && o.autoCompleteDeliveredHours <= 168) {
      nextOrder.autoCompleteDeliveredHours = Math.round(o.autoCompleteDeliveredHours);
    }
    if (typeof o.allowWeekendDelivery === 'boolean') {
      nextOrder.allowWeekendDelivery = o.allowWeekendDelivery;
    }
  }

  if (updates.consignment) {
    const c = updates.consignment;
    if (typeof c.maxConsignmentItemsPerStore === 'number' && c.maxConsignmentItemsPerStore >= 1 && c.maxConsignmentItemsPerStore <= 50) {
      nextConsignment.maxConsignmentItemsPerStore = Math.round(c.maxConsignmentItemsPerStore);
    }
    if (typeof c.settlementCycleDays === 'number' && c.settlementCycleDays >= 1 && c.settlementCycleDays <= 60) {
      nextConsignment.settlementCycleDays = Math.round(c.settlementCycleDays);
    }
    if (typeof c.allowConsignmentForUnverified === 'boolean') {
      nextConsignment.allowConsignmentForUnverified = c.allowConsignmentForUnverified;
    }
  }

  if (updates.walletLimits) {
    const w = updates.walletLimits;
    if (typeof w.minDepositAmount === 'number' && w.minDepositAmount >= 10000) {
      nextWallet.minDepositAmount = Math.round(w.minDepositAmount);
    }
    if (typeof w.minWithdrawalAmount === 'number' && w.minWithdrawalAmount >= 10000) {
      nextWallet.minWithdrawalAmount = Math.round(w.minWithdrawalAmount);
    }
    if (typeof w.maxDailyWithdrawalAmount === 'number' && w.maxDailyWithdrawalAmount >= 500000) {
      nextWallet.maxDailyWithdrawalAmount = Math.round(w.maxDailyWithdrawalAmount);
    }
    if (typeof w.autoApproveWithdrawalThreshold === 'number' && w.autoApproveWithdrawalThreshold >= 0) {
      nextWallet.autoApproveWithdrawalThreshold = Math.round(w.autoApproveWithdrawalThreshold);
    }
  }

  if (updates.systemNotice) {
    const n = updates.systemNotice;
    if (typeof n.maintenanceMode === 'boolean') {
      nextNotice.maintenanceMode = n.maintenanceMode;
    }
    if (typeof n.maintenanceMessage === 'string') {
      nextNotice.maintenanceMessage = n.maintenanceMessage.slice(0, 500);
    }
    if (typeof n.announcementEnabled === 'boolean') {
      nextNotice.announcementEnabled = n.announcementEnabled;
    }
    if (typeof n.announcementTitle === 'string') {
      nextNotice.announcementTitle = n.announcementTitle.slice(0, 150);
    }
    if (typeof n.announcementContent === 'string') {
      nextNotice.announcementContent = n.announcementContent.slice(0, 1000);
    }
    if (['INFO', 'WARNING', 'ALERT'].includes(n.announcementType)) {
      nextNotice.announcementType = n.announcementType;
    }
  }

  const newConfig = {
    aiModeration: nextAi,
    escrowDeposit: nextEscrow,
    orderAndDelivery: nextOrder,
    consignment: nextConsignment,
    walletLimits: nextWallet,
    systemNotice: nextNotice,
    updatedAt: new Date().toISOString(),
    updatedBy: actorId || null,
  };

  saveConfig(newConfig);
  return newConfig;
}

function resetConfig(actorId) {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  fresh.updatedAt = new Date().toISOString();
  fresh.updatedBy = actorId || null;
  saveConfig(fresh);
  return fresh;
}

function addKeyword(type, word) {
  if (!word || typeof word !== 'string') return getConfig();
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return getConfig();

  const current = getConfig();
  const next = JSON.parse(JSON.stringify(current));

  if (type === 'forbidden') {
    if (!next.aiModeration.criticalForbiddenKeywords.includes(cleaned)) {
      next.aiModeration.criticalForbiddenKeywords.push(cleaned);
      next.updatedAt = new Date().toISOString();
      saveConfig(next);
    }
  } else if (type === 'restricted') {
    if (!next.aiModeration.restrictedKeywords.includes(cleaned)) {
      next.aiModeration.restrictedKeywords.push(cleaned);
      next.updatedAt = new Date().toISOString();
      saveConfig(next);
    }
  }

  return next;
}

function removeKeyword(type, word) {
  if (!word || typeof word !== 'string') return getConfig();
  const cleaned = word.trim().toLowerCase();
  const current = getConfig();
  const next = JSON.parse(JSON.stringify(current));

  if (type === 'forbidden') {
    next.aiModeration.criticalForbiddenKeywords = next.aiModeration.criticalForbiddenKeywords.filter(
      (w) => w !== cleaned
    );
    next.updatedAt = new Date().toISOString();
    saveConfig(next);
  } else if (type === 'restricted') {
    next.aiModeration.restrictedKeywords = next.aiModeration.restrictedKeywords.filter((w) => w !== cleaned);
    next.updatedAt = new Date().toISOString();
    saveConfig(next);
  }

  return next;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  updateConfig,
  resetConfig,
  addKeyword,
  removeKeyword,
};

const fs = require('node:fs');
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
  ensureDataFile();
  const tempFile = `${configFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tempFile, configFile);
  cachedConfig = config;
}

function getConfig() {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}

function updateConfig(actorId, updates = {}) {
  const current = getConfig();

  const nextAi = { ...current.aiModeration };
  const nextEscrow = { ...current.escrowDeposit };

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

  const newConfig = {
    aiModeration: nextAi,
    escrowDeposit: nextEscrow,
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

/**
 * Holiday Service - Dữ liệu & Thuật toán Hệ số Nhân Động (Dynamic Time-Decay Multiplier) Lịch Ngày Lễ tại Việt Nam
 */

const VIETNAM_HOLIDAYS = [
  {
    id: 'TET_NGUYEN_DAN',
    name: 'Tết Nguyên Đán',
    month: 1,
    dayStart: 15,
    monthEnd: 2,
    dayEndAlt: 15,
    categories: ['Bia', 'Nước giải khát', 'Bánh kẹo', 'Rượu', 'Mứt', 'Hạt hướng dương', 'Nước ngọt', 'Heineken', 'Danisa', 'Coca'],
    baseMultiplier: 2.2,
    leadDaysNotice: 15,
    description: 'Nhu cầu mua sắm giỏ quà, nước giải khát & bánh kẹo biếu Tết tăng mạnh.',
  },
  {
    id: 'LIBERATION_LABOR_DAY',
    name: 'Đại Lễ 30/4 & Quốc Tế Lao Động 1/5',
    month: 4,
    dayStart: 25,
    monthEnd: 5,
    dayEndAlt: 4,
    categories: ['Bia', 'Nước giải khát', 'Nước ngọt', 'Mì ăn liền', 'Kem', 'Nước tinh khiết', 'Snack', 'Khăn lạnh', 'Heineken', 'Coca'],
    baseMultiplier: 1.6,
    leadDaysNotice: 10,
    description: 'Nhu cầu giải khát, du lịch và ăn uống gia đình tăng cao dịp nghỉ lễ dài ngày.',
  },
  {
    id: 'NATIONAL_DAY',
    name: 'Lễ Quốc Khánh 2/9',
    month: 8,
    dayStart: 28,
    monthEnd: 9,
    dayEndAlt: 4,
    categories: ['Bia', 'Nước giải khát', 'Nước ngọt', 'Mì ăn liền', 'Snack', 'Đồ đóng hộp'],
    baseMultiplier: 1.5,
    leadDaysNotice: 8,
    description: 'Nhu cầu tích trữ thực phẩm & nước giải khát tăng cao dịp nghỉ lễ Quốc Khánh.',
  },
  {
    id: 'MID_AUTUMN',
    name: 'Tết Trung Thu',
    month: 9,
    dayStart: 10,
    monthEnd: 9,
    dayEndAlt: 30,
    categories: ['Bánh kẹo', 'Sữa', 'Nước ngọt', 'Trà', 'Bánh trung thu'],
    baseMultiplier: 1.5,
    leadDaysNotice: 12,
    description: 'Nhu cầu bánh kẹo, đồ ngọt và nước uống chuẩn bị phá cỗ Trung Thu.',
  },
  {
    id: 'CHRISTMAS_NEW_YEAR',
    name: 'Giáng Sinh & Tết Dương Lịch 1/1',
    month: 12,
    dayStart: 20,
    monthEnd: 1,
    dayEndAlt: 5,
    categories: ['Bia', 'Rượu', 'Nước giải khát', 'Bánh kẹo', 'Snack', 'Đồ nướng', 'Heineken', 'Coca', 'Danisa'],
    baseMultiplier: 1.6,
    leadDaysNotice: 10,
    description: 'Lễ tiệc cuối năm và đón năm mới làm tăng mạnh nhu cầu đồ uống & bánh kẹo.',
  },
];

/**
 * Thuật toán tính Trọng Số Thời Điểm (Time-Decay Factor)
 * - Đạt đỉnh 1.0 khi thời điểm rơi vào 3-7 ngày trước lễ (Thời điểm VÀNG nhập hàng)
 * - Giảm nhẹ về 0.35 khi sát ngày lễ (1 ngày trước lễ)
 * - Giảm dần khi còn quá xa (> 10 ngày)
 */
function calculateTimeDecayWeight(daysUntil, leadDaysNotice = 10) {
  if (daysUntil < 0) return 0; // Hết ngày lễ ➔ Trở về x1.0
  if (daysUntil === 0) return 0.2; // Đúng ngày lễ ➔ Nhập dặm nhẹ
  if (daysUntil === 1) return 0.35; // Sát ngày lễ 1 ngày
  if (daysUntil >= 2 && daysUntil <= 7) return 1.0; // Thời điểm VÀNG ➔ Đạt đỉnh 100% hệ số
  
  // Còn xa (> 7 ngày)
  const remainingWindow = Math.max(1, leadDaysNotice - 7);
  const offset = daysUntil - 7;
  return Math.max(0.25, Number((1 - (offset / remainingWindow) * 0.75).toFixed(2)));
}

/**
 * Lấy danh sách ngày lễ đang/sắp diễn ra
 */
function getUpcomingHolidays(windowDays = 14, now = new Date()) {
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const nowMs = now.getTime();
  const windowEndMs = nowMs + windowDays * 86400000;

  const activeHolidays = [];

  for (const h of VIETNAM_HOLIDAYS) {
    const year = now.getFullYear();
    const startDate = new Date(year, h.month - 1, h.dayStart);
    let endDate = new Date(year, (h.monthEnd || h.month) - 1, h.dayEndAlt || h.dayStart + 5);
    
    if (h.monthEnd === 1 && h.month === 12) {
      endDate = new Date(year + 1, 0, h.dayEndAlt);
    }

    const startMs = startDate.getTime() - (h.leadDaysNotice || 10) * 86400000;
    const endMs = endDate.getTime();

    if ((startMs <= windowEndMs && endMs >= nowMs) || (currentMonth === h.month && currentDay >= h.dayStart - 10 && currentDay <= (h.dayEndAlt || 31))) {
      const daysUntil = Math.max(0, Math.ceil((startDate.getTime() - nowMs) / 86400000));
      const decayWeight = calculateTimeDecayWeight(daysUntil, h.leadDaysNotice || 10);
      const dynamicMultiplier = Number((1 + (h.baseMultiplier - 1) * decayWeight).toFixed(2));

      activeHolidays.push({
        id: h.id,
        name: h.name,
        categories: h.categories,
        baseMultiplier: h.baseMultiplier,
        multiplier: dynamicMultiplier,
        description: h.description,
        daysUntil,
        isUpcoming: daysUntil > 0,
        isCurrent: daysUntil === 0,
      });
    }
  }

  // Fallback demo holiday nếu không có ngày lễ thực tế
  if (activeHolidays.length === 0) {
    const daysUntil = 4;
    const decayWeight = calculateTimeDecayWeight(daysUntil, 10);
    const dynamicMultiplier = Number((1 + (1.6 - 1) * decayWeight).toFixed(2));

    activeHolidays.push({
      id: 'LIBERATION_LABOR_DAY',
      name: 'Đại Lễ 30/4 & Quốc Tế Lao Động 1/5 (Mô Phỏng AI)',
      categories: ['Bia', 'Nước giải khát', 'Nước ngọt', 'Mì ăn liền', 'Kem', 'Snack', 'Heineken', 'Coca'],
      baseMultiplier: 1.6,
      multiplier: dynamicMultiplier,
      description: 'Dự báo tăng trưởng nhu cầu đồ uống & thực phẩm giải khát trước dịp Lễ lớn sắp tới.',
      daysUntil: 4,
      isUpcoming: true,
      isCurrent: false,
    });
  }

  return activeHolidays;
}

/**
 * Tính toán hệ số nhân động cho sản phẩm
 */
function getHolidayMultiplierForItem(item, activeHolidays) {
  if (!activeHolidays || activeHolidays.length === 0) {
    return { multiplier: 1.0, holidayNotes: [] };
  }

  const itemNameLower = (item.name || '').toLowerCase();
  let maxMultiplier = 1.0;
  const notes = [];
  let matchedHolidayName = '';

  for (const h of activeHolidays) {
    const isCategoryMatched = h.categories.some((cat) => itemNameLower.includes(cat.toLowerCase()));
    if (isCategoryMatched) {
      if (h.multiplier > maxMultiplier) {
        maxMultiplier = h.multiplier;
        matchedHolidayName = h.name;
      }
      notes.push(`Dịp Lễ [${h.name}]: Thuật toán AI áp dụng hệ số nhân động x${h.multiplier} (Giai đoạn cao điểm còn ${h.daysUntil} ngày)`);
    }
  }

  return {
    multiplier: maxMultiplier,
    matchedHolidayName,
    holidayNotes: notes,
  };
}

module.exports = {
  VIETNAM_HOLIDAYS,
  calculateTimeDecayWeight,
  getUpcomingHolidays,
  getHolidayMultiplierForItem,
};

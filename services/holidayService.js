const DAY = 86400000;
const VN_OFFSET = 7 * 3600000;

function vnDayStart(value) {
  return Math.floor((new Date(value).getTime() + VN_OFFSET) / DAY) * DAY - VN_OFFSET;
}

function dateKey(value) {
  return new Date(vnDayStart(value) + VN_OFFSET).toISOString().slice(0, 10);
}

function calculateTimeDecayWeight(daysUntil, preparationDays = 14) {
  if (daysUntil < 0) return 0;
  if (daysUntil === 0) return 0.2;
  if (daysUntil === 1) return 0.35;
  if (daysUntil <= 7) return 1;
  const remainingWindow = Math.max(1, preparationDays - 7);
  return Math.max(0.25, Number((1 - ((daysUntil - 7) / remainingWindow) * 0.75).toFixed(2)));
}

function parseKeywords(value) {
  return String(value || '')
    .split(',')
    .map(keyword => keyword.trim())
    .filter(Boolean);
}

async function getUpcomingHolidays(prisma, windowDays = 14, now = new Date()) {
  if (!prisma?.holidayConfig?.findMany) return [];
  const today = vnDayStart(now);
  const horizonEnd = today + Math.max(windowDays, 60) * DAY;
  const rows = await prisma.holidayConfig.findMany({
    where: {
      isActive: true,
      endDate: { gte: new Date(today) },
      startDate: { lte: new Date(horizonEnd) },
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  });

  return rows
    .map(row => {
      const start = vnDayStart(row.startDate);
      const end = vnDayStart(row.endDate);
      const preparationStart = start - row.preparationDays * DAY;
      if (preparationStart > today || end < today) return null;
      const daysUntil = Math.max(0, Math.ceil((start - today) / DAY));
      const baseMultiplier = Number(row.demandMultiplier);
      const weight = calculateTimeDecayWeight(daysUntil, row.preparationDays);
      return {
        id: row.id,
        name: row.name,
        startDate: dateKey(row.startDate),
        endDate: dateKey(row.endDate),
        categories: parseKeywords(row.categoryKeywords),
        baseMultiplier,
        multiplier: Number((1 + (baseMultiplier - 1) * weight).toFixed(2)),
        description: row.description,
        preparationDays: row.preparationDays,
        daysUntil,
        isUpcoming: start > today,
        isCurrent: start <= today && end >= today,
      };
    })
    .filter(Boolean);
}

function getHolidayMultiplierForItem(item, activeHolidays) {
  const itemName = String(item.name || '').toLocaleLowerCase('vi-VN');
  let multiplier = 1;
  let matchedHolidayName = '';
  const holidayNotes = [];

  for (const holiday of activeHolidays || []) {
    const keyword = holiday.categories.find(value => itemName.includes(value.toLocaleLowerCase('vi-VN')));
    if (!keyword) continue;
    if (holiday.multiplier > multiplier) {
      multiplier = holiday.multiplier;
      matchedHolidayName = holiday.name;
    }
    holidayNotes.push(
      `Ngày lễ ${holiday.name}: khớp nhóm “${keyword}”, áp dụng hệ số x${holiday.multiplier}; còn ${holiday.daysUntil} ngày.`,
    );
  }

  return { multiplier, matchedHolidayName, holidayNotes };
}

module.exports = {
  calculateTimeDecayWeight,
  getUpcomingHolidays,
  getHolidayMultiplierForItem,
  parseKeywords,
};

const { Prisma } = require('@prisma/client');
const { moderateContent } = require('./contentModerationService');
const { audit, problem, activeAccountWhere, verificationComplete } = require('./platformPolicy');
const { addCalendarMonth, MONTHLY_PRICE } = require('./subscriptionService');
const PAGE_SIZE = 20;
const number = value => Number(value || 0);
const vnDate = date => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && value >= '2020-01-01' && value <= '2100-12-31'
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function textFilter(value, max = 150) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw problem(400, 'Bộ lọc không hợp lệ.');
  return value.trim();
}
function idParam(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) throw problem(400, 'Mã dữ liệu không hợp lệ.');
  return Number(value);
}
function pagination(query) {
  const page = query.page === undefined ? 1 : idParam(query.page);
  if (page > 100000) throw problem(400, 'Trang vượt giới hạn.');
  return { page, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
}
function period(query) {
  const today = vnDate(new Date());
  const from = textFilter(query.from || today.slice(0, 8) + '01', 10);
  const to = textFilter(query.to || today, 10);
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw problem(400, 'Chọn khoảng ngày có thật, ngày bắt đầu không sau ngày kết thúc.');
  const start = new Date(from + 'T00:00:00+07:00');
  const end = new Date(new Date(to + 'T00:00:00+07:00').getTime() + 86400000);
  if (end - start > 366 * 86400000) throw problem(400, 'Mỗi báo cáo tối đa 366 ngày.');
  return { from, to, start, end, range: { gte: start, lt: end } };
}
function state(user) { return !user.isActive ? 'BANNED' : user.suspendedUntil && user.suspendedUntil > new Date() ? 'SUSPENDED' : 'ACTIVE'; }
const subscriptionSelect = { id: true, status: true, trialStartedAt: true, trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true, updatedAt: true };
const userSelect = { id: true, username: true, name: true, email: true, phone: true, isActive: true, suspendedUntil: true, lockReason: true, createdAt: true, updatedAt: true, role: { select: { code: true } }, subscription: { select: subscriptionSelect } };
function publicSubscription(subscription, now = new Date()) {
  if (!subscription) return { status: 'NOT_STARTED', hasAccess: true, accessEndsAt: null, updatedAt: null };
  const accessEndsAt = subscription.status === 'TRIAL' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const hasAccess = Boolean(accessEndsAt && accessEndsAt > now && ['TRIAL', 'ACTIVE'].includes(subscription.status));
  return { ...subscription, status: hasAccess ? subscription.status : 'EXPIRED', hasAccess, accessEndsAt };
}
const publicAccount = user => ({ ...user, status: state(user), role: user.role.code, subscription: publicSubscription(user.subscription) });
const orderInclude = { supplier: { select: { id: true, businessName: true } }, buyer: { select: { name: true } } };
function settlementRow(order) {
  return { id: order.id, supplierId: order.supplierId, businessName: order.supplier.businessName, buyerName: order.buyer.name, subtotal: number(order.subtotal), total: number(order.total), commissionRate: order.commissionRate === null ? null : number(order.commissionRate), commissionAmount: order.commissionAmount === null ? null : number(order.commissionAmount), deliveredAt: order.deliveredAt, paidAt: order.commissionPaidAt, paymentReference: order.commissionPaymentReference, region: order.supplierRegion, paymentStatus: order.commissionAmount === null ? 'UNTRACKED' : number(order.commissionAmount) === 0 ? 'NO_FEE' : order.commissionPaidAt ? 'PAID' : 'UNPAID' };
}
function settlementWhere(query, dates) {
  const status = textFilter(query.status);
  if (!['', 'PAID', 'UNPAID', 'NO_FEE', 'UNTRACKED'].includes(status)) throw problem(400, 'Trạng thái đối soát không hợp lệ.');
  return {
    status: 'DELIVERED', deliveredAt: dates.range, ...(query.supplierId ? { supplierId: idParam(query.supplierId) } : {}),
    ...(status === 'PAID' ? { commissionPaidAt: { not: null } } : status === 'UNPAID' ? { commissionPaidAt: null, commissionAmount: { gt: 0 } } : status === 'NO_FEE' ? { commissionAmount: 0 } : status === 'UNTRACKED' ? { commissionAmount: null } : {})
  };
}
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function serializeHoliday(row) {
  return {
    ...row,
    startDate: new Date(row.startDate).toISOString().slice(0, 10),
    endDate: new Date(row.endDate).toISOString().slice(0, 10),
    demandMultiplier: number(row.demandMultiplier),
  };
}
function holidayInput(body, requireVersion = false) {
  body = body && typeof body === 'object' ? body : {};
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const description = typeof body.description === 'string' ? body.description.trim().replace(/\s+/g, ' ') : '';
  const keywords = typeof body.categoryKeywords === 'string'
    ? [...new Set(body.categoryKeywords.split(',').map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean))].join(', ')
    : '';
  const preparationDays = body.preparationDays;
  const demandMultiplier = body.demandMultiplier;
  if (name.length < 2 || name.length > 150) throw problem(400, 'Tên ngày lễ cần từ 2–150 ký tự.');
  if (!dateOnly(body.startDate) || !dateOnly(body.endDate) || body.startDate > body.endDate) throw problem(400, 'Chọn ngày bắt đầu, kết thúc hợp lệ và đúng thứ tự.');
  if (new Date(body.endDate) - new Date(body.startDate) > 31 * 86400000) throw problem(400, 'Một đợt ngày lễ tối đa 32 ngày.');
  if (!Number.isInteger(preparationDays) || preparationDays < 0 || preparationDays > 60) throw problem(400, 'Số ngày chuẩn bị cần là số nguyên từ 0–60.');
  if (typeof demandMultiplier !== 'number' || !Number.isFinite(demandMultiplier) || demandMultiplier < 1 || demandMultiplier > 5 || Math.abs(demandMultiplier * 100 - Math.round(demandMultiplier * 100)) > 0.000001) throw problem(400, 'Hệ số nhu cầu từ 1–5, tối đa 2 số thập phân.');
  if (!keywords || keywords.length > 1000) throw problem(400, 'Nhập nhóm hàng áp dụng, ngăn cách bằng dấu phẩy và tối đa 1.000 ký tự.');
  if (description.length > 500) throw problem(400, 'Mô tả tối đa 500 ký tự.');
  if (typeof body.isActive !== 'boolean') throw problem(400, 'Trạng thái cấu hình không hợp lệ.');
  if (requireVersion && !Number.isInteger(body.version)) throw problem(400, 'Tải lại cấu hình trước khi sửa.');
  return {
    data: {
      name,
      startDate: new Date(body.startDate + 'T00:00:00.000Z'),
      endDate: new Date(body.endDate + 'T00:00:00.000Z'),
      preparationDays,
      demandMultiplier,
      categoryKeywords: keywords,
      description: description || null,
      isActive: body.isActive,
    },
    version: body.version,
  };
}
function createAdminService(prisma, config) {
  async function listUsers(query) {
    const { page, skip, take } = pagination(query), q = textFilter(query.q), role = textFilter(query.role), status = textFilter(query.status);
    if (!['', 'STORE_OWNER', 'SUPPLIER'].includes(role) || !['', 'ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) throw problem(400, 'Vai trò hoặc trạng thái không hợp lệ.');
    const where = {
      role: { code: role || { in: ['STORE_OWNER', 'SUPPLIER'] } },
      ...(status === 'BANNED' ? { isActive: false } : status === 'SUSPENDED' ? { isActive: true, suspendedUntil: { gt: new Date() } } : status === 'ACTIVE' ? activeAccountWhere() : {}),
      ...(q ? { AND: [{ OR: ['username', 'name', 'email', 'phone'].map(field => ({ [field]: { contains: q } })) }] } : {})
    };
    const [users, total] = await Promise.all([prisma.user.findMany({ where, select: userSelect, skip, take, orderBy: { id: 'desc' } }), prisma.user.count({ where })]);
    return { users: users.map(publicAccount), total, page, hasMore: skip + take < total };
  }
  async function changeAccount(actorId, id, body) {
    const reason = textFilter(body.reason, 500);
    if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(body.status) || reason.length < 3 || typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) throw problem(400, 'Chọn trạng thái, nhập lý do từ 3–500 ký tự và tải lại tài khoản trước khi sửa.');
    const until = body.status === 'SUSPENDED' && typeof body.suspendedUntil === 'string' ? new Date(body.suspendedUntil) : null;
    if (body.status === 'SUSPENDED' && (!until || !Number.isFinite(until.getTime()) || until <= new Date() || until - new Date() > 366 * 86400000)) throw problem(400, 'Thời hạn khóa phải trong tương lai và tối đa 366 ngày.');
    return prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id }, include: { role: true } });
      if (!user) throw problem(404, 'Không tìm thấy tài khoản.');
      if (id === actorId || !['STORE_OWNER', 'SUPPLIER'].includes(user.role.code)) throw problem(403, 'Chỉ quản lý khóa tài khoản chủ tạp hóa và chủ vựa.');
      const data = { isActive: body.status !== 'BANNED', suspendedUntil: until, lockReason: reason };
      const changed = await tx.user.updateMany({ where: { id, updatedAt: new Date(body.expectedUpdatedAt) }, data });
      if (!changed.count) throw problem(409, 'Tài khoản đã thay đổi. Tải lại danh sách.');
      if (body.status !== 'ACTIVE') {
        await tx.authSession.deleteMany({ where: { userId: id } });
        await tx.passwordReset.deleteMany({ where: { userId: id } });
      }
      await audit(tx, actorId, 'ACCOUNT_STATUS_CHANGED', 'USER', id, { before: state(user), after: body.status, until, reason });
      return publicAccount(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
    }, { isolationLevel: 'Serializable' });
  }
  async function unlockSubscription(actorId, id, body) {
    const reason = textFilter(body.reason, 500);
    if (reason.length < 3) throw problem(400, 'Nhập lý do mở khóa từ 3–500 ký tự.');
    return prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id }, include: { role: true, subscription: true } });
      if (!user) throw problem(404, 'Không tìm thấy tài khoản.');
      if (id === actorId || !['STORE_OWNER', 'SUPPLIER'].includes(user.role.code)) throw problem(403, 'Chỉ cấp quyền sử dụng cho chủ tạp hóa và chủ vựa.');
      if (!user.subscription) throw problem(409, 'Tài khoản chưa bắt đầu tháng dùng thử nên chưa cần mở khóa.');
      const before = publicSubscription(user.subscription);
      if (before.hasAccess) throw problem(409, 'Gói sử dụng của tài khoản vẫn còn hiệu lực.');
      const periodStart = new Date();
      const periodEnd = addCalendarMonth(periodStart);
      await tx.subscription.update({
        where: { id: user.subscription.id },
        data: {
          status: 'ACTIVE',
          monthlyPrice: MONTHLY_PRICE,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      });
      await audit(tx, actorId, 'SUBSCRIPTION_UNLOCKED_BY_ADMIN', 'SUBSCRIPTION', user.subscription.id, {
        userId: id, reason, periodStart, periodEnd, paymentCreated: false,
      });
      return publicAccount(await tx.user.findUniqueOrThrow({ where: { id }, select: userSelect }));
    }, { isolationLevel: 'Serializable' });
  }
  async function verifications(query) {
    const { page, skip, take } = pagination(query), status = textFilter(query.status), q = textFilter(query.q);
    if (!['', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED'].includes(status)) throw problem(400, 'Trạng thái xác minh không hợp lệ.');
    const where = { user: { role: { code: 'SUPPLIER' } }, ...(status ? { verificationStatus: status } : {}), ...(q ? { businessName: { contains: q } } : {}) };
    const [profiles, total] = await Promise.all([prisma.supplierProfile.findMany({ where, include: { user: { select: userSelect } }, skip, take, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }] }), prisma.supplierProfile.count({ where })]);
    return { profiles: profiles.map(p => ({ ...p, deliveryFee: number(p.deliveryFee), deliveryRadiusKm: number(p.deliveryRadiusKm), user: publicAccount(p.user) })), total, page, hasMore: skip + take < total };
  }
  async function review(actorId, id, body) {
    const note = textFilter(body.note, 500);
    if (!['APPROVED', 'REJECTED'].includes(body.status) || !Number.isInteger(body.version) || note.length < 3) throw problem(400, 'Chọn kết quả và nhập nhận xét từ 3–500 ký tự.');
    return prisma.$transaction(async tx => {
      const profile = await tx.supplierProfile.findUnique({ where: { id }, include: { user: { include: { role: true } } } });
      if (!profile) throw problem(404, 'Không tìm thấy hồ sơ.');
      if (profile.user.role.code !== 'SUPPLIER' || !['PENDING', 'APPROVED'].includes(profile.verificationStatus) || (body.status === 'APPROVED' && profile.verificationStatus !== 'PENDING')) throw problem(409, 'Hồ sơ chưa gửi duyệt hoặc đã được xử lý.');
      if (body.status === 'APPROVED' && (!verificationComplete(profile) || state(profile.user) !== 'ACTIVE')) throw problem(409, 'Hồ sơ thiếu thông tin hoặc tài khoản đang bị khóa.');
      const changed = await tx.supplierProfile.updateMany({ where: { id, verificationVersion: body.version, verificationStatus: profile.verificationStatus }, data: { verificationStatus: body.status, verificationNote: note, reviewedAt: new Date(), reviewedBy: actorId, verificationVersion: { increment: 1 } } });
      if (!changed.count) throw problem(409, 'Hồ sơ đã thay đổi. Tải lại trước khi duyệt.');
      await audit(tx, actorId, 'SUPPLIER_VERIFICATION_REVIEWED', 'SUPPLIER', id, { before: profile.verificationStatus, after: body.status, note });
      return { message: body.status === 'APPROVED' ? 'Đã duyệt hồ sơ, gian hàng có thể mở bán.' : 'Đã từ chối hoặc thu hồi quyền mở bán.' };
    }, { isolationLevel: 'Serializable' });
  }
  async function settings() { const row = await prisma.platformSetting.findUniqueOrThrow({ where: { id: 1 } }); return { ...row, commissionRate: number(row.commissionRate) }; }
  async function changeRate(actorId, body) {
    const rate = body.commissionRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.000001 || !Number.isInteger(body.version)) throw problem(400, 'Tỷ lệ từ 0–100%, tối đa 2 số thập phân.');
    return prisma.$transaction(async tx => {
      const old = await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
      const result = await tx.platformSetting.updateMany({ where: { id: 1, version: body.version }, data: { commissionRate: rate, version: { increment: 1 } } });
      if (!result.count) throw problem(409, 'Mức phí vừa được người khác đổi. Tải lại trước khi lưu.');
      await audit(tx, actorId, 'COMMISSION_RATE_CHANGED', 'SETTING', 1, { before: old.commissionRate.toString(), after: String(rate) });
      return { commissionRate: rate, version: body.version + 1 };
    });
  }
  async function settlements(query, exportCsv = false) {
    const dates = period(query), where = settlementWhere(query, dates), { page, skip, take } = pagination(query);
    const total = await prisma.wholesaleOrder.count({ where });
    if (exportCsv && total > 10000) throw problem(400, 'Báo cáo vượt 10.000 đơn. Thu hẹp kỳ hoặc chọn một chủ vựa.');
    const [orders, totals, unpaid, suppliers] = await Promise.all([
      prisma.wholesaleOrder.findMany({ where, include: orderInclude, orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }], skip: exportCsv ? 0 : skip, take: exportCsv ? 10000 : take }),
      prisma.wholesaleOrder.aggregate({ where, _sum: { subtotal: true, commissionAmount: true } }),
      prisma.wholesaleOrder.aggregate({ where: { AND: [where, { commissionPaidAt: null }] }, _sum: { commissionAmount: true } }),
      prisma.wholesaleOrder.groupBy({ by: ['supplierId'], where, _sum: { commissionAmount: true, subtotal: true }, _count: true }),
    ]);
    const rows = orders.map(settlementRow);
    if (exportCsv) {
      const headings = ['Mã đơn', 'Chủ vựa', 'Ngày giao (VN)', 'Tiền hàng', 'Tỷ lệ %', 'Phí hoa hồng', 'Trạng thái', 'Ngày thu (VN)', 'Mã chứng từ'];
      const csv = '\uFEFF' + [headings, ...rows.map(row => [row.id, row.businessName, row.deliveredAt?.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), row.subtotal, row.commissionRate, row.commissionAmount, { PAID: 'Đã thu', UNPAID: 'Chưa thu', NO_FEE: 'Miễn phí', UNTRACKED: 'Chưa có dữ liệu phí' }[row.paymentStatus], row.paidAt?.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), row.paymentReference])].map(row => row.map(csvCell).join(',')).join('\r\n');
      return { csv, from: dates.from, to: dates.to };
    }
    const names = await prisma.supplierProfile.findMany({ where: { id: { in: suppliers.map(s => s.supplierId) } }, select: { id: true, businessName: true } });
    return { orders: rows, total, page, hasMore: skip + take < total, totals: { subtotal: number(totals._sum.subtotal), commission: number(totals._sum.commissionAmount), unpaid: number(unpaid._sum.commissionAmount) }, suppliers: suppliers.map(s => ({ id: s.supplierId, name: names.find(n => n.id === s.supplierId)?.businessName || `#${s.supplierId}`, orders: s._count, commission: number(s._sum.commissionAmount) })) };
  }
  async function markPaid(actorId, id, body) {
    const reference = textFilter(body.reference, 150);
    if (reference.length < 3) throw problem(400, 'Nhập mã chứng từ hoặc tham chiếu thu phí từ 3–150 ký tự.');
    return prisma.$transaction(async tx => {
      const changed = await tx.wholesaleOrder.updateMany({ where: { id, status: 'DELIVERED', commissionAmount: { gt: 0 }, commissionPaidAt: null }, data: { commissionPaidAt: new Date(), commissionPaidBy: actorId, commissionPaymentReference: reference } });
      if (!changed.count) throw problem(409, 'Chỉ xác nhận đơn đã giao, có phí và chưa thu. Đơn có thể vừa được xử lý.');
      const order = await tx.wholesaleOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
      await audit(tx, actorId, 'COMMISSION_RECEIVED', 'ORDER', id, { amount: order.commissionAmount.toString(), reference });
      return settlementRow(order);
    });
  }
  async function analytics(query) {
    const dates = period(query), region = textFilter(query.region, 100);
    const where = { status: 'DELIVERED', deliveredAt: dates.range, ...(region ? { supplierRegion: region } : {}) };
    const regionSql = region ? Prisma.sql`AND o.supplierRegion = ${region}` : Prisma.empty;
    const [totals, paid, unpaid, users, pending, legacyOrders, daily, topProducts, regions] = await Promise.all([
      prisma.wholesaleOrder.aggregate({ where, _count: true, _sum: { subtotal: true, commissionAmount: true } }),
      prisma.wholesaleOrder.aggregate({ where: { status: 'DELIVERED', commissionPaidAt: dates.range, ...(region ? { supplierRegion: region } : {}) }, _sum: { commissionAmount: true } }),
      prisma.wholesaleOrder.aggregate({ where: { ...where, commissionPaidAt: null }, _sum: { commissionAmount: true } }),
      prisma.user.groupBy({ by: ['roleId'], where: { role: { code: { in: ['STORE_OWNER', 'SUPPLIER'] } } }, _count: true }),
      prisma.supplierProfile.count({ where: { verificationStatus: 'PENDING' } }),
      prisma.wholesaleOrder.count({ where: { status: 'DELIVERED', deliveredAt: null } }),
      prisma.$queryRaw(Prisma.sql`SELECT CONVERT(varchar(10), DATEADD(hour, 7, o.deliveredAt), 23) AS day, SUM(o.subtotal) AS gmv, COUNT(*) AS orders FROM dbo.wholesale_orders o WHERE o.status = 'DELIVERED' AND o.deliveredAt >= ${dates.start} AND o.deliveredAt < ${dates.end} ${regionSql} GROUP BY CONVERT(varchar(10), DATEADD(hour, 7, o.deliveredAt), 23) ORDER BY day`),
      prisma.$queryRaw(Prisma.sql`SELECT TOP (10) i.productId, i.productName, i.packaging, o.supplierRegion AS region, SUM(CAST(i.quantity AS BIGINT)) AS quantity, SUM(i.lineTotal) AS revenue FROM dbo.wholesale_order_items i JOIN dbo.wholesale_orders o ON o.id = i.orderId WHERE o.status = 'DELIVERED' AND o.deliveredAt >= ${dates.start} AND o.deliveredAt < ${dates.end} ${regionSql} GROUP BY i.productId, i.productName, i.packaging, o.supplierRegion ORDER BY revenue DESC, i.productId ASC`),
      prisma.wholesaleOrder.findMany({ where: { status: 'DELIVERED', deliveredAt: dates.range, supplierRegion: { not: null } }, distinct: ['supplierRegion'], select: { supplierRegion: true } }),
    ]);
    const counts = await prisma.role.findMany({ where: { id: { in: users.map(u => u.roleId) } } });
    return { from: dates.from, to: dates.to, gmv: number(totals._sum.subtotal), completedOrders: totals._count, commissionAccrued: number(totals._sum.commissionAmount), commissionReceived: number(paid._sum.commissionAmount), commissionUnpaid: number(unpaid._sum.commissionAmount), pendingVerifications: pending, legacyOrders, users: Object.fromEntries(users.map(u => [counts.find(r => r.id === u.roleId).code, u._count])), daily: daily.map(d => ({ ...d, gmv: number(d.gmv) })), topProducts: topProducts.map(p => ({ ...p, quantity: number(p.quantity), revenue: number(p.revenue) })), regions: regions.map(r => r.supplierRegion) };
  }
  async function aiMetrics(query) {
    const dates = period(query), where = { createdAt: dates.range };
    const [groups, runs, accepted, daily] = await Promise.all([
      prisma.aiUsageEvent.groupBy({ by: ['provider', 'status'], where, _count: true, _avg: { durationMs: true }, _sum: { inputTokens: true, outputTokens: true } }),
      prisma.recommendationRun.count({ where }),
      prisma.recommendationRun.count({ where: { ...where, acceptedAt: { not: null } } }),
      prisma.$queryRaw(Prisma.sql`SELECT CONVERT(varchar(10), DATEADD(hour, 7, createdAt), 23) AS day, provider, COUNT(*) AS calls FROM dbo.ai_usage_events WHERE createdAt >= ${dates.start} AND createdAt < ${dates.end} GROUP BY CONVERT(varchar(10), DATEADD(hour, 7, createdAt), 23), provider ORDER BY day`),
    ]);
    return { groups: groups.map(g => ({ provider: g.provider, status: g.status, count: g._count, averageMs: Math.round(g._avg.durationMs || 0), inputTokens: g._sum.inputTokens, outputTokens: g._sum.outputTokens })), recommendationRuns: runs, acceptedRuns: accepted, acceptanceRate: runs ? Math.round(accepted / runs * 10000) / 100 : null, daily, configuredProvider: config.aiApiKey && config.aiModel ? (config.aiProvider || 'OPENAI') : null, weatherIntegrated: false };
  }
  async function holidays() {
    const rows = await prisma.holidayConfig.findMany({ orderBy: [{ startDate: 'asc' }, { id: 'asc' }] });
    return { holidays: rows.map(serializeHoliday) };
  }
  async function createHoliday(actorId, body) {
    const { data } = holidayInput(body);
    return prisma.$transaction(async tx => {
      const created = await tx.holidayConfig.create({ data });
      await audit(tx, actorId, 'HOLIDAY_CREATED', 'HOLIDAY', created.id, {
        name: created.name, startDate: body.startDate, endDate: body.endDate,
        preparationDays: created.preparationDays, demandMultiplier: created.demandMultiplier.toString(),
      });
      return serializeHoliday(created);
    });
  }
  async function updateHoliday(actorId, id, body) {
    const { data, version } = holidayInput(body, true);
    return prisma.$transaction(async tx => {
      const old = await tx.holidayConfig.findUnique({ where: { id } });
      if (!old) throw problem(404, 'Không tìm thấy cấu hình ngày lễ.');
      const changed = await tx.holidayConfig.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
      if (!changed.count) throw problem(409, 'Cấu hình vừa được thay đổi. Tải lại trước khi lưu.');
      const saved = await tx.holidayConfig.findUniqueOrThrow({ where: { id } });
      await audit(tx, actorId, 'HOLIDAY_UPDATED', 'HOLIDAY', id, {
        before: serializeHoliday(old), after: serializeHoliday(saved),
      });
      return serializeHoliday(saved);
    });
  }
  async function deleteHoliday(actorId, id, body) {
    if (!Number.isInteger(body?.version)) throw problem(400, 'Tải lại cấu hình trước khi xóa.');
    return prisma.$transaction(async tx => {
      const row = await tx.holidayConfig.findUnique({ where: { id } });
      if (!row) throw problem(404, 'Không tìm thấy cấu hình ngày lễ.');
      const deleted = await tx.holidayConfig.deleteMany({ where: { id, version: body.version } });
      if (!deleted.count) throw problem(409, 'Cấu hình vừa được thay đổi. Tải lại trước khi xóa.');
      await audit(tx, actorId, 'HOLIDAY_DELETED', 'HOLIDAY', id, serializeHoliday(row));
      return { message: 'Đã xóa cấu hình ngày lễ.' };
    });
  }
  async function logs(query) {
    const dates = period(query), { page, take, skip } = pagination(query), action = textFilter(query.action, 60), entityId = textFilter(query.entityId, 50);
    const where = { createdAt: dates.range, ...(action ? { action: { contains: action } } : {}), ...(entityId ? { entityId } : {}) };
    const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }), prisma.auditLog.count({ where })]);
    const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(r => r.actorId).filter(Boolean))] } }, select: { id: true, name: true, username: true } });
    return { logs: rows.map(row => ({ ...row, actor: actors.find(a => a.id === row.actorId) || null, details: JSON.parse(row.details) })), total, page, hasMore: skip + take < total };
  }
  async function listModerationQueue(query = {}) {
    const { page, skip, take } = pagination(query);
    const products = await prisma.supplierProduct.findMany({
      include: { supplier: { select: { businessName: true, user: { select: { name: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    const itemsWithModeration = await Promise.all(
      products.map(async (p) => {
        const mod = await moderateContent({
          name: p.name,
          category: p.category,
          packaging: p.packaging,
          wholesalePrice: number(p.wholesalePrice),
          moq: p.moq,
        }, config || {});

        return {
          id: p.id,
          supplierId: p.supplierId,
          supplierName: p.supplier.businessName,
          supplierOwner: p.supplier.user.name,
          name: p.name,
          category: p.category,
          packaging: p.packaging,
          wholesalePrice: number(p.wholesalePrice),
          stockQty: p.stockQty,
          moq: p.moq,
          isActive: p.isActive,
          createdAt: p.createdAt,
          moderation: mod,
        };
      })
    );

    // Hàng chờ Admin CHỈ hiển thị các bài cần duyệt Mức 2 (NEEDS_REVIEW), loại bỏ AUTO_REJECTED để giảm tải cho Admin
    const reviewQueue = itemsWithModeration.filter(item => item.moderation.status === 'NEEDS_REVIEW');
    const autoRejectedCount = itemsWithModeration.filter(item => item.moderation.status === 'AUTO_REJECTED').length;
    const autoApprovedCount = itemsWithModeration.filter(item => item.moderation.status === 'AUTO_APPROVED').length;
    const total = reviewQueue.length;
    const queue = reviewQueue.slice(skip, skip + take);

    return {
      queue,
      total,
      page,
      hasMore: skip + take < total,
      summary: {
        flaggedCount: reviewQueue.length,
        autoApprovedCount,
        autoRejectedCount,
        totalCount: itemsWithModeration.length,
      },
    };
  }

  async function moderateAction(actorId, productId, body = {}) {
    const action = body.action;
    const reason = textFilter(body.reason, 255);
    if (!['APPROVE', 'REJECT'].includes(action)) throw problem(400, 'Hành động duyệt không hợp lệ (chỉ APPROVE hoặc REJECT).');

    const product = await prisma.supplierProduct.findUnique({ where: { id: productId } });
    if (!product) throw problem(404, 'Không tìm thấy sản phẩm.');

    const newActiveState = action === 'APPROVE';
    await prisma.supplierProduct.update({
      where: { id: productId },
      data: { isActive: newActiveState },
    });

    await audit(prisma, actorId, action === 'APPROVE' ? 'PRODUCT_AI_MODERATION_APPROVED' : 'PRODUCT_AI_MODERATION_REJECTED', 'PRODUCT', productId, {
      action,
      reason,
      productName: product.name,
    });

    return {
      success: true,
      message: action === 'APPROVE' ? 'Đã duyệt sản phẩm thành công.' : 'Đã từ chối và gỡ sản phẩm khỏi sàn sỉ.',
      productId,
      action,
    };
  }
  return {
    listUsers, changeAccount, unlockSubscription, verifications, review, settings, changeRate,
    settlements, markPaid, analytics, aiMetrics, holidays, createHoliday,
    updateHoliday, deleteHoliday, logs, listModerationQueue, moderateAction,
  };
}
module.exports = { createAdminService, idParam, period, csvCell, holidayInput, serializeHoliday };

const { audit, problem } = require('./platformPolicy');

const MONTHLY_PRICE = 19000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function addCalendarMonth(value) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

async function ensureSubscription(prisma, user) {
  if (user.role === 'ADMIN') return null;
  let subscription = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (subscription) return subscription;
  const startedAt = new Date();
  try {
    subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        status: 'TRIAL',
        monthlyPrice: MONTHLY_PRICE,
        trialStartedAt: startedAt,
        trialEndsAt: addCalendarMonth(startedAt),
      },
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    subscription = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } });
  }
  return subscription;
}

async function refreshStatus(prisma, subscription, now = new Date()) {
  if (!subscription) return null;
  const trialActive = subscription.status === 'TRIAL' && subscription.trialEndsAt > now;
  const paidActive = subscription.status === 'ACTIVE' && subscription.currentPeriodEnd && subscription.currentPeriodEnd > now;
  if (trialActive || paidActive) return subscription;
  if (subscription.status === 'EXPIRED') return subscription;
  return prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
}

function serializeSubscription(subscription, payments = [], now = new Date()) {
  if (!subscription) {
    return {
      exempt: true, status: 'EXEMPT', hasAccess: true, monthlyPrice: 0,
      trialStartedAt: null, trialEndsAt: null, currentPeriodStart: null,
      currentPeriodEnd: null, accessEndsAt: null, daysRemaining: null, payments: [],
    };
  }
  const accessEndsAt = subscription.status === 'TRIAL' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const hasAccess = Boolean(accessEndsAt && accessEndsAt > now && ['TRIAL', 'ACTIVE'].includes(subscription.status));
  return {
    exempt: false,
    id: subscription.id,
    status: hasAccess ? subscription.status : 'EXPIRED',
    hasAccess,
    monthlyPrice: Number(subscription.monthlyPrice),
    trialStartedAt: subscription.trialStartedAt,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    accessEndsAt,
    daysRemaining: accessEndsAt ? Math.max(0, Math.ceil((accessEndsAt.getTime() - now.getTime()) / 86400000)) : 0,
    payments: payments.map(payment => ({
      id: payment.id,
      amount: Number(payment.amount),
      status: payment.status,
      method: payment.method,
      reference: payment.reference,
      periodStart: payment.periodStart,
      periodEnd: payment.periodEnd,
      paidAt: payment.paidAt,
    })),
  };
}

function createSubscriptionService(prisma) {
  async function get(user) {
    if (user.role === 'ADMIN') return serializeSubscription(null);
    const current = await refreshStatus(prisma, await ensureSubscription(prisma, user));
    const payments = await prisma.subscriptionPayment.findMany({
      where: { subscriptionId: current.id },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      take: 24,
    });
    return serializeSubscription(current, payments);
  }

  async function renew(user, requestId) {
    if (user.role === 'ADMIN') throw problem(400, 'Tài khoản Admin không cần đóng phí sử dụng.');
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw problem(400, 'Mã yêu cầu gia hạn không hợp lệ.');
    return prisma.$transaction(async tx => {
      const current = await refreshStatus(tx, await ensureSubscription(tx, user));
      const previous = await tx.subscriptionPayment.findUnique({ where: { requestId } });
      if (previous) {
        if (previous.subscriptionId !== current.id) throw problem(409, 'Mã gia hạn đã được dùng cho tài khoản khác.');
        const saved = await tx.subscription.findUniqueOrThrow({ where: { id: current.id } });
        const payments = await tx.subscriptionPayment.findMany({ where: { subscriptionId: current.id }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], take: 24 });
        return serializeSubscription(saved, payments);
      }
      const now = new Date();
      const futureEnds = [
        current.status === 'TRIAL' ? current.trialEndsAt : null,
        current.currentPeriodEnd,
      ].filter(value => value && value > now);
      const periodStart = futureEnds.length ? new Date(Math.max(...futureEnds.map(value => value.getTime()))) : now;
      const periodEnd = addCalendarMonth(periodStart);
      const reference = `SIM-SUB-${current.id}-${Date.now()}`;
      await tx.subscriptionPayment.create({
        data: {
          subscriptionId: current.id, requestId, amount: MONTHLY_PRICE,
          status: 'PAID', method: 'SIMULATED', reference, periodStart, periodEnd,
        },
      });
      const saved = await tx.subscription.update({
        where: { id: current.id },
        data: {
          status: 'ACTIVE', monthlyPrice: MONTHLY_PRICE,
          currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
        },
      });
      await audit(tx, user.id, 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION', current.id, {
        amount: MONTHLY_PRICE, method: 'SIMULATED', reference, periodStart, periodEnd,
      });
      const payments = await tx.subscriptionPayment.findMany({ where: { subscriptionId: current.id }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], take: 24 });
      return serializeSubscription(saved, payments);
    }, { isolationLevel: 'Serializable' });
  }

  async function access(user) {
    if (user.role === 'ADMIN') return { hasAccess: true, subscription: serializeSubscription(null) };
    const subscription = await refreshStatus(prisma, await ensureSubscription(prisma, user));
    const serialized = serializeSubscription(subscription);
    return { hasAccess: serialized.hasAccess, subscription: serialized };
  }

  async function renewByUserId(userId, requestId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!user || !user.isActive || (user.suspendedUntil && user.suspendedUntil > new Date())) {
      throw problem(403, 'Tài khoản đang bị quản trị viên khóa.');
    }
    return renew({ id: user.id, role: user.role.code }, requestId);
  }

  return { get, renew, renewByUserId, access };
}

module.exports = { createSubscriptionService, addCalendarMonth, serializeSubscription, MONTHLY_PRICE };

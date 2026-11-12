const STATUSES = ['PENDING', 'APPROVED', 'PREPARING', 'SHIPPING', 'ISSUE_HANDLING', 'DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const ACTIVE_COMPLAINT_STATUSES = ['OPEN', 'IN_REVIEW', 'REJECTED', 'ESCALATED'];
const FILTER_STATUSES = [...STATUSES, 'HAS_COMPLAINT'];

function orderQuery(query = {}) {
  const { page = '1', status = '', q = '' } = query;
  if (
    typeof page !== 'string' ||
    !/^\d+$/.test(page) ||
    Number(page) < 1 ||
    Number(page) > 100000 ||
    typeof status !== 'string' ||
    (status && !FILTER_STATUSES.includes(status)) ||
    typeof q !== 'string'
  ) {
    throw Object.assign(new Error('Trang, từ khóa tìm kiếm hoặc trạng thái đơn không hợp lệ.'), { status: 400 });
  }
  return { page: Number(page), status, q: q.trim().slice(0, 100) };
}

function buildOrderWhere(baseWhere, { status = '', q = '' } = {}) {
  const andConditions = [baseWhere];

  if (status === 'HAS_COMPLAINT') {
    andConditions.push({
      OR: [
        { status: 'ISSUE_HANDLING' },
        { complaint: { is: { status: { in: ACTIVE_COMPLAINT_STATUSES } } } },
      ],
    });
  } else if (status) {
    andConditions.push({ status });
  }

  const trimmed = typeof q === 'string' ? q.trim() : '';
  if (trimmed) {
    const cleanNum = trimmed.replace(/^#/, '');
    const numericId = /^\d+$/.test(cleanNum) ? Number(cleanNum) : null;
    const orConditions = [
      { recipientName: { contains: trimmed } },
      { recipientPhone: { contains: trimmed } },
      { note: { contains: trimmed } },
      { buyer: { name: { contains: trimmed } } },
      { buyer: { username: { contains: trimmed } } },
      { supplier: { businessName: { contains: trimmed } } },
      { items: { some: { productName: { contains: trimmed } } } },
    ];
    if (numericId && Number.isSafeInteger(numericId) && numericId > 0 && numericId <= 2147483647) {
      orConditions.unshift({ id: numericId });
    }
    andConditions.push({ OR: orConditions });
  }

  return andConditions.length === 1 ? baseWhere : { AND: andConditions };
}

module.exports = { orderQuery, buildOrderWhere, STATUSES, ACTIVE_COMPLAINT_STATUSES, FILTER_STATUSES };

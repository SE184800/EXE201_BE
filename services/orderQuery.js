const STATUSES = ['PENDING', 'APPROVED', 'PREPARING', 'SHIPPING', 'DELIVERED', 'REJECTED'];
function orderQuery(query = {}) {
  const { page = '1', status = '' } = query;
  if (typeof page !== 'string' || !/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 100000 || typeof status !== 'string' || (status && !STATUSES.includes(status)))
    throw Object.assign(new Error('Trang hoặc trạng thái đơn không hợp lệ.'), { status: 400 });
  return { page: Number(page), status };
}
module.exports = { orderQuery, STATUSES };

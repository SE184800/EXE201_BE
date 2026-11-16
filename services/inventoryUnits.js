const INT_MAX = 2147483647;
const containers = 'thùng|két|hộp|lốc|khay|kiện|bịch|lô|bao|vỉ';
const bulkUnits = ['thung', 'ket', 'loc', 'khay', 'kien', 'lo', 'bao'];
const looseUnits = ['lon', 'chai', 'gói', 'bịch', 'cái', 'hộp', 'túi', 'vỉ', 'kg'];
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim().replace(/\s+/g, ' ');

function parsePackaging(value) {
  const packaging = String(value || '').trim() || 'cái';
  let match = packaging.match(new RegExp(`^(${containers})\\s+(\\d+)\\s*([\\p{L}]+)$`, 'iu'));
  if (match) return { container: match[1], multiplier: Number(match[2]), retailUnit: match[3] };
  match = packaging.match(new RegExp(`^(\\d+)\\s*([\\p{L}]+)\\s*/\\s*(${containers})$`, 'iu'));
  if (match) return { container: match[3], multiplier: Number(match[1]), retailUnit: match[2] };
  return { container: packaging, multiplier: 1, retailUnit: packaging };
}

function isBulkUnit(unit) {
  return bulkUnits.includes(normalize(unit)) || normalize(unit).split(/[^a-z]+/).some(word => bulkUnits.includes(word));
}

function toRetailStock(data) {
  const { container, retailUnit, multiplier } = parsePackaging(data.unit);
  if (isBulkUnit(retailUnit) || (container !== retailUnit && multiplier < 1)) {
    throw Object.assign(new Error('Nhập đơn vị bán lẻ (lon, chai, bịch…) hoặc ghi rõ quy cách, ví dụ “24 lon/thùng”.'), { status: 400 });
  }
  if (container === retailUnit) return data;
  const quantity = data.quantity * multiplier;
  if (!Number.isSafeInteger(multiplier) || multiplier > INT_MAX || !Number.isSafeInteger(quantity) || quantity > INT_MAX) {
    throw Object.assign(new Error('Số lượng sau quy đổi vượt giới hạn kho.'), { status: 400 });
  }
  const converted = { ...data, unit: retailUnit, quantity };
  for (const key of ['purchasePrice', 'sellingPrice']) {
    if (data[key] != null) converted[key] = Math.round(data[key] / multiplier);
  }
  return converted;
}

module.exports = { normalize, parsePackaging, isBulkUnit, toRetailStock, looseUnits };

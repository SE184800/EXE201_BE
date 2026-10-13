const { readSheet } = require('read-excel-file/node');

const MAX_IMPORT_ROWS = 200;
const MAX_SAFE_DB_NUMBER = 2147483647;

const headerAliases = {
  name: ['ten san pham', 'san pham', 'ten hang', 'mat hang'],
  unit: ['don vi', 'dvt', 'don vi tinh'],
  quantity: ['so luong nhap', 'so luong', 'sl nhap', 'sl', 'so luong ton'],
  purchasePrice: ['gia nhap', 'gia von', 'don gia nhap'],
  sellingPrice: ['gia ban', 'don gia ban'],
  receivedAt: ['ngay nhap', 'ngay nhan hang', 'ngay giao dich'],
  expiryDate: ['han su dung', 'hsd', 'ngay het han'],
  note: ['ghi chu', 'mo ta'],
};

function fold(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function productKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('vi');
}

function unwrapCell(value) {
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    Object.hasOwn(value, 'result')
  ) {
    return value.result;
  }
  return value;
}

function parseIntegerCell(value, { required = false, min = 0 } = {}) {
  const raw = unwrapCell(value);
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return required ? { error: 'Không được để trống.' } : { value: undefined };
  }
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < min || raw > MAX_SAFE_DB_NUMBER) {
      return { error: `Phải là số nguyên từ ${min.toLocaleString('vi-VN')} đến 2.147.483.647.` };
    }
    return { value: raw };
  }
  const text = String(raw).trim().replace(/\s|₫|đ|vnd/gi, '');
  if (!/^\d+(?:[.,]\d{3})*$/.test(text)) {
    return { error: `Phải là số nguyên từ ${min.toLocaleString('vi-VN')} đến 2.147.483.647.` };
  }
  const number = Number(text.replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(number) || number < min || number > MAX_SAFE_DB_NUMBER) {
    return { error: `Phải là số nguyên từ ${min.toLocaleString('vi-VN')} đến 2.147.483.647.` };
  }
  return { value: number };
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function parseDateCell(value) {
  const raw = unwrapCell(value);
  if (raw === null || raw === undefined || String(raw).trim() === '') return { value: undefined };
  if (raw instanceof Date && !Number.isNaN(raw.valueOf())) {
    const date = validDate(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    return date ? { value: date } : { error: 'Ngày không hợp lệ.' };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const epoch = Date.UTC(1899, 11, 30);
    const converted = new Date(epoch + Math.round(raw) * 86400000);
    return Number.isNaN(converted.valueOf())
      ? { error: 'Ngày không hợp lệ.' }
      : { value: converted };
  }
  const text = String(raw).trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const date = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return date ? { value: date } : { error: 'Ngày không hợp lệ.' };
  }
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const date = validDate(Number(match[3]), Number(match[2]), Number(match[1]));
    return date ? { value: date } : { error: 'Ngày không hợp lệ.' };
  }
  return { error: 'Dùng định dạng ngày dd/mm/yyyy hoặc yyyy-mm-dd.' };
}

function findHeader(data) {
  const aliases = new Map();
  for (const [field, names] of Object.entries(headerAliases)) {
    for (const name of names) aliases.set(name, field);
  }
  for (let index = 0; index < Math.min(data.length, 8); index += 1) {
    const columns = {};
    data[index].forEach((cell, columnIndex) => {
      const field = aliases.get(fold(cell));
      if (field !== undefined && columns[field] === undefined) columns[field] = columnIndex;
    });
    if (columns.name !== undefined && columns.unit !== undefined && columns.quantity !== undefined) {
      return { rowIndex: index, columns };
    }
  }
  const error = new Error(
    'Không tìm thấy các cột bắt buộc: Tên sản phẩm, Đơn vị và Số lượng nhập.',
  );
  error.status = 400;
  throw error;
}

function cellAt(row, columns, field) {
  return columns[field] === undefined ? undefined : row[columns[field]];
}

async function parseInventoryWorkbook(buffer) {
  let data;
  try {
    data = await readSheet(buffer);
  } catch {
    const error = new Error('Không đọc được file Excel. Hãy dùng file .xlsx hợp lệ.');
    error.status = 400;
    throw error;
  }
  return parseInventorySheetData(data);
}

function parseInventorySheetData(data) {
  if (!Array.isArray(data) || !data.length) {
    const error = new Error('File Excel không có dữ liệu.');
    error.status = 400;
    throw error;
  }
  const { rowIndex, columns } = findHeader(data);
  const sourceRows = data
    .slice(rowIndex + 1)
    .map((cells, index) => ({ cells, rowNumber: rowIndex + index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell !== null && String(cell).trim() !== ''));
  if (!sourceRows.length) {
    const error = new Error('File Excel chưa có dòng sản phẩm nào.');
    error.status = 400;
    throw error;
  }
  if (sourceRows.length > MAX_IMPORT_ROWS) {
    const error = new Error(`Mỗi lần chỉ nhập tối đa ${MAX_IMPORT_ROWS} dòng sản phẩm.`);
    error.status = 400;
    throw error;
  }

  const rows = [];
  const errors = [];
  for (const source of sourceRows) {
    const rowErrors = [];
    const rawName = unwrapCell(cellAt(source.cells, columns, 'name'));
    const rawUnit = unwrapCell(cellAt(source.cells, columns, 'unit'));
    const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';
    const unit = typeof rawUnit === 'string' ? rawUnit.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 100) rowErrors.push('Tên sản phẩm cần từ 1 đến 100 ký tự.');
    if (!unit || unit.length > 20) rowErrors.push('Đơn vị cần từ 1 đến 20 ký tự.');

    const quantity = parseIntegerCell(cellAt(source.cells, columns, 'quantity'), {
      required: true,
      min: 1,
    });
    const purchasePrice = parseIntegerCell(cellAt(source.cells, columns, 'purchasePrice'));
    const sellingPrice = parseIntegerCell(cellAt(source.cells, columns, 'sellingPrice'));
    const receivedAt = parseDateCell(cellAt(source.cells, columns, 'receivedAt'));
    const expiryDate = parseDateCell(cellAt(source.cells, columns, 'expiryDate'));
    if (quantity.error) rowErrors.push(`Số lượng nhập: ${quantity.error}`);
    if (purchasePrice.error) rowErrors.push(`Giá nhập: ${purchasePrice.error}`);
    if (sellingPrice.error) rowErrors.push(`Giá bán: ${sellingPrice.error}`);
    if (receivedAt.error) rowErrors.push(`Ngày nhập: ${receivedAt.error}`);
    if (expiryDate.error) rowErrors.push(`Hạn sử dụng: ${expiryDate.error}`);

    const rawNote = unwrapCell(cellAt(source.cells, columns, 'note'));
    const note = rawNote === null || rawNote === undefined ? '' : String(rawNote).trim();
    if (note.length > 200) rowErrors.push('Ghi chú tối đa 200 ký tự.');

    const received = receivedAt.value || new Date();
    if (received < new Date('1900-01-01T00:00:00Z') || received > new Date(Date.now() + 86400000)) {
      rowErrors.push('Ngày nhập phải từ 01/01/1900 đến hôm nay.');
    }

    const warnings = [];
    const todayInVietnam = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    if (expiryDate.value && expiryDate.value.toISOString().slice(0, 10) < todayInVietnam) {
      warnings.push('Lô hàng đã quá hạn sử dụng.');
    }
    const row = {
      rowNumber: source.rowNumber,
      name,
      unit,
      quantity: quantity.value,
      purchasePrice: purchasePrice.value,
      sellingPrice: sellingPrice.value,
      receivedAt: received,
      expiryDate: expiryDate.value,
      note,
      warnings,
    };
    rows.push(row);
    for (const message of rowErrors) errors.push({ rowNumber: source.rowNumber, message });
  }
  return { rows, errors };
}

function annotateInventoryImport(rows, existingItems) {
  const known = new Map(existingItems.map((item) => [productKey(item.name), item]));
  const errors = [];
  const result = rows.map((row) => {
    const key = productKey(row.name);
    const existing = known.get(key);
    if (existing && fold(existing.unit) !== fold(row.unit)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: `Sản phẩm đã có đơn vị “${existing.unit}”, không thể nhập bằng đơn vị “${row.unit}”.`,
      });
    }
    const action = existing ? 'ADD' : 'CREATE';
    if (!existing) known.set(key, { name: row.name, unit: row.unit });
    return { ...row, action };
  });
  return { rows: result, errors };
}

function serializeImportRow(row) {
  const isoDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : null);
  return {
    ...row,
    receivedAt: isoDate(row.receivedAt),
    expiryDate: isoDate(row.expiryDate),
  };
}

module.exports = {
  MAX_IMPORT_ROWS,
  annotateInventoryImport,
  parseInventorySheetData,
  parseInventoryWorkbook,
  productKey,
  serializeImportRow,
};

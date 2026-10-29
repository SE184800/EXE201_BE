const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = path.join(__dirname, '../data');
const contractsFile = path.join(dataDir, 'contracts.json');

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(contractsFile)) {
    fs.writeFileSync(contractsFile, JSON.stringify({ contracts: {} }, null, 2), 'utf8');
  }
}

function getContractsData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(contractsFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { contracts: {} };
  }
}

function saveContractsData(data) {
  ensureDataFile();
  const tmp = `${contractsFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, contractsFile);
}

function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function normalizePrivateKey(raw) {
  if (!raw || typeof raw !== 'string') {
    const err = new Error('Vui lòng nhập khóa bí mật cá nhân (Private Key).');
    err.status = 400;
    throw err;
  }
  let clean = raw.trim();
  if (!clean.includes('-----BEGIN')) {
    const compact = clean.replace(/\s+/g, '');
    clean = `-----BEGIN PRIVATE KEY-----\n${compact}\n-----END PRIVATE KEY-----`;
  }
  return clean;
}

function formatRawKey(pem) {
  return pem.replace(/-----[^\-]+-----/g, '').replace(/\s+/g, '');
}

function getCanonicalContractText(contract) {
  const signer = contract.signerInfo || {};
  return [
    '================================================================================',
    'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
    'Độc lập - Tự do - Hạnh phúc',
    '--------------------------------------------------------------------------------',
    'THỎA THUẬN KẾT NỐI VÀ HỢP ĐỒNG ĐIỆN TỬ DỊCH VỤ NỀN TẢNG SUPPLYMIND',
    `Số hợp đồng: ${contract.contractNumber}`,
    `Ngày khởi tạo: ${contract.createdAt.slice(0, 10)}`,
    '',
    'BÊN A (ĐƠN VỊ CUNG CẤP DỊCH VỤ NỀN TẢNG):',
    '- Tên đơn vị: Nền tảng SupplyMind AI',
    '- Đại diện pháp luật: Ban Điều hành Nền tảng SupplyMind AI',
    '- Địa chỉ: Khu Công nghệ cao, Phường Tân Phú, TP. Thủ Đức, TP. Hồ Chí Minh',
    '- Email: contact@supplymind.vn · Hotline: 1900 6868',
    '',
    'BÊN B (ĐỐI TÁC THAM GIA KẾT NỐI VÀ SỬ DỤNG DỊCH VỤ):',
    `- Tên đối tác / Cơ sở kinh doanh: ${signer.businessName || 'Cơ sở chưa đăng ký tên'}`,
    `- Người đại diện hợp pháp: ${signer.name || 'Đại diện cơ sở'}`,
    `- Số điện thoại đăng ký: ${signer.phone || 'Chưa cập nhật'}`,
    `- Mã số thuế / CCCD: ${signer.taxCode || 'Chưa đăng ký'}`,
    `- Địa chỉ cơ sở kinh doanh: ${signer.address || 'Chưa lưu địa chỉ'}`,
    `- Tọa độ bản đồ số (GPS): ${signer.latitude && signer.longitude ? `${signer.latitude}, ${signer.longitude}` : 'Xác thực qua địa chỉ hành chính'}`,
    `- Vai trò trên hệ thống: ${contract.role === 'SUPPLIER' ? 'Chủ Vựa / Nhà Cung Cấp Sỉ' : 'Chủ Cửa Hàng Tạp Hóa'}`,
    '',
    'NỘI DUNG THỎA THUẬN VÀ ĐIỀU KHOẢN CAM KẾT:',
    'ĐIỀU 1: MỤC ĐÍCH KẾT NỐI VÀ CẤP QUYỀN TRUY CẬP THÔNG TIN VẬN HÀNH',
    '1.1. Bên B đồng ý kết nối hoạt động kinh doanh vào mạng lưới chuỗi cung ứng B2B của SupplyMind.',
    '1.2. Bên B cho phép hệ thống SupplyMind truy cập các thông tin: danh mục hàng hóa, tồn kho, lịch sử bán hàng và tọa độ vị trí để thuật toán AI thực hiện dự báo nhu cầu nhập hàng và điều phối xe tối ưu.',
    '1.3. Nền tảng cam kết toàn bộ dữ liệu kinh doanh của Bên B được mã hóa an toàn, không chia sẻ cho bên thứ ba.',
    '',
    'ĐIỀU 2: QUYỀN LỢI ĐỐI TÁC VÀ CHƯƠNG TRÌNH CHÀO HÀNG TIẾP THỊ 0Đ',
    '2.1. Bên B được cấp quyền sử dụng miễn phí các công cụ: AI Restock dự báo nhập hàng, Trợ lý bán lẻ giọng nói và Biểu đồ doanh thu.',
    '2.2. Đối tác tạp hóa được quyền tham gia chương trình "Chào hàng tiếp thị / Bán thử vốn 0đ": chỉ trả tiền hàng sau khi đã bán được cho khách tiêu dùng theo giá sỉ đã thỏa thuận.',
    '2.3. Chủ vựa cam kết xuất xe tự động cấp bù số lượng khi kho tạp hóa cạn hàng và đổi mới 100% sản phẩm cận hạn sử dụng (dưới 14 ngày).',
    '',
    'ĐIỀU 3: MINH BẠCH DÒNG TIỀN VÀ CƠ CHẾ KÝ QUỸ ĐẢM BẢO (ESCROW 10%)',
    '3.1. Khi tạo đơn hàng sỉ, tiệm tạp hóa thực hiện ký quỹ 10% giá trị đơn hàng vào Ví hệ thống (Escrow) để đảm bảo hợp đồng.',
    '3.2. Toàn bộ số tiền cọc 10% được giữ an toàn độc lập, chỉ tự động giải ngân cho Chủ vựa ngay khi Tiệm tạp hóa xác nhận đã nhận đủ hàng hóa.',
    '3.3. 90% giá trị còn lại của đơn hàng được thanh toán bằng tiền mặt (COD) hoặc chuyển khoản tại thời điểm giao nhận.',
    '3.4. Trường hợp đơn hàng bị hủy do lỗi phía Chủ vựa hoặc hàng hóa bị bể vỡ hư hỏng nặng, 100% tiền cọc sẽ được hoàn trả tức thì vào Ví của Tiệm tạp hóa.',
    '',
    'ĐIỀU 4: MINH BẠCH GIÁ CẢ VÀ ĐIỀU CHỈNH GIÁ DỊP LỄ',
    '4.1. Chủ vựa cam kết không tự ý găm hàng, ép giá hoặc tăng giá đột ngột trái với báo giá đã xác lập.',
    '4.2. Mọi biến động giá trong các dịp cao điểm lễ tết phải thông báo minh bạch qua hệ số được AI cảnh báo trước.',
    '',
    'ĐIỀU 5: KIỂM DUYỆT HÀNG HÓA VÀ TỪ CẤM',
    '5.1. Chủ vựa cam kết toàn bộ hàng hóa hợp pháp, đầy đủ nguồn gốc và còn hạn sử dụng.',
    '5.2. Sản phẩm phải qua bộ lọc kiểm duyệt AI tự động; nghiêm cấm mặt hàng chứa từ cấm hoặc hàng giả.',
    '5.3. Hàng hóa có điều kiện phải được Admin duyệt giấy phép trước khi mở bán.',
    '',
    'ĐIỀU 6: QUY TRÌNH BÁO CÁO SỰ CỐ TRONG 2 GIỜ VÀ XỬ PHẠT VI PHẠM',
    '6.1. Khi phát hiện hàng hóa bể vỡ, thiếu hụt hoặc sai sản phẩm, Tiệm tạp hóa phải gửi Báo cáo sự cố trong vòng 2 giờ để đối soát chuyến xe.',
    '6.2. Hành vi bùng đơn, gian lận hoặc phá hoại hệ thống ký quỹ sẽ bị tịch thu tiền cọc và khóa tài khoản vĩnh viễn (BANNED).',
    '',
    'ĐIỀU 7: HIỆU LỰC PHÁP LÝ VÀ CHỮ KÝ SỐ ĐIỆN TỬ',
    '7.1. Thỏa thuận này được lập dưới dạng chứng từ điện tử theo Luật Giao dịch điện tử số 20/2023/QH15.',
    '7.2. Thỏa thuận có hiệu lực từ thời điểm Bên B hoàn tất ký số bằng Khóa bí mật cá nhân (Private Key) và được SupplyMind chứng thực toàn vẹn bằng Con dấu điện tử.',
    '================================================================================',
  ].join('\n');
}

function getOrCreateUserContract(user, profileInfo = {}) {
  const data = getContractsData();
  const userIdStr = String(user.id);
  const roleCode = user.role?.code || user.role || 'STORE_OWNER';

  let contract = data.contracts[userIdStr];
  if (!contract) {
    const keyPair = generateKeyPair();
    contract = {
      userId: user.id,
      username: user.username,
      role: roleCode,
      contractNumber: `SM-HD-2026-${String(user.id).padStart(6, '0')}`,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      rawPrivateKey: formatRawKey(keyPair.privateKey),
      rawPublicKey: formatRawKey(keyPair.publicKey),
      isSigned: false,
      createdAt: new Date().toISOString(),
      signedAt: null,
      contractHash: null,
      signature: null,
      signerInfo: {
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || profileInfo.storePhone || '',
        businessName: profileInfo.storeName || profileInfo.businessName || (roleCode === 'SUPPLIER' ? 'Vựa Sỉ Đối Tác' : 'Tiệm Tạp Hóa Đối Tác'),
        taxCode: profileInfo.taxCode || '',
        address: profileInfo.storeAddress || profileInfo.warehouseAddress || '',
        locationType: profileInfo.locationType || 'STREET_FRONT',
        latitude: profileInfo.latitude || null,
        longitude: profileInfo.longitude || null,
      },
      stamp: null,
    };
    data.contracts[userIdStr] = contract;
    saveContractsData(data);
  } else {
    // Synchronize latest store info into signerInfo
    if (profileInfo && (profileInfo.storeName || profileInfo.businessName || profileInfo.storeAddress)) {
      contract.signerInfo = {
        ...contract.signerInfo,
        name: user.name || contract.signerInfo.name,
        phone: user.phone || profileInfo.storePhone || contract.signerInfo.phone,
        businessName: profileInfo.storeName || profileInfo.businessName || contract.signerInfo.businessName,
        taxCode: profileInfo.taxCode || contract.signerInfo.taxCode,
        address: profileInfo.storeAddress || profileInfo.warehouseAddress || contract.signerInfo.address,
        latitude: profileInfo.latitude ?? contract.signerInfo.latitude,
        longitude: profileInfo.longitude ?? contract.signerInfo.longitude,
      };
      saveContractsData(data);
    }
  }

  return contract;
}

function signContract(userId, enteredPrivateKey, agreedTerms, clientMeta = {}) {
  if (!agreedTerms) {
    const err = new Error('Vui lòng tích chọn đồng ý với tất cả điều khoản hợp đồng trước khi ký.');
    err.status = 400;
    throw err;
  }

  const data = getContractsData();
  const userIdStr = String(userId);
  const contract = data.contracts[userIdStr];

  if (!contract) {
    const err = new Error('Không tìm thấy thông tin hợp đồng của tài khoản này.');
    err.status = 404;
    throw err;
  }

  const normalizedKey = normalizePrivateKey(enteredPrivateKey);
  const canonicalText = getCanonicalContractText(contract);
  const textBuffer = Buffer.from(canonicalText, 'utf8');

  let signature;
  try {
    signature = crypto.sign(null, textBuffer, normalizedKey);
  } catch (signErr) {
    const err = new Error('Khóa bí mật cá nhân (Private Key) không đúng định dạng Ed25519 hoặc bị lỗi ký.');
    err.status = 400;
    err.detail = signErr.message;
    throw err;
  }

  const isVerified = crypto.verify(null, textBuffer, contract.publicKey, signature);
  if (!isVerified) {
    const err = new Error('Khóa bí mật (Private Key) không khớp với Khóa công khai của tài khoản này. Vui lòng kiểm tra lại khóa được cấp.');
    err.status = 400;
    throw err;
  }

  const contractHash = crypto.createHash('sha256').update(textBuffer).digest('hex');
  const signedAt = new Date().toISOString();

  contract.isSigned = true;
  contract.signedAt = signedAt;
  contract.contractHash = contractHash;
  contract.signature = signature.toString('base64');
  contract.stamp = {
    certificateId: `SM-CERT-${contractHash.slice(0, 12).toUpperCase()}`,
    status: 'VERIFIED_VALID',
    signedBy: contract.signerInfo.businessName || contract.signerInfo.name,
    representative: contract.signerInfo.name,
    authority: 'SUPPLYMIND PLATFORM ESCROW CA',
    algorithm: 'Ed25519-SHA256',
    signedAt,
    ipAddress: clientMeta.ip || '127.0.0.1',
    qrPayload: `https://supplymind.vn/verify-contract?num=${contract.contractNumber}&hash=${contractHash}`,
  };

  data.contracts[userIdStr] = contract;
  saveContractsData(data);

  return contract;
}

function getContractByUserId(userId) {
  const data = getContractsData();
  return data.contracts[String(userId)] || null;
}

module.exports = {
  getOrCreateUserContract,
  signContract,
  getContractByUserId,
  getCanonicalContractText,
  formatRawKey,
};

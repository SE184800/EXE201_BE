const fs = require('node:fs');
const documents = require('./documentStorage');
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
  if (documents.active()) return documents.readDocument('contracts', { contracts: {} });
  ensureDataFile();
  try {
    const raw = fs.readFileSync(contractsFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { contracts: {} };
  }
}

function saveContractsData(data) {
  if (documents.active()) return documents.writeDocument('contracts', data);
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
    '3.1. Khi tạo đơn hàng sỉ có áp dụng đặt cọc, Tiệm tạp hóa thực hiện ký quỹ đảm bảo (mặc định 10% giá trị đơn hàng) vào Ví bảo chứng hệ thống (Escrow).',
    '3.2. Khoản ký quỹ được giữ an toàn độc lập, chỉ giải ngân cho Chủ vựa khi Tiệm tạp hóa xác nhận hoàn tất đơn hàng (hoặc khi hết thời hạn tự động hoàn tất mà không có khiếu nại).',
    '3.3. Phần giá trị còn lại của đơn hàng được thanh toán bằng tiền mặt (COD), chuyển khoản hoặc Ví điện tử tại thời điểm giao nhận thực tế.',
    '3.4. Việc hoàn trả hoặc giải ngân tiền cọc/tiền hàng phát sinh từ hủy đơn hoặc khiếu nại giao nhận được hệ thống tự động thực hiện căn cứ theo phương án thống nhất cuối cùng giữa Tiệm tạp hóa và Chủ vựa tại Điều 6.',
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
    'ĐIỀU 6: QUY TRÌNH KHIẾU NẠI, ĐỐI SOÁT VÀ GHI NHẬN KẾT QUẢ',
    '6.1. Điều kiện và thời hạn mở khiếu nại (24 giờ): Khi phát hiện hàng bể vỡ, thiếu hụt, sai sản phẩm, lỗi chất lượng hoặc cận/hết hạn sử dụng, Tiệm tạp hóa có quyền gửi tối đa 01 báo cáo khiếu nại kèm ảnh bằng chứng cho mỗi đơn hàng trong vòng 24 giờ kể từ lúc đơn chuyển trạng thái Đã giao (DELIVERED) và trước khi bấm Hoàn tất đơn. Trong lúc khiếu nại đang xử lý, hệ thống tạm khóa thao tác nhập kho và tất toán đơn để bảo toàn tiền ký quỹ.',
    '6.2. Cơ chế tự thương lượng hai bên và nguyên tắc đồng thuận: Chủ vựa tiếp nhận khiếu nại và đưa ra phương án xử lý (Giao bù hàng mới 0đ, Giảm trừ tiền COD, Trả hàng hoàn tiền/cọc, Trao đổi thêm, hoặc Từ chối kèm lý do). Phương án của Chủ vựa chỉ có hiệu lực chốt đơn khi Tiệm tạp hóa bấm Xác nhận đồng ý phương án (hoặc chủ động chấp nhận giải trình/rút khiếu nại); Chủ vựa không được tự ý đóng khiếu nại một chiều. Nếu chưa đồng ý, hai bên tiếp tục trao đổi lại phương án cho đến khi đạt thống nhất.',
    '6.3. Thực thi kết quả thống nhất (Hoàn thành): Ngay khi Tiệm tạp hóa xác nhận đồng ý phương án cuối cùng, trạng thái khiếu nại chuyển sang Hoàn thành (RESOLVED) và hệ thống tự động thực thi phương án đã thống nhất (tạo đơn bù 0đ, giảm trừ trực tiếp số tiền phải thu COD, hoặc hoàn tiền cọc/tiền ví và cập nhật tồn kho) đồng thời mở khóa tất toán đơn hàng.',
    '6.4. Ghi nhận lịch sử trung lập trên hệ thống Admin: Nền tảng SupplyMind và Quản trị viên (Admin) chỉ cung cấp hệ thống lưu vết và ghi nhận minh bạch toàn bộ thông tin khiếu nại (người khiếu nại, bên bị khiếu nại, nguyên nhân, bằng chứng, giá trị đơn, tiền đã trả, tiền cọc, trạng thái xử lý từ Bắt đầu -> Đang xử lý -> Hoàn thành và kết quả thống nhất cuối cùng). Admin KHÔNG đứng ra phân xử thắng/thua; lịch sử ghi nhận là căn cứ đối soát tài chính và xử lý tài khoản vi phạm khi cần thiết.',
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
  } else if (!contract.isSigned) {
    // Only drafts follow profile changes. Signed content must match its signature.
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

  return presentContract(contract);
}

function presentContract(contract) {
  // Keep old unsupported signatures invalid after removal.
  if (!contract || !contract.signingMethod || contract.signingMethod === 'PRIVATE_KEY') return contract;
  return { ...contract, isSigned: false, stamp: contract.stamp ? { ...contract.stamp,
    status: 'UNVERIFIED', authority: 'Phương thức ký không còn hỗ trợ', signingMethod: 'Bản thử nghiệm chưa xác minh',
  } : null };
}

function signContract(userId, signPayload, agreedTerms, clientMeta = {}) {
  if (agreedTerms !== true) {
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

  const method = (typeof signPayload === 'object' && signPayload?.method) || 'PRIVATE_KEY';
  const canonicalText = getCanonicalContractText(contract);
  const textBuffer = Buffer.from(canonicalText, 'utf8');

  let signature;
  const signingMethodLabel = 'Khóa cá nhân Ed25519';
  const authorityLabel = 'SupplyMind · chữ ký nội bộ';

  if (method !== 'PRIVATE_KEY') throw Object.assign(new Error('Phương thức ký chưa được hỗ trợ.'), { status: 400 });
  const enteredPrivateKey = typeof signPayload === 'string' ? signPayload : signPayload?.privateKey;
  const normalizedKey = normalizePrivateKey(enteredPrivateKey);
  try { signature = crypto.sign(null, textBuffer, normalizedKey); }
  catch { throw Object.assign(new Error('Khóa ký không đúng định dạng Ed25519.'), { status: 400 }); }

  // Xac thuc lai chu ky voi Public Key de dam bao tinh toan ven tuyet doi
  const isSignatureValid = crypto.verify(null, textBuffer, contract.publicKey, signature);
  if (!isSignatureValid) {
    const err = new Error('Chữ ký số không vượt qua bước kiểm tra toàn vẹn với Khóa công khai.');
    err.status = 400;
    throw err;
  }

  if (presentContract(contract).isSigned) return contract;

  const contractHash = crypto.createHash('sha256').update(textBuffer).digest('hex');
  const signedAt = new Date().toISOString();

  contract.isSigned = true;
  contract.signedAt = signedAt;
  contract.contractHash = contractHash;
  contract.signature = signature.toString('base64');
  contract.signingMethod = method;
  contract.stamp = {
    certificateId: `SM-CERT-${contractHash.slice(0, 12).toUpperCase()}`,
    status: 'VERIFIED_VALID',
    signedBy: contract.signerInfo.businessName || contract.signerInfo.name,
    representative: contract.signerInfo.name,
    signingMethod: signingMethodLabel,
    authority: authorityLabel,
    algorithm: 'Ed25519',
    signedAt,
    ipAddress: clientMeta.ip || '127.0.0.1',
    qrPayload: JSON.stringify({ type: 'SUPPLYMIND_INTERNAL_SIGNATURE', contractNumber: contract.contractNumber, hash: contractHash, method }),
  };

  data.contracts[userIdStr] = contract;
  saveContractsData(data);

  return contract;
}

function syncContractSignerInfo(userId, profileInfo = {}) {
  const data = getContractsData();
  const userIdStr = String(userId);
  const contract = data.contracts[userIdStr];
  if (!contract) return null;
  if (contract.isSigned) return presentContract(contract);

  contract.signerInfo = {
    ...contract.signerInfo,
    ...(profileInfo.name ? { name: profileInfo.name } : {}),
    ...(profileInfo.phone || profileInfo.storePhone ? { phone: profileInfo.phone || profileInfo.storePhone } : {}),
    ...(profileInfo.storeName || profileInfo.businessName ? { businessName: profileInfo.storeName || profileInfo.businessName } : {}),
    ...(profileInfo.taxCode !== undefined ? { taxCode: profileInfo.taxCode || '' } : {}),
    ...(profileInfo.storeAddress || profileInfo.warehouseAddress ? { address: profileInfo.storeAddress || profileInfo.warehouseAddress } : {}),
    ...(profileInfo.locationType ? { locationType: profileInfo.locationType } : {}),
    ...(profileInfo.latitude !== undefined ? { latitude: profileInfo.latitude } : {}),
    ...(profileInfo.longitude !== undefined ? { longitude: profileInfo.longitude } : {}),
  };

  data.contracts[userIdStr] = contract;
  saveContractsData(data);
  return presentContract(contract);
}

function getContractByUserId(userId) {
  const data = getContractsData();
  return presentContract(data.contracts[String(userId)] || null);
}

module.exports = {
  getOrCreateUserContract,
  signContract,
  getContractByUserId,
  syncContractSignerInfo,
  getCanonicalContractText,
  formatRawKey,
};

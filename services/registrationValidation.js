const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^[\p{L}\p{M} .'-]{2,100}$/u;

function normalizePhone(value) {
  const compact = typeof value === 'string' ? value.replace(/[\s().-]/g, '') : '';
  if (compact.startsWith('+84')) return `0${compact.slice(3)}`;
  if (compact.startsWith('84') && compact.length === 11) return `0${compact.slice(2)}`;
  return compact;
}

function todayInVietnam(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

// Keep rules and messages aligned with FE src/validation/registration.ts.
function validateRegistrationInput(body, now = new Date()) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const string = (field) => typeof input[field] === 'string' ? input[field] : '';
  const name = string('name').trim().replace(/\s+/g, ' ');
  const username = string('username').trim().toLowerCase();
  const email = string('email').trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  const role = string('role');
  const dateOfBirth = string('dateOfBirth').trim();
  const password = string('password');
  const confirmPassword = string('confirmPassword');
  const errors = {};
  if (!NAME_PATTERN.test(name) || !/\p{L}/u.test(name))
    errors.name = 'Họ tên cần 2–100 ký tự, gồm chữ cái, khoảng trắng, dấu chấm, nháy hoặc gạch ngang.';
  if (!USERNAME_PATTERN.test(username))
    errors.username = 'Username dùng 3–50 ký tự chữ không dấu, số, chấm, gạch dưới hoặc gạch ngang.';
  if (!EMAIL_PATTERN.test(email) || email.length > 255 || !/^[\x21-\x7E]+$/.test(email))
    errors.email = 'Nhập email hợp lệ, không dấu và tối đa 255 ký tự.';
  if (!/^0\d{9}$/.test(phone))
    errors.phone = 'Số điện thoại cần 10 số bắt đầu bằng 0; có thể dùng +84 thay cho số 0 đầu.';
  if (!['STORE_OWNER', 'SUPPLIER'].includes(role))
    errors.role = 'Chọn vai trò Chủ tạp hóa hoặc Chủ vựa.';
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(birth.valueOf()) ||
      dateOfBirth < '1900-01-01' || dateOfBirth > todayInVietnam(now) ||
      birth.toISOString().slice(0, 10) !== dateOfBirth)
    errors.dateOfBirth = 'Chọn ngày sinh có thật, từ 01/01/1900 đến hôm nay.';
  if (new TextEncoder().encode(password).length > 72)
    errors.password = 'Mật khẩu quá dài. Hãy dùng mật khẩu ngắn hơn.';
  else if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
      !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password))
    errors.password = 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.';
  if (!confirmPassword) errors.confirmPassword = 'Nhập lại mật khẩu của bạn.';
  else if (password !== confirmPassword) errors.confirmPassword = 'Mật khẩu nhập lại không khớp.';
  if (Object.keys(errors).length) return { errors, message: Object.values(errors)[0] };
  return { data: { name, username, email, phone, role, dateOfBirth: birth, password } };
}

module.exports = { validateRegistrationInput, normalizePhone, todayInVietnam };

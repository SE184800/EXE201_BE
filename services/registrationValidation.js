const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^[\p{L}\p{M} .'-]{2,100}$/u;

function normalizePhone(value) {
  const compact = String(value || '').replace(/[\s().-]/g, '');
  if (compact.startsWith('+84')) return `0${compact.slice(3)}`;
  if (compact.startsWith('84') && compact.length === 11) return `0${compact.slice(2)}`;
  return compact;
}

function validateRegistrationInput(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = normalizePhone(body.phone);
  const role = body.role;
  const dateOfBirth = typeof body.dateOfBirth === 'string' ? body.dateOfBirth.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';
  if (!NAME_PATTERN.test(name)) return { message: 'Họ và tên phải dài 2–100 ký tự.' };
  if (!USERNAME_PATTERN.test(username)) return { message: 'Username dùng 3–50 ký tự chữ không dấu, số, chấm, gạch dưới hoặc gạch ngang.' };
  if (!EMAIL_PATTERN.test(email) || email.length > 255) return { message: 'Email không hợp lệ.' };
  if (!/^0\d{9}$/.test(phone)) return { message: 'Số điện thoại phải có 10 số theo định dạng Việt Nam.' };
  if (!['STORE_OWNER', 'SUPPLIER'].includes(role)) return { message: 'Vai trò đăng ký không hợp lệ.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return { message: 'Ngày sinh không hợp lệ.' };
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const today = new Date();
  const oldest = new Date('1900-01-01T00:00:00.000Z');
  if (Number.isNaN(birth.valueOf()) || birth < oldest || birth > today || birth.toISOString().slice(0, 10) !== dateOfBirth) return { message: 'Ngày sinh không hợp lệ.' };
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return { message: 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.' };
  if (password !== confirmPassword) return { message: 'Mật khẩu nhập lại không khớp.' };
  return { data: { name, username, email, phone, role, dateOfBirth: birth, password } };
}

module.exports = { validateRegistrationInput, normalizePhone };

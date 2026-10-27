const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function getBirthDateRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type).value;
  const currentYear = Number(getPart('year'));
  const currentMonth = getPart('month');
  const currentDay = getPart('day');

  const maxYear = currentYear - 18;
  const minYear = currentYear - 100;

  function safeDate(year, month, day) {
    if (month === '02' && day === '29') {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      if (!isLeap) day = '28';
    }
    return `${year}-${month}-${day}`;
  }

  const maxDate = safeDate(maxYear, currentMonth, currentDay);
  const minDate = safeDate(minYear, currentMonth, currentDay);
  const [maxY, maxM, maxD] = maxDate.split('-');
  const [minY, minM, minD] = minDate.split('-');

  return {
    minDate,
    maxDate,
    minDateDisplay: `${minD}/${minM}/${minY}`,
    maxDateDisplay: `${maxD}/${maxM}/${maxY}`,
    minYear,
    maxYear,
  };
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

  // 1. Họ tên cho phép ký tự đặc biệt, độ dài 2-100 ký tự (không tính khoảng trắng)
  const nameWithoutSpaces = name.replace(/\s/g, '');
  if (nameWithoutSpaces.length < 2 || name.length > 100)
    errors.name = 'Họ tên cần 2–100 ký tự (không tính khoảng trắng).';

  // 2. Tên đăng nhập dùng 3-50 ký tự không tính khoảng trắng
  const usernameChars = username.replace(/\s/g, '');
  if (!USERNAME_PATTERN.test(username) || usernameChars.length < 3 || usernameChars.length > 50 || /\s/.test(username))
    errors.username = 'Tên đăng nhập cần 3–50 ký tự (không tính khoảng trắng).';

  const localPart = email.split('@')[0] || '';
  if (!EMAIL_PATTERN.test(email) || email.length > 255 || !/^[\x21-\x7E]+$/.test(email) || /\s/.test(email) || localPart.replace(/\s/g, '').length < 2)
    errors.email = 'Nhập email hợp lệ, không chứa khoảng trắng, tên email cần ít nhất 2 ký tự và tối đa 255 ký tự.';

  if (!/^0\d{9}$/.test(phone))
    errors.phone = 'Số điện thoại cần 10 số bắt đầu bằng 0; có thể dùng +84 thay cho số 0 đầu.';

  if (!['STORE_OWNER', 'SUPPLIER'].includes(role))
    errors.role = 'Chọn vai trò Chủ tạp hóa hoặc Chủ vựa.';

  // 3. Ngày tháng năm sinh trong khoảng 18 đến 100 tuổi tính từ thời điểm hiện tại
  const { minDate, maxDate, minDateDisplay, maxDateDisplay } = getBirthDateRange(now);
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(birth.valueOf()) ||
      dateOfBirth < minDate || dateOfBirth > maxDate ||
      birth.toISOString().slice(0, 10) !== dateOfBirth)
    errors.dateOfBirth = `Vui lòng chọn ngày sinh trong khoảng ${minDateDisplay} đến ${maxDateDisplay} (từ 18 đến 100 tuổi).`;

  const passwordWithoutSpaces = password.replace(/\s/g, '');
  if (new TextEncoder().encode(password).length > 72)
    errors.password = 'Mật khẩu quá dài. Hãy dùng mật khẩu ngắn hơn.';
  else if (password.trim() !== password)
    errors.password = 'Mật khẩu không được chứa khoảng trắng ở đầu hoặc cuối.';
  else if (passwordWithoutSpaces.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
      !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password))
    errors.password = 'Mật khẩu cần ít nhất 8 ký tự (không tính khoảng trắng), gồm chữ hoa, chữ thường, số và ký tự đặc biệt.';

  if (!confirmPassword) errors.confirmPassword = 'Nhập lại mật khẩu của bạn.';
  else if (password !== confirmPassword) errors.confirmPassword = 'Mật khẩu nhập lại không khớp.';

  if (input.acceptTerms !== undefined && !input.acceptTerms)
    errors.acceptTerms = 'Vui lòng đọc và đồng ý với Điều khoản và Dịch vụ để đăng ký tài khoản.';

  if (Object.keys(errors).length) return { errors, message: Object.values(errors)[0] };
  return { data: { name, username, email, phone, role, dateOfBirth: birth, password } };
}

module.exports = { validateRegistrationInput, normalizePhone, todayInVietnam, getBirthDateRange };

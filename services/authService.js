const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { accountAvailable, activeAccountWhere } = require('./platformPolicy');

const COOKIE_NAME = 'sg_restock_session';
const TOKEN_OPTIONS = {
  algorithm: 'HS256',
  issuer: 'sg-restock-api',
  audience: 'sg-restock-web',
};
// Vẫn so sánh mật khẩu khi username không tồn tại.
// Keep this precomputed so every Vercel cold start does not spend CPU hashing
// a value that is never stored or accepted.
const dummyHash = '$2b$12$5KSGNYoi5TEe5t3L6r196eZCZqygeQla2uRMSq5HuLvEGVxRvHMbq';
const TRANSIENT_DATABASE_CODES = new Set(['P1001', 'P1008', 'P1017', 'P2024']);

function isTransientDatabaseError(error) {
  const initializationFailure =
    error?.name === 'PrismaClientInitializationError' &&
    /can't reach database server|timed out|connection/i.test(error.message || '');
  return Boolean(
    error &&
      (initializationFailure ||
        TRANSIENT_DATABASE_CODES.has(error.code) ||
        ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(error.code)),
  );
}

async function withDatabaseRetry(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role.code,
  };
}

function cookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.production,
    sameSite: config.production ? 'none' : 'lax',
    path: '/',
  };
}

function createAuthService(prisma, config) {
  async function findRegistrationConflict(input) {
    // Use SQL's collation, including when another registration wins the race.
    const duplicates = await Promise.all(['username', 'email', 'phone'].map(async (field) => {
      const user = await prisma.user.findFirst({ where: { [field]: input[field] }, select: { id: true } });
      return user ? field : null;
    }));
    const messages = {
      username: 'Username đã được sử dụng.',
      email: 'Email đã được sử dụng.',
      phone: 'Số điện thoại đã được sử dụng.',
    };
    const errors = Object.fromEntries(duplicates.filter(Boolean).map((field) => [field, messages[field]]));
    if (!Object.keys(errors).length) return null;
    return Object.assign(new Error(Object.values(errors)[0]), { code: 'DUPLICATE_ACCOUNT_FIELD', errors });
  }

  async function register(input) {
    const duplicate = await findRegistrationConflict(input);
    if (duplicate) throw duplicate;
    const role = await prisma.role.findUnique({ where: { code: input.role } });
    if (!role) throw new Error('Vai trò không tồn tại.');
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const user = await prisma.user.create({
        data: {
          username: input.username, name: input.name, email: input.email,
          phone: input.phone, dateOfBirth: input.dateOfBirth, passwordHash, roleId: role.id,
        },
        include: { role: true },
      });
      return publicUser(user);
    } catch (error) {
      // SQL remains the final guard if two requests pass the pre-check together.
      if (error.code === 'P2002') {
        const conflict = await findRegistrationConflict(input);
        if (conflict) throw conflict;
        throw Object.assign(new Error('Thông tin tài khoản đã được sử dụng. Vui lòng kiểm tra lại.'), {
          code: 'DUPLICATE_ACCOUNT_FIELD', errors: {},
        });
      }
      throw error;
    }
  }
  async function login(username, password) {
    return withDatabaseRetry(async () => {
      const user = await prisma.user.findUnique({
        where: { username },
        include: { role: true },
      });
      const validPassword = await bcrypt.compare(
        password,
        user?.passwordHash || dummyHash,
      );
      if (!user || !user.isActive || !validPassword) return null;
      const session = await prisma.authSession.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          expiresAt: new Date(Date.now() + config.sessionSeconds * 1000),
        },
      });
      const token = jwt.sign({ sid: session.id }, config.jwtSecret, {
        ...TOKEN_OPTIONS,
        subject: String(user.id),
        expiresIn: config.sessionSeconds,
      });
      return { token, user: publicUser(user) };
    });
<<<<<<< Updated upstream
    const validPassword = await bcrypt.compare(
      password,
      user?.passwordHash || dummyHash,
    );
    if (!accountAvailable(user) || !validPassword) return null;
    const session = await prisma.$transaction(async tx => {
      const current = await tx.user.findFirst({ where: { id: user.id, passwordHash: user.passwordHash, ...activeAccountWhere() } });
      if (!current) return null;
      return tx.authSession.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        expiresAt: new Date(Date.now() + config.sessionSeconds * 1000),
      },
      });
    }, { isolationLevel: 'Serializable' });
    if (!session) return null;
    const token = jwt.sign({ sid: session.id }, config.jwtSecret, {
      ...TOKEN_OPTIONS,
      subject: String(user.id),
      expiresIn: config.sessionSeconds,
    });
    return { token, user: publicUser(user) };
=======
>>>>>>> Stashed changes
  }

  async function authenticate(token) {
    if (!token || typeof token !== 'string') return null;
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: TOKEN_OPTIONS.issuer,
        audience: TOKEN_OPTIONS.audience,
      });
    } catch {
      return null;
    }
    if (typeof payload !== 'object' || typeof payload.sid !== 'string')
      return null;
    const session = await withDatabaseRetry(() =>
      prisma.authSession.findUnique({
        where: { id: payload.sid },
        include: { user: { include: { role: true } } },
      }),
    );
    if (
      !session ||
      session.expiresAt <= new Date() ||
      String(session.userId) !== payload.sub ||
      !accountAvailable(session.user)
    )
      return null;
    // Luôn đọc role mới nhất từ SQL Server, không tin role do trình duyệt gửi.
    return { sessionId: session.id, user: publicUser(session.user) };
  }

  async function logout(sessionId) {
    await prisma.authSession.deleteMany({ where: { id: sessionId } });
  }
  return { login, register, authenticate, logout };
}
module.exports = { createAuthService, COOKIE_NAME, cookieOptions, publicUser };

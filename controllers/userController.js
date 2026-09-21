const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/roles');
const { publicUser } = require('../services/authService');

function createUserController(prisma) {
  return {
    async getUsers(req, res, next) {
      try {
        const users = await prisma.user.findMany({
          select: {
            id: true,
            username: true,
            name: true,
            isActive: true,
            role: true,
          },
          orderBy: { id: 'asc' },
          take: 100,
        });
        res.json({
          success: true,
          users: users.map((user) => ({
            ...publicUser(user),
            isActive: user.isActive,
          })),
        });
      } catch (error) {
        next(error);
      }
    },
    async createUser(req, res, next) {
      const { username, password, name, role } = req.body || {};
      if (
        typeof username !== 'string' ||
        !/^[a-zA-Z0-9._-]{3,50}$/.test(username.trim()) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.trim().length > 100 ||
        typeof password !== 'string' ||
        password.length < 8 ||
        Buffer.byteLength(password, 'utf8') > 72 ||
        !Object.values(ROLES).includes(role)
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message: 'Thông tin không hợp lệ. Mật khẩu cần ít nhất 8 ký tự.',
          });
      }
      try {
        const user = await prisma.user.create({
          data: {
            username: username.trim().toLowerCase(),
            name: name.trim(),
            passwordHash: await bcrypt.hash(password, 12),
            role: { connect: { code: role } },
          },
          include: { role: true },
        });
        res.status(201).json({ success: true, user: publicUser(user) });
      } catch (error) {
        if (error.code === 'P2002')
          return res
            .status(409)
            .json({ success: false, message: 'Username này đã được sử dụng.' });
        next(error);
      }
    },
  };
}
module.exports = { createUserController };

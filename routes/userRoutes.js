const express = require('express');
const { createUserController } = require('../controllers/userController');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');

function createUserRoutes(prisma, requireAuth) {
  const router = express.Router();
  const controller = createUserController(prisma);
  router.use(requireAuth, requireRole(ROLES.ADMIN));
  router.route('/').get(controller.getUsers).post(controller.createUser);
  return router;
}
module.exports = { createUserRoutes };

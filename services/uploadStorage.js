const multer = require('multer');
const { randomUUID } = require('node:crypto');
const prisma = require('../config/db');
const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const sqlEnabled = () => process.env.VERCEL === '1' || process.env.SQL_DOCUMENT_STORAGE === 'true';

function sqlUploadStorage(prefix) {
  const memory = multer.memoryStorage();
  return {
    _handleFile(req, file, callback) {
      memory._handleFile(req, file, (error, result) => {
        if (error) return callback(error);
        const filename = `${prefix}-${randomUUID()}${extensions[file.mimetype] || '.bin'}`;
        prisma.$executeRaw`INSERT INTO [dbo].[application_uploads] ([filename], [contentType], [content], [ownerId]) VALUES (${filename}, ${file.mimetype}, ${result.buffer}, ${req.auth.user.id})`
          .then(() => callback(null, { filename, size: result.size }))
          .catch(callback);
      });
    },
    _removeFile(req, file, callback) {
      prisma.$executeRaw`DELETE FROM [dbo].[application_uploads] WHERE [filename] = ${file.filename}`
        .then(() => callback(null)).catch(callback);
    },
  };
}

function serveSqlUpload(db) {
  return async (req, res, next) => {
    try {
      const rows = await db.$queryRaw`SELECT [contentType], [content] FROM [dbo].[application_uploads] WHERE [filename] = ${req.params.filename}`;
      if (!rows.length) return next();
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.type(rows[0].contentType).send(Buffer.from(rows[0].content));
    } catch (error) { next(error); }
  };
}
module.exports = { sqlEnabled, sqlUploadStorage, serveSqlUpload };

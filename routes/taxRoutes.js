const express = require('express');
const { lookupTaxCode, validateTaxCodeChecksum } = require('../services/taxService');

function createTaxRoutes() {
  const router = express.Router();

  // GET /api/tax/lookup/:taxCode
  router.get('/lookup/:taxCode', async (req, res, next) => {
    try {
      const { taxCode } = req.params;
      const result = await lookupTaxCode(taxCode);
      res.json(result);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ message: err.message });
      }
      next(err);
    }
  });

  // POST /api/tax/validate
  router.post('/validate', (req, res) => {
    const { taxCode } = req.body || {};
    const check = validateTaxCodeChecksum(taxCode);
    if (!check.valid) {
      return res.status(400).json({ valid: false, message: check.error });
    }
    return res.json(check);
  });

  return router;
}

module.exports = { createTaxRoutes };

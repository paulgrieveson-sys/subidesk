const express = require('express');
const router = express.Router();

// POST /api/remind
// Checks Xero for overdue invoices and sends payment reminder emails via Gmail
router.post('/', async (req, res) => {
  res.json({ message: 'remind route — not yet implemented' });
});

module.exports = router;

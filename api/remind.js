const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getStore } = require('../lib/tokenStore');

function buildMessage(name) {
  return `Hi ${name}, hope you've had a good week. Just a reminder to send your invoice to invoicingjdcm@gmail.com by Monday so you can get paid on Friday. Thanks, JDCM Ltd`;
}

async function sendWhatsApp(name, whatsapp, message) {
  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('GHL_WEBHOOK_URL is not set.');

  await axios.post(webhookUrl, {
    name,
    phone:   whatsapp,
    message,
  });
}

// POST /api/remind
// Also accepts GET for browser testing
async function handleRemind(req, res) {
  const profiles = await getStore('SUBBIE_PROFILES');

  if (!profiles || Object.keys(profiles).length === 0) {
    return res.json({ sent: 0, skipped: 0, errors: 0, results: [], reason: 'No subbie profiles found.' });
  }

  const active = Object.values(profiles).filter(s => s.active !== false);
  const results = [];

  for (const subbie of active) {
    if (!subbie.whatsapp) {
      console.log(`[remind] ${subbie.name}: no WhatsApp number — skipping.`);
      results.push({ name: subbie.name, status: 'skipped', reason: 'no_whatsapp' });
      continue;
    }

    const message = buildMessage(subbie.name);

    try {
      await sendWhatsApp(subbie.name, subbie.whatsapp, message);
      console.log(`[remind] ${subbie.name} (${subbie.whatsapp}): message sent.`);
      results.push({ name: subbie.name, whatsapp: subbie.whatsapp, status: 'sent', message });
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error(`[remind] ${subbie.name}: send failed —`, detail);
      results.push({ name: subbie.name, whatsapp: subbie.whatsapp, status: 'error', error: err.message, detail });
    }
  }

  const summary = {
    sent:    results.filter(r => r.status === 'sent').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors:  results.filter(r => r.status === 'error').length,
    results,
  };

  console.log(`[remind] Done — sent: ${summary.sent}, skipped: ${summary.skipped}, errors: ${summary.errors}`);
  res.json(summary);
}

router.get('/',  handleRemind);
router.post('/', handleRemind);

module.exports = router;

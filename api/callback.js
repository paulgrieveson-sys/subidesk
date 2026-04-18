const express = require('express');
const router = express.Router();
const axios = require('axios');
const { google } = require('googleapis');
const { setTokens } = require('../lib/tokenStore');

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

// ---------------------------------------------------------------------------
// Xero token exchange
// ---------------------------------------------------------------------------
async function handleXeroCallback(code, res) {
  const credentials = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString('base64');

  const response = await axios.post(
    XERO_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.XERO_REDIRECT_URI,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const tokens = {
    access_token:  response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in:    response.data.expires_in,
    token_type:    response.data.token_type,
    scope:         response.data.scope,
    obtained_at:   Date.now(),
  };

  await setTokens('XERO_TOKENS', tokens);
  console.log('[callback] Xero OAuth complete.');

  res.json({ success: true, provider: 'xero', message: 'Xero connected. Tokens stored.', tokens });
}

// ---------------------------------------------------------------------------
// Gmail token exchange
// ---------------------------------------------------------------------------
async function handleGmailCallback(code, res) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  const { tokens } = await oauth2.getToken(code);

  const gmailTokens = {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date:   tokens.expiry_date,
    token_type:    tokens.token_type,
    scope:         tokens.scope,
    obtained_at:   Date.now(),
  };

  await setTokens('GMAIL_TOKENS', gmailTokens);
  console.log('[callback] Gmail OAuth complete.');

  res.json({ success: true, provider: 'gmail', message: 'Gmail connected. Tokens stored.', tokens: gmailTokens });
}

// ---------------------------------------------------------------------------
// GET /api/callback?state=xero|gmail&code=...
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).json({ error: `OAuth authorisation denied: ${error}` });
  }

  if (!code) {
    return res.status(400).json({ error: 'No authorisation code received.' });
  }

  if (!state) {
    return res.status(400).json({ error: 'Missing state parameter — cannot identify provider.' });
  }

  try {
    if (state === 'xero')  return await handleXeroCallback(code, res);
    if (state === 'gmail') return await handleGmailCallback(code, res);

    res.status(400).json({ error: `Unknown state "${state}". Expected "xero" or "gmail".` });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[callback] Token exchange failed for provider "${state}":`, detail);
    res.status(500).json({ error: 'Token exchange failed.', provider: state, detail });
  }
});

module.exports = router;

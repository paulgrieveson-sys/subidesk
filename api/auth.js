const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// ---------------------------------------------------------------------------
// Xero
// ---------------------------------------------------------------------------
const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';

const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
].join(' ');

function xeroAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state: 'xero',
  });
  return `${XERO_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

function gmailAuthUrl() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state: 'gmail',
  });
}

// ---------------------------------------------------------------------------
// GET /api/auth?provider=xero  (default)
// GET /api/auth?provider=gmail
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const provider = (req.query.provider || 'xero').toLowerCase();

  if (provider === 'gmail') {
    return res.redirect(gmailAuthUrl());
  }

  if (provider === 'xero') {
    return res.redirect(xeroAuthUrl());
  }

  res.status(400).json({ error: `Unknown provider "${provider}". Use "xero" or "gmail".` });
});

module.exports = router;

const axios = require('axios');

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const EXPIRY_BUFFER_MS = 60 * 1000;

function readTokens() {
  const raw = process.env.XERO_TOKENS;
  if (!raw) {
    throw new Error('XERO_TOKENS environment variable is not set. Complete Xero OAuth and paste the logged token JSON into Vercel.');
  }
  return JSON.parse(raw);
}

// On Vercel we cannot write back to process.env — log the new tokens so they
// can be pasted into the Vercel environment variable dashboard.
function writeTokens(tokens) {
  process.env.XERO_TOKENS = JSON.stringify(tokens);
  console.log('[xeroToken] XERO_TOKENS updated. Copy the value below into your Vercel environment variables:');
  console.log('XERO_TOKENS=' + JSON.stringify(tokens));
}

function isExpired(tokens) {
  const expiresAt = tokens.obtained_at + tokens.expires_in * 1000;
  return Date.now() >= expiresAt - EXPIRY_BUFFER_MS;
}

async function refreshTokens(tokens) {
  const credentials = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString('base64');

  const response = await axios.post(
    XERO_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const refreshed = {
    access_token:  response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in:    response.data.expires_in,
    token_type:    response.data.token_type,
    scope:         response.data.scope,
    obtained_at:   Date.now(),
  };

  writeTokens(refreshed);
  console.log('[xeroToken] Access token refreshed successfully.');
  return refreshed;
}

async function getValidAccessToken() {
  let tokens = readTokens();

  if (isExpired(tokens)) {
    console.log('[xeroToken] Access token expired — refreshing...');
    tokens = await refreshTokens(tokens);
  }

  return tokens.access_token;
}

module.exports = { getValidAccessToken };

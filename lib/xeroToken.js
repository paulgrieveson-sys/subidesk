const axios = require('axios');
const { getTokens, setTokens } = require('./tokenStore');

const XERO_TOKEN_URL   = 'https://identity.xero.com/connect/token';
const EXPIRY_BUFFER_MS = 60 * 1000;

async function readTokens() {
  const tokens = await getTokens('XERO_TOKENS');
  if (!tokens) throw new Error('No Xero tokens found. Complete Xero OAuth at /api/auth?provider=xero first.');
  return tokens;
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
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
    {
      headers: {
        Authorization:  `Basic ${credentials}`,
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

  await setTokens('XERO_TOKENS', refreshed);
  console.log('[xeroToken] Access token refreshed and persisted.');
  return refreshed;
}

async function getValidAccessToken() {
  let tokens = await readTokens();

  if (isExpired(tokens)) {
    console.log('[xeroToken] Access token expired — refreshing...');
    tokens = await refreshTokens(tokens);
  }

  return tokens.access_token;
}

module.exports = { getValidAccessToken };

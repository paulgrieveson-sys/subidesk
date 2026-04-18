const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN_PATH = path.resolve(process.env.TOKEN_STORE_PATH || './tokens.json');
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

// Tokens expire slightly before their stated expiry to avoid clock-edge failures
const EXPIRY_BUFFER_MS = 60 * 1000;

function readTokens() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`tokens.json not found at ${TOKEN_PATH}. Run /api/auth first.`);
  }
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

function writeTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
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
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in: response.data.expires_in,
    token_type: response.data.token_type,
    scope: response.data.scope,
    obtained_at: Date.now(),
  };

  writeTokens(refreshed);
  console.log('[xeroToken] Access token refreshed successfully.');
  return refreshed;
}

// Returns a valid access token, refreshing automatically if expired
async function getValidAccessToken() {
  let tokens = readTokens();

  if (isExpired(tokens)) {
    console.log('[xeroToken] Access token expired — refreshing...');
    tokens = await refreshTokens(tokens);
  }

  return tokens.access_token;
}

module.exports = { getValidAccessToken };

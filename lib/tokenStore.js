// Persistent token store — Vercel KV with fallback to process.env.
// KV is used when KV_REST_API_URL is present (set automatically by the
// Vercel KV / Upstash Redis integration). Without it, tokens are read
// from environment variables only (no persistence across invocations).

let kv;
function getKv() {
  if (!kv && process.env.KV_REST_API_URL) {
    kv = require('@vercel/kv').kv;
  }
  return kv;
}

async function getTokens(key) {
  const store = getKv();
  if (store) {
    const value = await store.get(key);
    if (value) return typeof value === 'string' ? JSON.parse(value) : value;
  }

  // Fallback: read from environment variable of the same name
  const raw = process.env[key];
  if (!raw) return null;
  return JSON.parse(raw);
}

async function setTokens(key, tokens) {
  const store = getKv();
  if (store) {
    await store.set(key, JSON.stringify(tokens));
    console.log(`[tokenStore] ${key} saved to Vercel KV.`);
    return;
  }

  // No KV — update in-process env and log for manual copy
  process.env[key] = JSON.stringify(tokens);
  console.log(`[tokenStore] KV not configured. Copy this into your Vercel environment variables:`);
  console.log(`${key}=${JSON.stringify(tokens)}`);
}

module.exports = { getTokens, setTokens };

// Persistent token store — Upstash Redis with fallback to process.env.
// Redis is used when KV_REST_API_URL is present (injected automatically
// by the Vercel KV / Upstash integration). Without it, tokens are read
// from environment variables only (no persistence across invocations).

const { Redis } = require('@upstash/redis');

let redis;
function getRedis() {
  if (!redis && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = Redis.fromEnv();
  }
  return redis;
}

async function getTokens(key) {
  const store = getRedis();
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
  const store = getRedis();
  if (store) {
    await store.set(key, JSON.stringify(tokens));
    console.log(`[tokenStore] ${key} saved to Upstash Redis.`);
    return;
  }

  // No Redis — update in-process env and log for manual copy
  process.env[key] = JSON.stringify(tokens);
  console.log(`[tokenStore] Redis not configured. Copy this into your Vercel environment variables:`);
  console.log(`${key}=${JSON.stringify(tokens)}`);
}

module.exports = { getTokens, setTokens };

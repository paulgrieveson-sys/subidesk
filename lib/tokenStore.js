// Persistent token store — Upstash Redis with fallback to process.env.
// Redis is used when UPSTASH_REDIS_REST_URL is present (set automatically
// by the Vercel + Upstash integration). Without it, tokens are read from
// environment variables only (no persistence across invocations).

const { Redis } = require('@upstash/redis');

let redis;
function getRedis() {
  if (!redis && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
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

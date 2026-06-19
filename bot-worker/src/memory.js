/**
 * WorkerGram Bot - 内存/缓存层
 * 使用 Map 实现，兼容 Cloudflare Workers
 */

import config from './config.js';

const store = new Map();

function getCount() {
  return store.size;
}

function set(key, value, ttlMs) {
  const existed = store.has(key);
  if (!existed && store.size >= config.MEMORY_MAX_ENTRIES) evict();
  store.set(key, { value, expiresAt: Date.now() + (ttlMs || 600000) });
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function del(key) {
  return store.delete(key);
}

function has(key) {
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return false;
  }
  return true;
}

function setCooldown(key, ttlMs) {
  set('cd:' + key, true, ttlMs || 30000);
}

function isOnCooldown(key) {
  return has('cd:' + key);
}

function setToken(key, value) {
  set('tok:' + key, value, 600000);
}

function getToken(key) {
  const val = get('tok:' + key);
  if (val !== undefined) del('tok:' + key);
  return val;
}

function setLeaderboard(data) {
  set('cache:leaderboard', data, 600000);
}

function getLeaderboard() {
  return get('cache:leaderboard');
}

function evict() {
  const now = Date.now();
  let oldest = Infinity;
  let oldestKey = null;
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
      return;
    }
    if (entry.expiresAt < oldest) {
      oldest = entry.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    store.delete(oldestKey);
  }
}

function cleanup() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

function getStats() {
  return { totalEntries: store.size, maxEntries: config.MEMORY_MAX_ENTRIES };
}

export default {
  init: () => console.log('[Memory] Initialized'),
  set, get, del, has,
  setCooldown, isOnCooldown,
  setToken, getToken,
  setLeaderboard, getLeaderboard,
  cleanup, getStats, getCount,
};

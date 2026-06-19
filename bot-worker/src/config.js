/**
 * WorkerGram Bot - 配置
 * 从 Cloudflare Workers 环境变量读取配置
 */

export default {
  get BOT_TOKEN() {
    return typeof globalThis !== 'undefined' && globalThis.__env__?.BOT_TOKEN || '';
  },

  get ADMIN_CHAT_ID() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.ADMIN_CHAT_ID || '0';
    return parseInt(val, 10);
  },

  get ADMIN_SECRET() {
    return typeof globalThis !== 'undefined' && globalThis.__env__?.ADMIN_SECRET || '';
  },

  get SIGNIN_POINTS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.SIGNIN_POINTS || '10';
    return parseInt(val, 10);
  },

  get STREAK_BONUS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.STREAK_BONUS || '20';
    return parseInt(val, 10);
  },

  get STREAK_DAYS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.STREAK_DAYS || '7';
    return parseInt(val, 10);
  },

  get QUOTA_COST() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.QUOTA_COST || '50';
    return parseInt(val, 10);
  },

  get SHORTCODE_LEN() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.SHORTCODE_LEN || '6';
    return parseInt(val, 10);
  },

  get MEMORY_MAX_ENTRIES() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.MEMORY_MAX_ENTRIES || '5000';
    return parseInt(val, 10);
  },

  get SIGNIN_COOLDOWN_MS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.SIGNIN_COOLDOWN_MS || '60000';
    return parseInt(val, 10);
  },

  get WRITE_INTERVAL_MS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.WRITE_INTERVAL_MS || '5000';
    return parseInt(val, 10);
  },

  get ALLOW_ALL_GROUPS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.ALLOW_ALL_GROUPS || 'true';
    return val === 'true';
  },

  get ENABLED_GROUPS() {
    const val = typeof globalThis !== 'undefined' && globalThis.__env__?.ENABLED_GROUPS || '';
    return val.split(',').map(id => id.trim()).filter(Boolean);
  },

  get DOWNLOAD_WORKER_URL() {
    return typeof globalThis !== 'undefined' && globalThis.__env__?.DOWNLOAD_WORKER_URL || '';
  },

  get DOWNLOAD_WORKER_SECRET() {
    return typeof globalThis !== 'undefined' && globalThis.__env__?.DOWNLOAD_WORKER_SECRET || '';
  },
};

// 设置环境变量（在 fetch 中调用）
export function setEnv(env) {
  if (typeof globalThis !== 'undefined') {
    globalThis.__env__ = env;
  }
}

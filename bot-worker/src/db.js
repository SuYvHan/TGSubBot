/**
 * WorkerGram Bot - 数据库操作层
 * 使用 Cloudflare D1（异步 API）
 */

import config from './config.js';

const writeTimestamps = new Map();
const WRITE_TS_MAX = 10000;

function cleanWriteTimestamps() {
  if (writeTimestamps.size < WRITE_TS_MAX) return;
  const now = Date.now();
  const cutoff = now - config.WRITE_INTERVAL_MS;
  for (const [key, ts] of writeTimestamps) {
    if (ts < cutoff) writeTimestamps.delete(key);
  }
}

async function ensureTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT DEFAULT '',
      chat_id INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      total_earned INTEGER DEFAULT 0,
      last_signin_date TEXT DEFAULT '',
      signin_streak INTEGER DEFAULT 0,
      link_quota INTEGER DEFAULT 0,
      role TEXT DEFAULT 'user',
      is_banned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS short_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE,
      type TEXT CHECK(type IN ('url','file')),
      long_url TEXT DEFAULT '',
      file_id TEXT DEFAULT '',
      file_name TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      owner_id INTEGER REFERENCES users(user_id),
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed_at TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC);
    CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(chat_id);
    CREATE INDEX IF NOT EXISTS idx_short_links_code ON short_links(short_code);
    CREATE INDEX IF NOT EXISTS idx_short_links_accessed ON short_links(last_accessed_at);
  `);

  console.log('[DB] Tables ensured');
}

function canWrite(userId) {
  const now = Date.now();
  const last = writeTimestamps.get(userId) || 0;
  if (now - last < config.WRITE_INTERVAL_MS) return false;
  writeTimestamps.set(userId, now);
  cleanWriteTimestamps();
  return true;
}

async function ensureUser(db, userId, username, chatId) {
  const row = await db.prepare('SELECT user_id FROM users WHERE user_id = ?').bind(userId).first();

  if (!row) {
    const isAdmin = userId === config.ADMIN_CHAT_ID ? 'admin' : 'user';
    await db.prepare(
      'INSERT INTO users (user_id, username, chat_id, role) VALUES (?, ?, ?, ?)'
    ).bind(userId, username || '', chatId || 0, isAdmin).run();
  } else if (username) {
    await db.prepare(
      'UPDATE users SET username = ?, chat_id = ? WHERE user_id = ?'
    ).bind(username, chatId || 0, userId).run();
  }

  // 确保管理员权限
  if (userId === config.ADMIN_CHAT_ID) {
    const user = await getUser(db, userId);
    if (user && user.role !== 'admin') {
      await db.prepare("UPDATE users SET role = 'admin' WHERE user_id = ?").bind(userId).run();
    }
  }
}

async function getUser(db, userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first();
}

async function updateUserPoints(db, userId, delta) {
  if (!canWrite(userId)) return null;

  if (delta > 0) {
    await db.prepare(
      "UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = datetime('now') WHERE user_id = ?"
    ).bind(delta, delta, userId).run();
  } else {
    await db.prepare(
      "UPDATE users SET points = points + ?, updated_at = datetime('now') WHERE user_id = ?"
    ).bind(delta, userId).run();
  }

  return getUser(db, userId);
}

async function updateSignin(db, userId, date, streak, points) {
  if (!canWrite(userId)) return null;

  await db.prepare(
    "UPDATE users SET points = points + ?, total_earned = total_earned + ?, last_signin_date = ?, signin_streak = ?, updated_at = datetime('now') WHERE user_id = ?"
  ).bind(points, points, date, streak, userId).run();

  return getUser(db, userId);
}

async function updateQuota(db, userId, delta) {
  if (!canWrite(userId)) return null;

  await db.prepare(
    "UPDATE users SET link_quota = link_quota + ?, updated_at = datetime('now') WHERE user_id = ?"
  ).bind(delta, userId).run();

  return getUser(db, userId);
}

async function generateShortCode(db) {
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const LEN = config.SHORTCODE_LEN;

  for (let i = 0; i < 10; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(LEN));
    let code = '';
    for (let j = 0; j < LEN; j++) {
      code += CHARS[bytes[j] % CHARS.length];
    }

    const existing = await db.prepare('SELECT id FROM short_links WHERE short_code = ?').bind(code).first();
    if (!existing) return code;
  }

  return null;
}

async function createShortLink(db, shortCode, type, longUrl, fileId, fileName, fileSize, ownerId) {
  if (!canWrite(ownerId)) return null;

  try {
    await db.prepare(
      'INSERT INTO short_links (short_code, type, long_url, file_id, file_name, file_size, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(shortCode, type, longUrl || '', fileId || '', fileName || '', fileSize || 0, ownerId).run();

    return db.prepare('SELECT * FROM short_links WHERE short_code = ?').bind(shortCode).first();
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return null;
    throw e;
  }
}

async function getShortLink(db, shortCode) {
  const row = await db.prepare('SELECT * FROM short_links WHERE short_code = ?').bind(shortCode).first();
  if (row) {
    await db.prepare("UPDATE short_links SET last_accessed_at = datetime('now') WHERE short_code = ?").bind(shortCode).run();
  }
  return row;
}

async function getTopUsers(db, limit = 10) {
  const { results } = await db.prepare(
    'SELECT user_id, username, points, total_earned, signin_streak FROM users WHERE is_banned = 0 ORDER BY points DESC LIMIT ?'
  ).bind(limit).all();
  return results || [];
}

async function getUserCount(db) {
  const result = await db.prepare('SELECT COUNT(*) as count FROM users').first();
  return result?.count || 0;
}

async function getTodaySigninCount(db) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.prepare('SELECT COUNT(*) as count FROM users WHERE last_signin_date = ?').bind(today).first();
  return result?.count || 0;
}

async function getShortLinkCount(db) {
  const result = await db.prepare('SELECT COUNT(*) as count FROM short_links').first();
  return result?.count || 0;
}

async function setAdmin(db, userId) {
  await db.prepare("UPDATE users SET role = 'admin' WHERE user_id = ?").bind(userId).run();
}

async function banUser(db, userId) {
  await db.prepare('UPDATE users SET is_banned = 1 WHERE user_id = ?').bind(userId).run();
}

async function unbanUser(db, userId) {
  await db.prepare('UPDATE users SET is_banned = 0 WHERE user_id = ?').bind(userId).run();
}

async function getAllUsers(db, limit = 20, offset = 0) {
  const { results } = await db.prepare(
    'SELECT user_id, username, points, total_earned, link_quota, role, is_banned, last_signin_date, signin_streak FROM users ORDER BY points DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();
  return results || [];
}

async function getRecentLinks(db, limit = 50) {
  const { results } = await db.prepare(
    'SELECT sl.*, u.username as owner_name FROM short_links sl LEFT JOIN users u ON sl.owner_id = u.user_id ORDER BY sl.id DESC LIMIT ?'
  ).bind(limit).all();
  return results || [];
}

async function deleteShortLink(db, id) {
  const result = await db.prepare('DELETE FROM short_links WHERE id = ?').bind(id).run();
  return result.meta?.changes || 0;
}

async function addPoints(db, userId, amount) {
  if (!canWrite(userId)) return null;

  if (amount > 0) {
    await db.prepare(
      "UPDATE users SET points = points + ?, total_earned = total_earned + ?, updated_at = datetime('now') WHERE user_id = ?"
    ).bind(amount, amount, userId).run();
  } else {
    await db.prepare(
      "UPDATE users SET points = points + ?, updated_at = datetime('now') WHERE user_id = ?"
    ).bind(amount, userId).run();
  }

  return getUser(db, userId);
}

export default {
  ensureTable,
  canWrite,
  ensureUser,
  getUser,
  updateUserPoints,
  updateSignin,
  updateQuota,
  generateShortCode,
  createShortLink,
  getShortLink,
  getTopUsers,
  getUserCount,
  getTodaySigninCount,
  getShortLinkCount,
  setAdmin,
  banUser,
  unbanUser,
  getAllUsers,
  getRecentLinks,
  deleteShortLink,
  addPoints,
};

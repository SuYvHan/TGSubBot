/**
 * WorkerGram Download Worker
 * 文件下载代理服务 - 部署在 Cloudflare Workers
 *
 * 功能：
 * - /d/{code} - 下载文件（代理 Telegram 文件）
 * - /api/create - 创建下载链接（Bot 调用）
 * - /api/lookup - 查询链接信息
 * - /api/stats - 统计信息
 * - /api/cleanup - 清理旧链接
 * - 定时清理过期链接
 */

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LEN = 6;
const MAX_ATTEMPTS = 10;

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CHARS[bytes[i] % CHARS.length];
  }
  return code;
}

function isValidCode(code) {
  return /^[a-zA-Z0-9]{6}$/.test(code);
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  });
}

async function generateUniqueCode(db) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = generateCode();
    const existing = await db.prepare('SELECT id FROM links WHERE short_code = ?').bind(code).first();
    if (!existing) return code;
  }
  return null;
}

async function ensureTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE NOT NULL,
      file_id TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      owner_id INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed_at TEXT DEFAULT '',
      access_count INTEGER DEFAULT 0
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_links_code ON links(short_code)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_links_accessed ON links(last_accessed_at)');
}

async function createLink(db, fileId, fileName, fileSize, ownerId) {
  const code = await generateUniqueCode(db);
  if (!code) return null;

  try {
    await db.prepare(
      'INSERT INTO links (short_code, file_id, file_name, file_size, owner_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(code, fileId, fileName || '', fileSize || 0, ownerId || 0).run();

    const link = await db.prepare('SELECT * FROM links WHERE short_code = ?').bind(code).first();
    return link;
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return null;
    throw e;
  }
}

async function getLink(db, code) {
  const link = await db.prepare('SELECT * FROM links WHERE short_code = ?').bind(code).first();
  if (link) {
    await db.prepare(
      "UPDATE links SET last_accessed_at = datetime('now'), access_count = access_count + 1 WHERE short_code = ?"
    ).bind(code).run();
  }
  return link;
}

async function cleanupOldLinks(db, cleanupDays) {
  const days = cleanupDays || 30;

  const result = await db.prepare(`
    DELETE FROM links
    WHERE last_accessed_at != ''
      AND last_accessed_at < datetime('now', '-' || ? || ' days')
  `).bind(days).run();

  const neverAccessed = await db.prepare(`
    DELETE FROM links
    WHERE last_accessed_at = ''
      AND created_at < datetime('now', '-' || ? || ' days')
  `).bind(days).run();

  const total = (result.meta?.changes || 0) + (neverAccessed.meta?.changes || 0);
  return total;
}

async function proxyFileDownload(env, fileId, fileName) {
  const fileInfoUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;

  const fileInfoRes = await fetch(fileInfoUrl);
  const fileInfoData = await fileInfoRes.json();

  if (!fileInfoData.ok || !fileInfoData.result || !fileInfoData.result.file_path) {
    return new Response('File not found or expired', { status: 404 });
  }

  const filePath = fileInfoData.result.file_path;
  const fileSize = fileInfoData.result.file_size || 0;

  if (env.MAX_FILE_SIZE && fileSize > parseInt(env.MAX_FILE_SIZE)) {
    return new Response('File too large', { status: 413 });
  }

  const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;

  const fileRes = await fetch(fileUrl, {
    headers: { 'Accept-Encoding': 'identity' },
  });

  if (!fileRes.ok) {
    return new Response('Upstream download failed', { status: 502 });
  }

  const encodedName = encodeURIComponent(fileName || 'download');
  const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
  const contentLength = fileRes.headers.get('content-length') || '';

  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };

  if (contentLength) {
    headers['Content-Length'] = contentLength;
  }

  return new Response(fileRes.body, {
    status: 200,
    headers,
  });
}

function verifyAuth(request, secret) {
  if (!secret) return false;
  const auth = request.headers.get('Authorization') || '';
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // 确保表存在
  await ensureTable(env.DB);

  // 下载文件路由
  if (path.startsWith('/d/')) {
    const code = path.slice(3);
    if (!isValidCode(code)) {
      return new Response('Invalid code', { status: 400 });
    }

    const link = await getLink(env.DB, code);
    if (!link) {
      return new Response('Not Found', { status: 404 });
    }

    return proxyFileDownload(env, link.file_id, link.file_name);
  }

  // 创建链接 API（Bot 调用）
  if (path === '/api/create' && request.method === 'POST') {
    if (!verifyAuth(request, env.ADMIN_SECRET)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid json' }, 400);
    }

    const { file_id, file_name, file_size, owner_id } = body;
    if (!file_id) {
      return jsonResponse({ error: 'file_id required' }, 400);
    }

    const link = await createLink(env.DB, file_id, file_name || '', file_size || 0, owner_id || 0);
    if (!link) {
      return jsonResponse({ error: 'failed to create link' }, 500);
    }

    const host = request.headers.get('host') || url.host;
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const downloadUrl = `${proto}://${host}/d/${link.short_code}`;

    return jsonResponse({
      ok: true,
      code: link.short_code,
      url: downloadUrl,
      file_name: link.file_name,
    });
  }

  // 查询链接 API
  if (path === '/api/lookup' && request.method === 'GET') {
    if (!verifyAuth(request, env.ADMIN_SECRET)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const code = url.searchParams.get('code');
    if (!code || !isValidCode(code)) {
      return jsonResponse({ error: 'invalid code' }, 400);
    }

    const link = await getLink(env.DB, code);
    if (!link) {
      return jsonResponse({ error: 'not found' }, 404);
    }

    return jsonResponse({
      ok: true,
      code: link.short_code,
      file_id: link.file_id,
      file_name: link.file_name,
      file_size: link.file_size,
      owner_id: link.owner_id,
      access_count: link.access_count,
      created_at: link.created_at,
      last_accessed_at: link.last_accessed_at,
    });
  }

  // 统计信息 API
  if (path === '/api/stats' && request.method === 'GET') {
    if (!verifyAuth(request, env.ADMIN_SECRET)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const total = await env.DB.prepare('SELECT COUNT(*) as cnt FROM links').first();
    const totalAccess = await env.DB.prepare('SELECT SUM(access_count) as cnt FROM links').first();

    return jsonResponse({
      ok: true,
      total_links: total?.cnt || 0,
      total_accesses: totalAccess?.cnt || 0,
      cleanup_days: parseInt(env.CLEANUP_DAYS) || 30,
    });
  }

  // 清理旧链接 API
  if (path === '/api/cleanup' && request.method === 'POST') {
    if (!verifyAuth(request, env.ADMIN_SECRET)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const cleaned = await cleanupOldLinks(env.DB, parseInt(env.CLEANUP_DAYS));
    return jsonResponse({ ok: true, cleaned });
  }

  // 健康检查
  if (path === '/' || path === '/health') {
    return jsonResponse({
      ok: true,
      service: 'workergram-download',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    });
  }

  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      console.error('[DownloadWorker] Error:', e.message, e.stack);
      return jsonResponse({ error: e.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    try {
      await ensureTable(env.DB);
      const cleaned = await cleanupOldLinks(env.DB, parseInt(env.CLEANUP_DAYS));
      console.log(`[Cleanup] Removed ${cleaned} old links`);
    } catch (e) {
      console.error('[Cleanup] Error:', e.message);
    }
  },
};

/**
 * WorkerGram Bot - 短链接命令
 * 支持 URL 短链接和文件短链接
 */

import db from '../db.js';
import memory from '../memory.js';
import config from '../config.js';

const FILE_SHORTEN_COST = 50;

function extractFileInfoFromMessage(msg) {
  if (!msg) return null;

  if (msg.document) {
    return {
      type: 'document',
      fileId: msg.document.file_id,
      fileName: msg.document.file_name || 'unknown',
      fileSize: msg.document.file_size || 0,
    };
  }

  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    return {
      type: 'photo',
      fileId: largest.file_id,
      fileName: 'photo.jpg',
      fileSize: largest.file_size || 0,
    };
  }

  if (msg.video) {
    return {
      type: 'video',
      fileId: msg.video.file_id,
      fileName: msg.video.file_name || 'video.mp4',
      fileSize: msg.video.file_size || 0,
    };
  }

  if (msg.audio) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name || 'audio.mp3',
      fileSize: msg.audio.file_size || 0,
    };
  }

  if (msg.animation) {
    return {
      type: 'animation',
      fileId: msg.animation.file_id,
      fileName: msg.animation.file_name || 'animation.mp4',
      fileSize: msg.animation.file_size || 0,
    };
  }

  return null;
}

async function createWorkerLink(fileId, fileName, fileSize, ownerId, api) {
  const workerUrl = config.DOWNLOAD_WORKER_URL;
  const workerSecret = config.DOWNLOAD_WORKER_SECRET;

  if (!workerUrl) {
    console.error('[Shorten] DOWNLOAD_WORKER_URL not configured');
    return null;
  }

  const apiUrl = `${workerUrl.replace(/\/+$/, '')}/api/create`;

  for (let retry = 3; retry > 0; retry--) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({
          file_id: fileId,
          file_name: fileName,
          file_size: fileSize,
          owner_id: ownerId,
        }),
      });

      const data = await response.json();

      if (data.ok && data.url) {
        console.log(`[Shorten] Worker created link: ${data.code} -> ${data.url}`);
        return { code: data.code, url: data.url };
      }

      console.warn(`[Shorten] Worker API error: ${JSON.stringify(data)}, retries left: ${retry - 1}`);
    } catch (e) {
      console.warn(`[Shorten] Worker API request failed: ${e.message}, retries left: ${retry - 1}`);
    }

    if (retry > 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return null;
}

async function handleUrlShorten(ctx, api) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const user = await db.getUser(api.DB, userId);
  if (user.is_banned) {
    return api.sendMessage(chatId, '你已被封禁。', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  if (user.link_quota < 1) {
    return api.sendMessage(chatId, '配额不足！使用 /buy_quota <数量> 兑换（50积分/次）', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  const text = (ctx.message.text || '').trim();
  const args = text.split(/\s+/).slice(1);
  const url = args[0];

  if (!url) {
    return api.sendMessage(chatId, '用法：/shorten <URL>\n例如：/shorten https://example.com', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  try {
    new URL(url);
  } catch {
    return api.sendMessage(chatId, 'URL 格式无效，请输入完整的 URL（含 http:// 或 https://）', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  if (url.length > 500) {
    return api.sendMessage(chatId, 'URL 过长，不能超过 500 字符', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  const code = await db.generateShortCode(api.DB);
  if (!code) {
    return api.sendMessage(chatId, '生成短码失败，请稍后重试', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  const link = await db.createShortLink(api.DB, code, 'url', url, '', '', 0, userId);
  if (!link) {
    return api.sendMessage(chatId, '创建失败，请稍后重试', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  await db.updateQuota(api.DB, userId, -1);

  console.log(`[Shorten] User ${userId} created URL short link: ${code} -> ${url}`);

  await api.sendMessage(
    chatId,
    `✅ 短链接创建成功！\n` +
    `短码：\`${code}\`\n` +
    `原链接：${url}\n` +
    `剩余配额：${user.link_quota - 1} 次`,
    {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'Markdown',
    }
  );
}

async function handleFileShorten(ctx, fileInfo, api) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const user = await db.getUser(api.DB, userId);
  if (user.is_banned) {
    return api.sendMessage(chatId, '你已被封禁', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  if (user.points < FILE_SHORTEN_COST) {
    return api.sendMessage(
      chatId,
      `积分不足！需要 ${FILE_SHORTEN_COST} 积分，当前 ${user.points} 积分`,
      { reply_to_message_id: ctx.message.message_id }
    );
  }

  const cooldownKey = `gen_link:${userId}`;
  if (memory.isOnCooldown(cooldownKey)) {
    return api.sendMessage(chatId, '操作过于频繁，请稍后再试', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  memory.setCooldown(cooldownKey, 5000);

  console.log(`[Shorten] User ${userId} requesting short link for ${fileInfo.type}`);

  // 调用 Download Worker 创建链接
  const workerResult = await createWorkerLink(fileInfo.fileId, fileInfo.fileName, fileInfo.fileSize, userId, api);
  if (!workerResult) {
    return api.sendMessage(chatId, '❌ 短链接生成失败，请稍后重试', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  // 扣除积分
  const pointsResult = await db.updateUserPoints(api.DB, userId, -FILE_SHORTEN_COST);
  if (!pointsResult) {
    return api.sendMessage(chatId, '❌ 积分扣除失败，请稍后重试', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  console.log(
    `[Shorten] User ${userId} created file short link: ${workerResult.code}, ` +
    `deducted ${FILE_SHORTEN_COST} points, remaining: ${pointsResult.points}`
  );

  await api.sendMessage(
    chatId,
    `✅ 文件短链接创建成功！\n` +
    `短码：\`${workerResult.code}\`\n` +
    `下载链接：${workerResult.url}\n` +
    `文件名：${fileInfo.fileName}\n` +
    `大小：${(fileInfo.fileSize / 1024).toFixed(1)} KB\n` +
    `消耗积分：${FILE_SHORTEN_COST}\n` +
    `剩余积分：${pointsResult.points}`,
    {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'Markdown',
    }
  );
}

export async function handleShortenCommand(ctx, api) {
  await handleUrlShorten(ctx, api);
}

export async function handleFileMessage(ctx, api) {
  const fileInfo = extractFileInfoFromMessage(ctx.message);
  if (!fileInfo) return false;

  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const user = await db.getUser(api.DB, userId);
  if (user.is_banned) return true;

  // 存储文件信息到内存
  const cacheKey = `finfo:${chatId}:${ctx.message.message_id}`;
  memory.set(cacheKey, fileInfo, 1800000); // 30分钟

  await api.sendMessage(
    chatId,
    `📎 检测到${fileInfo.type === 'document' ? '文件' : fileInfo.type === 'photo' ? '图片' : fileInfo.type === 'video' ? '视频' : '媒体'}：${fileInfo.fileName}\n` +
    `大小：${(fileInfo.fileSize / 1024).toFixed(1)} KB\n\n` +
    `回复此消息并发送"生成链接"或 /gen_link 来生成短链接（消耗 ${FILE_SHORTEN_COST} 积分）\n` +
    `当前积分：${user.points}`,
    { reply_to_message_id: ctx.message.message_id }
  );

  return true;
}

export async function handleGenerateLink(ctx, api) {
  const chatId = ctx.message.chat.id;
  const replyTo = ctx.message.reply_to_message;

  if (!replyTo) {
    return api.sendMessage(chatId, '请先发送文件，然后回复该文件消息并使用此命令');
  }

  let fileInfo = extractFileInfoFromMessage(replyTo);

  // 如果无法从回复消息中提取，尝试从缓存获取
  if (!fileInfo) {
    const cacheKey = `finfo:${replyTo.chat.id}:${replyTo.message_id}`;
    fileInfo = memory.get(cacheKey);
  }

  if (!fileInfo) {
    return api.sendMessage(chatId, '❌ 文件信息已过期，请重新发送文件');
  }

  await handleFileShorten({ message: ctx.message }, fileInfo, api);
}

export { isSigninText } from './signin.js';

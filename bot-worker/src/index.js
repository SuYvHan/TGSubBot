/**
 * WorkerGram Bot - 主入口
 * Cloudflare Workers 版本（使用 Webhook 模式）
 *
 * 功能：
 * - /start, /help - 帮助信息
 * - /signin 或发送"签到" - 每日签到
 * - /shorten <URL> - URL 短链接
 * - 发送文件 - 生成文件短链接
 * - /sub <内容> - 订阅/节点解析
 * - /buy_quota <数量> - 兑换配额
 * - /top - 积分排行榜
 * - /resolve <短码> - 解析短链接
 * - /admin - 管理员命令
 */

import { setEnv } from './config.js';
import db from './db.js';
import memory from './memory.js';
import config from './config.js';

// 命令模块
import { handleSignin, isSigninText } from './commands/signin.js';
import { handleBuyQuota } from './commands/quota.js';
import { handleLeaderboard } from './commands/leaderboard.js';
import { handleResolve } from './commands/resolve.js';
import { handleAdmin, isAdmin } from './commands/admin.js';
import { handleShortenCommand, handleFileMessage, handleGenerateLink } from './commands/shorten.js';
import { handleSubCommand, handleDirectText as handleSubDirectText } from './commands/subscription.js';

// 初始化数据库表
async function initDB(dbInstance) {
  await db.ensureTable(dbInstance);
  console.log('[Bot] Database initialized');
}

// 处理 Webhook 更新
async function handleUpdate(update, api) {
  try {
    const message = update.message;

    if (!message) {
      // 处理其他更新类型（如 callback_query）
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, api);
      }
      return;
    }

    const chatId = message.chat.id;
    const userId = message.from?.id;
    const text = message.text || '';
    const username = message.from?.username || message.from?.first_name || '';

    // 确保用户存在
    if (userId) {
      await db.ensureUser(api.DB, userId, username, chatId);
    }

    // 处理命令
    if (text.startsWith('/')) {
      await handleCommand(message, api);
      return;
    }

    // 处理非命令文本消息
    await handleTextMessage(message, api);

  } catch (e) {
    console.error('[Bot] Error handling update:', e.message, e.stack);
  }
}

// 处理命令
async function handleCommand(message, api) {
  const text = (message.text || '').trim();
  const args = text.split(/\s+/);
  const command = args[0].toLowerCase().replace('@' + (message.from?.username || ''), '');
  const ctx = { message };

  switch (command) {
    case '/start':
      await handleStart(ctx, api);
      break;

    case '/help':
      await handleHelp(ctx, api);
      break;

    case '/signin':
    case '/打卡':
      await handleSignin(ctx, api);
      break;

    case '/shorten':
      await handleShortenCommand(ctx, api);
      break;

    case '/sub':
      await handleSubCommand(ctx, api);
      break;

    case '/buy_quota':
      await handleBuyQuota(ctx, api);
      break;

    case '/top':
      await handleLeaderboard(ctx, api);
      break;

    case '/resolve':
      await handleResolve(ctx, api);
      break;

    case '/gen_link':
      await handleGenerateLink(ctx, api);
      break;

    case '/admin':
      await handleAdmin(ctx, api);
      break;

    default:
      // 未识别的命令，忽略
      break;
  }
}

// 处理文本消息（非命令）
async function handleTextMessage(message, api) {
  const ctx = { message };
  const text = (message.text || '').trim();

  // 签到关键词检测
  if (isSigninText(text)) {
    await handleSignin(ctx, api);
    return;
  }

  // 订阅解析自动检测
  const handled = await handleSubDirectText(ctx, api);
  if (handled) return;

  // 文件消息检测（photo, document, video, audio 等）
  const fileHandled = await handleFileMessage(ctx, api);
  if (fileHandled) return;
}

// 处理回调查询（按钮点击等）
async function handleCallbackQuery(callbackQuery, api) {
  // 可以在这里处理 inline keyboard 回调
  console.log('[Bot] Received callback query:', callbackQuery.data);
}

// /start 命令
async function handleStart(ctx, api) {
  const chatId = ctx.message.chat.id;
  const firstName = ctx.message.from?.first_name || '用户';

  await api.sendMessage(
    chatId,
    `👋 欢迎使用 WorkerGram Bot！\n\n` +
    `📌 快捷操作：\n` +
    `发送「签到」或「打卡」— 每日签到\n` +
    `发送订阅链接/YAML/节点 — 自动解析\n` +
    `发送6位短码 — 解析短链接\n\n` +
    `📋 命令列表：\n` +
    `/signin — 每日签到领积分\n` +
    `/buy_quota <数量> — 兑换短链接配额\n` +
    `/shorten <URL> — 创建URL短链接\n` +
    `/sub <订阅链接> — 解析订阅/节点\n` +
    `/top — 积分排行榜`
  );
}

// /help 命令
async function handleHelp(ctx, api) {
  const chatId = ctx.message.chat.id;

  await api.sendMessage(
    chatId,
    `📖 帮助\n\n` +
    `🔑 签到系统：\n` +
    `/signin 或发送「签到」「打卡」— +10积分，连续7天额外+20\n\n` +
    `🔗 短链接系统：\n` +
    `/buy_quota <数量> — 50积分兑换1次配额\n` +
    `/shorten <URL> — 消耗1配额创建URL短链接\n` +
    `发送文件/图片/视频 — 使用 /gen_link 生成文件短链接（50积分/次）\n` +
    `发送6位短码 — 解析并获取原链接或文件\n\n` +
    `🌐 订阅解析：\n` +
    `/sub <订阅链接> — 解析Clash/VMess/VLESS/Trojan/SS节点\n` +
    `直接发送以下内容也会自动识别解析：\n` +
    `  • 订阅链接（URL）\n` +
    `  • 节点 URI（支持多行粘贴）\n` +
    `  • Clash YAML 文本内容\n` +
    `  • Base64 编码的订阅文本\n\n` +
    `🏆 排行：\n` +
    `/top — 查看积分排行榜\n\n` +
    `⚙️ 管理员：\n` +
    `/stats — 系统统计\n` +
    `/addpoints <ID> <数量> — 加减积分`
  );
}

// 主请求处理器
export default {
  async fetch(request, env, ctx) {
    // 设置环境变量
    setEnv(env);

    const url = new URL(request.url);

    // 初始化数据库
    await initDB(env.DB);

    // 清理内存缓存
    memory.cleanup();

    // 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'workergram-bot',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 设置 Webhook（仅限 POST 请求）
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

        // 创建 API 对象（封装 Telegram Bot API 调用）
        const api = createTelegramAPI(config.BOT_TOKEN, env);

        // 处理更新
        await handleUpdate(update, api);

        return new Response('ok', { status: 200 });
      } catch (e) {
        console.error('[Webhook] Error:', e.message, e.stack);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 获取 Webhook 信息
    if (url.pathname === '/webhook/info') {
      const webhookInfo = await fetch(
        `https://api.telegram.org/bot${config.BOT_TOKEN}/getWebhookInfo`
      ).then(r => r.json());

      return new Response(JSON.stringify(webhookInfo), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 设置 Webhook（需要认证）
    if (url.pathname === '/webhook/set' && request.method === 'POST') {
      const auth = request.headers.get('Authorization') || '';
      const urlParam = new URL(request.url).searchParams.get('url');

      if (auth !== `Bearer ${config.ADMIN_SECRET}` && !url.searchParams.has('secret')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }

      const webhookUrl = urlParam || `https://${url.host}/webhook`;

      const result = await fetch(
        `https://api.telegram.org/bot${config.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&allowed_updates=["message,callback_query"]`
      ).then(r => r.json());

      console.log(`[Webhook] Set to: ${webhookUrl}`, result);

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// 创建 Telegram API 封装
function createTelegramAPI(botToken, env) {
  const baseUrl = `https://api.telegram.org/bot${botToken}`;

  return {
    DB: env.DB,

    async sendMessage(chatId, text, options = {}) {
      const body = {
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || undefined,
        reply_to_message_id: options.reply_to_message_id || undefined,
        ...options,
      };

      // 移除 undefined 值
      Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);

      const response = await fetch(`${baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(`sendMessage failed: ${result.description}`);
      }

      return result.result;
    },

    async editMessageText(chatId, messageId, text, options = {}) {
      const body = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: options.parse_mode || undefined,
        ...options,
      };

      Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);

      const response = await fetch(`${baseUrl}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(`editMessageText failed: ${result.description}`);
      }

      return result.result;
    },

    async deleteMessage(chatId, messageId) {
      const response = await fetch(`${baseUrl}/deleteMessage?chat_id=${chatId}&message_id=${messageId}`);
      return response.json();
    },

    async answerCallbackQuery(callbackQueryId, options = {}) {
      const params = new URLSearchParams({ callback_query_id: callbackQueryId });
      if (options.text) params.set('text', options.text);
      if (options.show_alert) params.set('show_alert', 'true');

      const response = await fetch(`${baseUrl}/answerCallbackQuery?${params}`);
      return response.json();
    },

    async forwardMessage(chatId, fromChatId, messageId, options = {}) {
      const params = new URLSearchParams({
        chat_id: String(chatId),
        from_chat_id: String(fromChatId),
        message_id: String(messageId),
      });

      if (options.message_thread_id) params.set('message_thread_id', options.message_thread_id);

      const response = await fetch(`${baseUrl}/forwardMessage?${params}`, { method: 'POST' });
      const result = await response.json();

      if (!result.ok) {
        throw new Error(`forwardMessage failed: ${result.description}`);
      }

      return result.result;
    },

    async getFile(fileId) {
      const response = await fetch(`${baseUrl}/getFile?file_id=${fileId}`);
      const result = await response.json();

      if (!result.ok) {
        throw new Error(`getFile failed: ${result.description}`);
      }

      return result.result;
    },

    async getMe() {
      const response = await fetch(`${baseUrl}/getMe`);
      return response.json();
    },

    async setMyCommands(commands, options = {}) {
      const body = { commands };
      if (options.scope) body.scope = options.scope;

      const response = await fetch(`${baseUrl}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return response.json();
    },
  };
}

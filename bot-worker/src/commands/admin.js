/**
 * WorkerGram Bot - 管理员命令
 */

import db from '../db.js';
import config from '../config.js';

function isAdmin(userId) {
  return userId === config.ADMIN_CHAT_ID;
}

async function handleAdmin(ctx, api) {
  const userId = ctx.message.from.id;
  const chatId = ctx.message.chat.id;

  if (!isAdmin(userId)) {
    return; // 非管理员不响应
  }

  const text = (ctx.message.text || '').trim();
  const args = text.split(/\s+/);
  const command = args[1];

  switch (command) {
    case 'stats':
      await handleStats(ctx, api);
      break;
    case 'users':
      await handleUserList(ctx, api);
      break;
    case 'ban':
      await handleBan(ctx, api, args);
      break;
    case 'unban':
      await handleUnban(ctx, api, args);
      break;
    case 'addpoints':
      await handleAddPoints(ctx, api, args);
      break;
    default:
      await api.sendMessage(
        chatId,
        `⚙️ *管理员命令*\n\n` +
        `/admin stats - 系统统计\n` +
        `/admin users - 用户列表\n` +
        `/admin ban <用户ID> - 封禁用户\n` +
        `/admin unban <用户ID> - 解封用户\n` +
        `/admin addpoints <用户ID> <数量> - 加减积分`,
        { parse_mode: 'Markdown' }
      );
  }
}

async function handleStats(ctx, api) {
  const chatId = ctx.message.chat.id;

  const userCount = await db.getUserCount(api.DB);
  const todaySignins = await db.getTodaySigninCount(api.DB);
  const linkCount = await db.getShortLinkCount(api.DB);

  const statsText =
    `📊 *系统统计*\n\n` +
    `👥 总用户数：${userCount}\n` +
    `✅ 今日签到：${todaySignins}\n` +
    `🔗 短链接数：${linkCount}\n` +
    `⏰ 时间：${new Date().toLocaleString('zh-CN')}`;

  await api.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
}

async function handleUserList(ctx, api) {
  const chatId = ctx.message.chat.id;

  const users = await db.getAllUsers(api.DB, 10, 0);

  if (users.length === 0) {
    return api.sendMessage(chatId, '暂无用户数据');
  }

  let text = '👥 *用户列表（前10）*\n\n';
  for (const user of users) {
    const role = user.role === 'admin' ? '👑' : '👤';
    const status = user.is_banned ? '🚫' : '✅';
    text += `${role} ${user.username || user.user_id} | 积分:${user.points} | 配额:${user.link_quota} ${status}\n`;
  }

  await api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

async function handleBan(ctx, api, args) {
  const chatId = ctx.message.chat.id;
  const targetId = parseInt(args[2], 10);

  if (!targetId) {
    return api.sendMessage(chatId, '用法：/admin ban <用户ID>');
  }

  await db.banUser(api.DB, targetId);
  await api.sendMessage(chatId, `✅ 已封禁用户 ${targetId}`);
}

async function handleUnban(ctx, api, args) {
  const chatId = ctx.message.chat.id;
  const targetId = parseInt(args[2], 10);

  if (!targetId) {
    return api.sendMessage(chatId, '用法：/admin unban <用户ID>');
  }

  await db.unbanUser(api.DB, targetId);
  await api.sendMessage(chatId, `✅ 已解封用户 ${targetId}`);
}

async function handleAddPoints(ctx, api, args) {
  const chatId = ctx.message.chat.id;
  const targetId = parseInt(args[2], 10);
  const amount = parseInt(args[3], 10);

  if (!targetId || !amount) {
    return api.sendMessage(chatId, '用法：/admin addpoints <用户ID> <数量（正数加，负数扣）>');
  }

  const updated = await db.addPoints(api.DB, targetId, amount);
  if (!updated) {
    return api.sendMessage(chatId, '❌ 操作失败或过于频繁');
  }

  await api.sendMessage(
    chatId,
    `✅ 操作成功！\n用户：${targetId}\n变动：${amount > 0 ? '+' : ''}${amount} 积分\n当前积分：${updated.points}`
  );
}

export { handleAdmin, isAdmin };

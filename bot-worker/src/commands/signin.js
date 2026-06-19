/**
 * WorkerGram Bot - 签到命令
 */

import db from '../db.js';
import memory from '../memory.js';
import config from '../config.js';

const SIGNIN_KEYWORDS = ['签到', '打卡', '签', '打卡签到', '每日签到', '签到打卡', 'check in', 'checkin', 'sign in', 'signin'];

function isSigninText(text) {
  const t = text.trim().toLowerCase();
  return SIGNIN_KEYWORDS.some(kw => t === kw || t === `/${kw}`);
}

async function handleSignin(ctx, api) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const user = await db.getUser(api.DB, userId);
  if (user.is_banned) {
    return api.sendMessage(chatId, '你已被封禁，无法签到。', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  if (memory.isOnCooldown(`signin:${userId}`)) {
    return api.sendMessage(chatId, '操作太频繁，请稍后再试。', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  if (user.last_signin_date === today) {
    return api.sendMessage(chatId, `今天已经签到过了！当前积分：${user.points}`, {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  let streak = user.signin_streak || 0;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (user.last_signin_date === yesterday) {
    streak++;
  } else {
    streak = 1;
  }

  let points = config.SIGNIN_POINTS;
  let bonusMsg = '';
  if (streak > 0 && streak % config.STREAK_DAYS === 0) {
    points += config.STREAK_BONUS;
    bonusMsg = `\n🎉 连续签到 ${streak} 天！额外奖励 ${config.STREAK_BONUS} 积分！`;
  }

  const updated = await db.updateSignin(api.DB, userId, today, streak, points);
  if (!updated) {
    return api.sendMessage(chatId, '操作过于频繁，请稍后再试。', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  memory.setCooldown(`signin:${userId}`, config.SIGNIN_COOLDOWN_MS);

  console.log(`[Signin] User ${userId} signed in, streak=${streak}, points=+${points}`);

  await api.sendMessage(
    chatId,
    `✅ 签到成功！+${points} 积分\n` +
    `连续签到：${streak} 天\n` +
    `当前积分：${updated.points}${bonusMsg}`,
    { reply_to_message_id: ctx.message.message_id }
  );
}

export async function register(bot) {
  // 注册命令处理器（在消息处理中使用）
}

export { handleSignin, isSigninText };

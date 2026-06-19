/**
 * WorkerGram Bot - 配额兑换命令
 */

import db from '../db.js';
import config from '../config.js';

async function handleBuyQuota(ctx, api) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const user = await db.getUser(api.DB, userId);
  if (user.is_banned) {
    return api.sendMessage(chatId, '你已被封禁。');
  }

  const text = ctx.message.text || '';
  const args = text.split(/\s+/).slice(1);
  const amount = parseInt(args[0], 10);

  if (!amount || amount < 1) {
    return api.sendMessage(chatId, '用法：/buy_quota <数量>\n50 积分兑换 1 次短链接生成机会');
  }

  const cost = amount * config.QUOTA_COST;
  if (user.points < cost) {
    return api.sendMessage(chatId, `积分不足！需要 ${cost} 积分，当前 ${user.points} 积分。`);
  }

  const updatedPoints = await db.updateUserPoints(api.DB, userId, -cost);
  if (!updatedPoints) {
    return api.sendMessage(chatId, '操作过于频繁，请稍后再试。');
  }

  const updatedQuota = await db.updateQuota(api.DB, userId, amount);
  if (!updatedQuota) {
    // 回滚积分
    await db.updateUserPoints(api.DB, userId, cost);
    return api.sendMessage(chatId, '操作失败，请稍后重试。');
  }

  console.log(`[Quota] User ${userId} bought ${amount} quota, cost ${cost}`);

  await api.sendMessage(
    chatId,
    `✅ 兑换成功！\n` +
    `消耗积分：${cost}\n` +
    `获得配额：${amount} 次\n` +
    `当前积分：${updatedQuota.points}\n` +
    `当前配额：${updatedQuota.link_quota} 次`
  );
}

export { handleBuyQuota };

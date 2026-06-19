/**
 * WorkerGram Bot - 排行榜命令
 */

import db from '../db.js';
import memory from '../memory.js';

async function handleLeaderboard(ctx, api) {
  const chatId = ctx.message.chat.id;

  // 检查缓存
  const cached = memory.getLeaderboard();
  if (cached) {
    return api.sendMessage(chatId, cached, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'Markdown',
    });
  }

  const users = await db.getTopUsers(api.DB, 10);

  if (users.length === 0) {
    return api.sendMessage(chatId, '暂无排行数据', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  let text = '🏆 *积分排行榜 TOP 10*\n\n';

  users.forEach((user, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    const username = user.username || `用户${user.user_id}`;
    text += `${medal} ${username} - *${user.points}* 积分（连续 ${user.signin_streak || 0} 天）\n`;
  });

  // 缓存结果
  memory.setLeaderboard(text);

  await api.sendMessage(chatId, text, {
    reply_to_message_id: ctx.message.message_id,
    parse_mode: 'Markdown',
  });
}

export { handleLeaderboard };

/**
 * WorkerGram Bot - 解析短链接命令
 */

import db from '../db.js';

async function handleResolve(ctx, api) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const text = (ctx.message.text || '').trim();
  const args = text.split(/\s+/).slice(1);
  const code = args[0];

  if (!code || code.length !== 6) {
    return api.sendMessage(chatId, '用法：/resolve <6位短码>\n例如：/resolve AbCdEf', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  const link = await db.getShortLink(api.DB, code);
  if (!link) {
    return api.sendMessage(chatId, '❌ 未找到该短码对应的链接', {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  let resultText = `🔗 *短链接信息*\n\n`;
  resultText += `*短码：*\`${code}\`\n`;
  resultText += `*类型：*${link.type === 'url' ? 'URL 链接' : '文件'}\n`;

  if (link.type === 'url') {
    resultText += `*原链接：*${link.long_url}\n`;
  } else {
    resultText += `*文件名：*${link.file_name}\n`;
    resultText += `*文件大小：*${(link.file_size / 1024).toFixed(1)} KB\n`;
  }

  resultText += `\n*创建时间：*${link.created_at}`;
  if (link.last_accessed_at) {
    resultText += `\n*最后访问：*${link.last_accessed_at}`;
  }

  await api.sendMessage(chatId, resultText, {
    reply_to_message_id: ctx.message.message_id,
    parse_mode: 'Markdown',
  });
}

export { handleResolve };

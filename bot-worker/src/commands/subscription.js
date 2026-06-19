/**
 * WorkerGram Bot - 订阅解析命令
 * 支持多种订阅格式和协议
 */

import db from '../db.js';
import memory from '../memory.js';
import {
  parseSubscription,
  parseProxyLine,
  extractUrls,
  formatSubscriptionInfo,
  isLikelyYaml,
  isLikelyBase64,
} from '../utils/parser.js';

function isLikelyYaml(text) {
  const yamlIndicators = [
    'proxies:', 'proxy-groups:', 'mixed-port:', 'socks-port:',
    'allow-lan:', 'mode:', 'log-level:', 'external-controller:',
    'port:', 'rules:'
  ];

  const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  let matchCount = 0;

  for (const line of lines.slice(0, 20)) {
    for (const indicator of yamlIndicators) {
      if (line.trim().startsWith(indicator) || line.includes(indicator)) {
        matchCount++;
        break;
      }
    }
  }

  if (matchCount >= 1) return true;

  const hasProxyPattern = /vmess:\/\/|vless:\/\/|trojan:\/\/|ss:\/\/|ssr:\/\/|hysteria\d*:\/\//i.test(text);
  return /^\s*-\s*(name:|{.*})/m.test(text) || /^\s*\w+:\s*.+/m.test(text)
    ? hasProxyPattern && text.length > 50 : false;
}

function isLikelyBase64(text) {
  const cleaned = text.replace(/\s/g, '');
  if (cleaned.length < 50) return false;

  if (/^[\w+/=]+$/.test(cleaned) && cleaned.length > 100) {
    const lineCount = text.split('\n').filter(l => l.trim()).length;
    if (lineCount <= 5 && cleaned.length > 200) return true;
  }

  const base64Lines = text.split('\n').filter(l => {
    const t = l.trim();
    return t.length > 30 && /^[\w+/=]+$/.test(t);
  });

  if (base64Lines.length >= 3) return false;

  const hasProxyHint = /vmess|vless|trojan|ss:|hysteria|tuic|snell|wireguard/i.test(text.substring(0, 200));
  return hasProxyHint && cleaned.length > 150 && !isLikelyYaml(text);
}

async function fetchSubscription(url) {
  const uaList = [
    { ua: 'ClashMeta/1.15.0', timeout: 10000 },
    { ua: 'Clash/v1.18.0', timeout: 15000 },
  ];

  for (const { ua, timeout } of uaList) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': ua, 'Accept': '*/*', 'Connection': 'keep-alive' },
        signal: AbortSignal.timeout(timeout),
      });

      if (response.ok) return response;
    } catch (e) {
      console.warn(`[Sub] Fetch with UA ${ua} failed:`, e.message);
    }
  }

  throw new Error('订阅获取失败，请检查链接是否有效或网络是否通畅');
}

async function handleSubCommand(ctx, api) {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || ctx.message.from.first_name || '';
  const chatId = ctx.message.chat.id;

  await db.ensureUser(api.DB, userId, username, chatId);

  const text = (ctx.message.text || '').trim();
  const args = text.split(/\s+/).slice(1);
  const input = args.join(' ').trim();

  if (!input) {
    await api.sendMessage(
      chatId,
      `🌐 订阅解析\n\n` +
      `用法：\n` +
      `/sub <订阅链接> — 获取并解析订阅\n` +
      `/sub <vmess://...> — 直接解析单条节点\n\n` +
      `支持格式：\n` +
      `• Clash YAML / Base64 编码订阅\n` +
      `• vmess:// / vless:// / trojan://\n` +
      `• ss:// / ssr:// / hysteria2://\n\n` +
      `💡 直接发送链接或节点URI也会自动解析`,
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  await handleSubInput(ctx, input, api);
}

async function handleDirectText(ctx, api) {
  const text = (ctx.message.text || '').trim();
  let handled = false;

  // 检测 YAML 内容
  if (!handled && isLikelyYaml(text)) {
    console.log(`[Sub] Detected YAML content (${text.length} chars)`);
    await handleDirectContent(ctx, text, 'YAML 配置', api);
    handled = true;
  }

  // 检测 Base64 订阅
  if (!handled && isLikelyBase64(text)) {
    console.log(`[Sub] Detected Base64 encoded subscription (${text.length} chars)`);
    await handleDirectContent(ctx, text, 'Base64 订阅', api);
    handled = true;
  }

  // 检测代理节点 URI（多行）
  if (!handled) {
    const lines = text.split('\n');
    const proxyNodes = [];
    for (const line of lines) {
      const node = parseProxyLine(line.trim());
      if (node) proxyNodes.push(node);
    }

    if (proxyNodes.length > 0) {
      console.log(`[Sub] Detected ${proxyNodes.length} proxy nodes in message`);
      const result = formatSubscriptionInfo(proxyNodes, null, null, { configName: '手动输入节点' });
      await api.sendMessage(chatId => chatId, result.text, {
        reply_to_message_id: ctx.message.message_id,
      });
      handled = true;
    }
  }

  // 检测 URL
  if (!handled && (text.includes('http://') || text.includes('https://'))) {
    const urls = extractUrls(text);
    if (urls.length > 0) {
      console.log(`[Sub] Found ${urls.length} URL(s): ${urls.join(', ')}`);
      for (const url of urls) {
        await handleSubInput(ctx, url, api);
      }
      handled = true;
    }
  }

  return handled;
}

async function handleSubInput(ctx, input, api) {
  if (!input || !input.trim()) return;

  const chatId = ctx.message.chat.id;

  try {
    // 发送处理中消息
    const processingMsg = await api.sendMessage(chatId, '⏳ 正在获取订阅内容...');

    if (input.startsWith('http://') || input.startsWith('https://')) {
      console.log(`[Sub] Fetching subscription from: ${input}`);

      const response = await fetchSubscription(input);

      let responseText = await response.text();
      responseText = responseText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

      // 解析用户信息
      const subUserInfoHeader = response.headers.get('subscription-userinfo');
      let userInfo = null;
      if (subUserInfoHeader) {
        const parts = subUserInfoHeader.split(';');
        userInfo = {};
        for (const part of parts) {
          const eqIdx = part.indexOf('=');
          if (eqIdx < 0) continue;
          const key = part.substring(0, eqIdx).trim();
          const value = parseInt(part.substring(eqIdx + 1).trim(), 10);
          if (key && !isNaN(value)) userInfo[key] = value;
        }
      }

      // 解析配置名
      const contentDisp = response.headers.get('content-disposition');
      let configName = null;
      if (contentDisp) {
        const match = contentDisp.match(/filename="?([^"]+)"?/i);
        if (match) {
          configName = match[1].replace(/\.(yaml|yml|txt)$/i, '');
        }
      }

      console.log(`[Sub] Response received, length=${responseText.length}`);

      const nodes = parseSubscription(responseText);

      if (nodes.length === 0) {
        await api.editMessageText(chatId, processingMsg.message_id,
          '❌ 无法从该订阅中解析出节点\n\n' +
          '可能原因：\n' +
          '• 链接不是有效的订阅地址\n' +
          '• 链接已过期或失效\n' +
          '• 返回格式不支持'
        );
        return;
      }

      console.log(`[Sub] Successfully parsed ${nodes.length} nodes`);

      const extraInfo = {};
      if (configName) extraInfo.configName = configName;

      const result = formatSubscriptionInfo(nodes, userInfo, input, Object.keys(extraInfo).length > 0 ? extraInfo : null);

      // 分段发送（Telegram 限制 4096 字符）
      if (result.text.length > 4000) {
        const chunks = splitMessage(result.text, 4000);
        for (let i = 0; i < chunks.length; i++) {
          const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : '';
          await api.sendMessage(chatId, prefix + chunks[i]);
        }
      } else {
        await api.editMessageText(chatId, processingMsg.message_id, result.text);
      }
    } else {
      // 直接输入的节点 URI
      const lines = input.split('\n');
      const nodes = [];
      for (const line of lines) {
        const node = parseProxyLine(line.trim());
        if (node) nodes.push(node);
      }

      if (nodes.length === 0) {
        await api.sendMessage(chatId, '❌ 无法解析该内容，请确认格式是否正确。', {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }

      console.log(`[Sub] Parsed ${nodes.length} nodes from direct input`);
      const result = formatSubscriptionInfo(nodes, null, null, { configName: '手动输入节点' });

      await api.sendMessage(chatId, result.text, {
        reply_to_message_id: ctx.message.message_id,
      });
    }
  } catch (e) {
    console.error(`[Sub] Parse error: ${e.message}`, e.stack);
    await api.sendMessage(chatId, `❌ 解析失败：${e.message}`, {
      reply_to_message_id: ctx.message.message_id,
    });
  }
}

async function handleDirectContent(ctx, content, configName, api) {
  const MAX_CONTENT_LENGTH = 2 * 1024 * 1024;

  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.substring(0, MAX_CONTENT_LENGTH) + '\n# ... 内容已截断';
  }

  try {
    const startTime = Date.now();
    const nodes = parseSubscription(content);
    const parseTime = Date.now() - startTime;

    console.log(`[Sub] Parsed ${nodes.length} nodes in ${parseTime}ms`);

    if (nodes.length === 0) {
      await api.sendMessage(
        ctx.message.chat.id,
        '❌ 无法从该内容中解析出节点\n\n' +
        '可能原因：\n' +
        '• 内容不是有效的订阅格式\n' +
        '• 节点已过期或损坏\n' +
        '• 不支持的格式',
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    const result = formatSubscriptionInfo(nodes, null, null, { configName: configName || '未知来源' });
    const chatId = ctx.message.chat.id;

    if (result.text.length > 4000) {
      const chunks = splitMessage(result.text, 4000);
      for (let i = 0; i < chunks.length; i++) {
        const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n` : '';
        await api.sendMessage(chatId, prefix + chunks[i]);
      }
    } else {
      await api.sendMessage(chatId, result.text, {
        reply_to_message_id: ctx.message.message_id,
      });
    }
  } catch (e) {
    console.error(`[Sub] Direct content parse error: ${e.message}`);
    await api.sendMessage(ctx.message.chat.id, `❌ 解析失败：${e.message}`, {
      reply_to_message_id: ctx.message.message_id,
    });
  }
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export {
  handleSubCommand,
  handleDirectText,
};

/**
 * WorkerGram Bot - 订阅/代理解析工具
 * 精简版，支持主要协议格式
 */

// Base64 编解码
function base64Decode(str) {
  try {
    // 处理 URL-safe Base64
    const cleaned = str.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(cleaned);
    return decodeURIComponent(escape(decoded));
  } catch {
    return str;
  }
}

function base64Encode(str) {
  try {
    const utf8 = unescape(encodeURIComponent(str));
    return btoa(utf8);
  } catch {
    return str;
  }
}

// 格式化字节
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

// 生成进度条
function generateProgressBar(percent) {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent.toFixed(1)}%`;
}

// 解析 VMess URI
function parseVMess(uri) {
  try {
    const jsonStr = base64Decode(uri.replace('vmess://', ''));
    const config = JSON.parse(jsonStr);

    if (!config.add || !config.ps) return null;

    let port = config.port || 443;
    if (Array.isArray(port)) port = port[0];

    return {
      type: 'vmess',
      name: config.ps,
      server: config.add,
      port: port,
      uuid: config.id,
      alterId: config.aid || 0,
      security: config.scy || 'auto',
      network: config.net || 'tcp',
      tls: config.tls === 'secure' || config.tls === true,
      region: guessRegion(config.ps),
    };
  } catch (e) {
    console.warn('[Parser] Failed to parse vmess:', e.message);
    return null;
  }
}

// 解析 VLESS URI
function parseVLESS(uri) {
  try {
    // vless://uuid@server:port?params#name
    const match = uri.match(/^vless:\/\/([^@]+)@([^:]+):(\d+)(\?[^\#]*)?(#.*)?$/);
    if (!match) return null;

    const [, uuid, server, port, paramsRaw, nameRaw] = match;
    const params = new URLSearchParams(paramsRaw?.slice(1) || '');
    const name = nameRaw ? decodeURIComponent(nameRaw.slice(1)) : `${server}:${port}`;

    return {
      type: 'vless',
      name,
      server,
      port: parseInt(port),
      uuid,
      flow: params.get('flow') || '',
      network: params.get('type') || 'tcp',
      tls: params.get('security') === 'tls',
      region: guessRegion(name),
    };
  } catch (e) {
    console.warn('[Parser] Failed to parse vless:', e.message);
    return null;
  }
}

// 解析 Trojan URI
function parseTrojan(uri) {
  try {
    // trojan://password@server:port?params#name
    const match = uri.match(/^trojan:\/\/([^@]+)@([^:]+):(\d+)(\?[^\#]*)?(#.*)?$/);
    if (!match) return null;

    const [, password, server, port, paramsRaw, nameRaw] = match;
    const params = new URLSearchParams(paramsRaw?.slice(1) || '');
    const name = nameRaw ? decodeURIComponent(nameRaw.slice(1)) : `${server}:${port}`;

    return {
      type: 'trojan',
      name,
      server,
      port: parseInt(port),
      password,
      network: params.get('type') || 'tcp',
      tls: params.get('security') === 'tls',
      region: guessRegion(name),
    };
  } catch (e) {
    console.warn('[Parser] Failed to parse trojan:', e.message);
    return null;
  }
}

// 解析 SS URI
function parseSS(uri) {
  try {
    let decoded;
    if (uri.startsWith('ss://')) {
      const withoutPrefix = uri.slice(5);
      // SIP002 格式: ss://base64(method:password)@server:port#name
      const hashIndex = withoutPrefix.lastIndexOf('#');
      const mainPart = hashIndex >= 0 ? withoutPrefix.slice(0, hashIndex) : withoutPrefix;
      const name = hashIndex >= 0 ? decodeURIComponent(withoutPrefix.slice(hashIndex + 1)) : '';

      const atIndex = mainPart.indexOf('@');
      if (atIndex > 0) {
        const userInfo = mainPart.slice(0, atIndex);
        const serverPart = mainPart.slice(atIndex + 1);

        const decodedInfo = base64Decode(userInfo);
        const colonIndex = decodedInfo.indexOf(':');
        if (colonIndex < 0) return null;

        const method = decodedInfo.slice(0, colonIndex);
        const password = decodedInfo.slice(colonIndex + 1);

        const [server, portStr] = serverPart.split(':');
        if (!server || !portStr) return null;

        return {
          type: 'ss',
          name: name || `${server}:${portStr}`,
          server,
          port: parseInt(portStr),
          method,
          password,
          region: guessRegion(name),
        };
      }
    }
    return null;
  } catch (e) {
    console.warn('[Parser] Failed to parse ss:', e.message);
    return null;
  }
}

// 解析 SSR URI
function parseSSR(uri) {
  try {
    if (!uri.startsWith('ssr://')) return null;

    const decoded = base64Decode(uri.slice(6));
    const parts = decoded.split(':');

    if (parts.length < 6) return null;

    const [server, port, protocol, method, obfs, passwordBase64] = parts;
    const password = base64Decode(passwordBase64.split('/?')[0]);

    const paramsStr = parts.join(':').split('/?')[1] || '';
    const params = new URLSearchParams(paramsStr);
    const name = params.get('remarks') ? base64Decode(params.get('remarks')) : `${server}:${port}`;

    return {
      type: 'ssr',
      name,
      server,
      port: parseInt(port),
      protocol,
      method,
      obfs,
      password,
      region: guessRegion(name),
    };
  } catch (e) {
    console.warn('[Parser] Failed to parse ssr:', e.message);
    return null;
  }
}

// 解析 Hysteria2 URI
function parseHysteria2(uri) {
  try {
    // hysteria2://password@server:port?params#name
    const match = uri.match(/^hysteria2?:\/\/([^@]+)@([^:]+):(\d+)(\?[^\#]*)?(#.*)?$/i);
    if (!match) return null;

    const [, password, server, port, , nameRaw] = match;
    const name = nameRaw ? decodeURIComponent(nameRaw.slice(1)) : `${server}:${port}`;

    return {
      type: 'hysteria2',
      name,
      server,
      port: parseInt(port),
      password,
      region: guessRegion(name),
    };
  } catch (e) {
    console.warn('[Parser] Failed to parse hysteria2:', e.message);
    return null;
  }
}

// 解析 TUIC URI
function parseTUIC(uri) {
  try {
    // tu://uuid:password@server:port
    const match = uri.match(/^tuic?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)(\?[^\#]*)?(#.*)?$/i);
    if (!match) return null;

    const [, uuid, password, server, port, , nameRaw] = match;
    const name = nameRaw ? decodeURIComponent(nameRaw.slice(1)) : `${server}:${port}`;

    return {
      type: 'tuic',
      name,
      server,
      port: parseInt(port),
      uuid,
      password,
      region: guessRegion(name),
    };
  } catch (e) {
    console.warn('[Parser] Failed to parse tuic:', e.message);
    return null;
  }
}

// 猜测地区
function guessRegion(name) {
  if (!name) return '🌍 Unknown';

  const regionMap = [
    { pattern: /香港|HK|Hong\s*Kong/i, flag: '🇭🇰', label: '香港' },
    { pattern: /日本|JP|Japan|东京|大阪/i, flag: '🇯🇵', label: '日本' },
    { pattern: /美国|US|United\s*States|洛杉矶|硅谷|西雅图|达拉斯|凤凰城|纽约/i, flag: '🇺🇸', label: '美国' },
    { pattern: /新加坡|SG|Singapore/i, flag: '🇸🇬', label: '新加坡' },
    { pattern: /台湾|TW|Taiwan/i, flag: '🇹🇼', label: '台湾' },
    { pattern: /韩国|KR|Korea|首尔/i, flag: '🇰🇷', label: '韩国' },
    { pattern: /英国|GB|UK|Britain|伦敦/i, flag: '🇬🇧', label: '英国' },
    { pattern: /德国|DE|Germany|法兰克福|柏林/i, flag: '🇩🇪', label: '德国' },
    { pattern: /法国|FR|France|巴黎/i, flag: '🇫🇷', label: '法国' },
    { pattern: /澳大利亚|AU|Australia|悉尼|墨尔本/i, flag: '🇦🇺', label: '澳大利亚' },
    { pattern: /加拿大|CA|Canada/i, flag: '🇨🇦', label: '加拿大' },
    { pattern: /印度|IN|India|孟买/i, flag: '🇮🇳', label: '印度' },
    { pattern: /俄罗斯|RU|Russia|莫斯科/i, flag: '🇷🇺', label: '俄罗斯' },
    { pattern: /巴西|BR|Brazil/i, flag: '🇧🇷', label: '巴西' },
    { pattern: /土耳其|TR|Turkey/i, flag: '🇹🇷', label: '土耳其' },
    { pattern: /阿根廷|AR|Argentina/i, flag: '🇦🇷', label: '阿根廷' },
    { pattern: /泰国|TH|Thailand/i, flag: '🇹🇭', label: '泰国' },
    { pattern: /越南|VN|Vietnam/i, flag: '🇻🇳', label: '越南' },
    { pattern: /马来西亚|MY|Malaysia/i, flag: '🇲🇾', label: '马来西亚' },
    { pattern: /菲律宾|PH|Philippines/i, flag: '🇵🇭', label: '菲律宾' },
    { pattern: /印尼|ID|Indonesia/i, flag: '🇮🇩', label: '印尼' },
  ];

  for (const { pattern, flag, label } of regionMap) {
    if (pattern.test(name)) {
      return `${flag} ${label}`;
    }
  }

  return `🌍 Other`;
}

// 判断是否是广告节点
function isAdNode(name) {
  if (!name) return false;
  const adKeywords = ['流量', '过期', '官网', '官网', '购买', '续费', '套餐', '试用', '推广'];
  return adKeywords.some(kw => name.includes(kw));
}

// 解析单行代理 URI
function parseProxyLine(line) {
  line = line.trim();
  if (!line) return null;

  if (line.startsWith('vmess://')) return parseVMess(line);
  if (line.startsWith('vless://')) return parseVLESS(line);
  if (line.startsWith('trojan://')) return parseTrojan(line);
  if (line.startsWith('ss://')) return parseSS(line);
  if (line.startsWith('ssr://')) return parseSSR(line);
  if (/^hysteria2?:\/\//i.test(line)) return parseHysteria2(line);
  if (/^tuic?:\/\//i.test(line)) return parseTUIC(line);

  return null;
}

// 解析订阅内容（Base64 或 YAML）
function parseSubscription(content) {
  const nodes = [];

  // 尝试 Base64 解码
  const trimmed = content.trim();

  // 检查是否是 Base64 编码的订阅
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 50) {
    try {
      const decoded = base64Decode(trimmed);
      const lines = decoded.split('\n');
      for (const line of lines) {
        const node = parseProxyLine(line.trim());
        if (node) nodes.push(node);
      }

      if (nodes.length > 0) return nodes;
    } catch {}
  }

  // 直接按行解析
  const lines = trimmed.split('\n');
  for (const line of lines) {
    const node = parseProxyLine(line.trim());
    if (node) nodes.push(node);
  }

  // 如果还没找到节点，尝试从原始内容提取 URI
  if (nodes.length === 0) {
    const uriPattern = /(vmess|vless|trojan|ss|ssr|hysteria2?):\/\/[^\s"']+/gi;
    let match;
    while ((match = uriPattern.exec(content)) !== null) {
      const node = parseProxyLine(match[0]);
      if (node) nodes.push(node);
    }
  }

  return nodes;
}

// 从文本中提取 URLs
function extractUrls(text) {
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const urls = new Set();
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    urls.add(match[0]);
  }
  return [...urls];
}

// 格式化订阅信息
function formatSubscriptionInfo(nodes, userInfo, subscriptionUrl, extraInfo) {
  if (!nodes || nodes.length === 0) return { text: '未找到任何节点', entities: [] };

  const filteredNodes = nodes.filter(n => !isAdNode(n.name));
  const validNodes = filteredNodes.length > 0 ? filteredNodes : nodes;

  const regionMap = new Map();
  for (const n of validNodes) {
    const key = n.region;
    if (!regionMap.has(key)) regionMap.set(key, []);
    regionMap.get(key).push(n);
  }

  const lines = [];
  const entities = [];

  const configName = (extraInfo && extraInfo.configName) || null;
  const resetDays = (extraInfo && extraInfo.resetDays) || null;

  if (configName) lines.push(`机场名称: ${configName}`);
  if (subscriptionUrl) lines.push(`订阅链接: ${subscriptionUrl}`);

  if (userInfo) {
    const usedBytes = userInfo.upload + userInfo.download;
    const totalBytes = userInfo.total;
    const remainBytes = totalBytes - usedBytes;
    const percentage = totalBytes > 0 ? (usedBytes / totalBytes * 100) : 0;

    lines.push(`流量详情: ${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`);
    lines.push(`使用进度: ${generateProgressBar(percentage)}`);
    lines.push(`剩余可用: ${formatBytes(Math.max(0, remainBytes))}`);

    if (userInfo.expire) {
      const expireDate = new Date(userInfo.expire * 1000);
      const now = new Date();
      const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${expireDate.getFullYear()}/${expireDate.getMonth() + 1}/${expireDate.getDate()} ${pad(expireDate.getHours())}:${pad(expireDate.getMinutes())}`;
      lines.push(`过期时间: ${dateStr} (剩余${daysLeft}天)`);
    } else {
      lines.push('过期时间: 永久有效');
    }
  }

  const typeSet = new Set();
  for (const n of validNodes) typeSet.add(n.type);

  lines.push(`\n协议类型: ${[...typeSet].join(', ')}`);
  lines.push(`节点总数: ${validNodes.length} | 国家/地区: ${regionMap.size}`);

  const regions = [...regionMap.keys()];
  const regionLabels = regions.map(r => r.replace(/^[\u{1F1E0}-\u{1F1FF}]{2}\s*/u, ''));
  lines.push(`覆盖范围: ${regionLabels.join(', ')}`);

  if (resetDays !== null && resetDays !== undefined) {
    lines.push(`距离下次重置剩余：${resetDays} 天`);
  }

  // 节点列表
  const nodeNames = validNodes.map(n => n.name);
  if (nodeNames.length > 0) {
    lines.push(`\n📋 节点列表：`);
    lines.push(...nodeNames.map((name, i) => `${i + 1}. ${name}`));
  }

  return { text: lines.join('\n'), entities };
}

export {
  base64Decode,
  base64Encode,
  formatBytes,
  generateProgressBar,
  parseProxyLine,
  parseSubscription,
  extractUrls,
  formatSubscriptionInfo,
  isAdNode,
  guessRegion,
};

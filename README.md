# WorkerGram Cloudflare Workers 部署指南

## 项目结构

```
cf-deploy/
├── download-worker/          # 文件下载服务
│   ├── src/
│   │   └── index.js         # Download Worker 主文件
│   ├── package.json
│   └── wrangler.toml        # 配置文件
│
└── bot-worker/               # Telegram Bot 服务
    ├── src/
    │   ├── index.js         # Bot Worker 主文件（Webhook 模式）
    │   ├── config.js        # 配置管理
    │   ├── db.js            # D1 数据库操作
    │   ├── memory.js        # 内存缓存
    │   ├── commands/        # 命令模块
    │   │   ├── signin.js
    │   │   ├── shorten.js
    │   │   ├── subscription.js
    │   │   ├── quota.js
    │   │   ├── leaderboard.js
    │   │   ├── resolve.js
    │   │   └── admin.js
    │   └── utils/
    │       └── parser.js    # 订阅/代理解析器
    ├── package.json
    └── wrangler.toml        # 配置文件
```

## 功能特性

### Download Worker (workergram-download)
- ✅ 文件下载代理（通过短码下载 Telegram 文件）
- ✅ 创建下载链接 API（供 Bot 调用）
- ✅ 链接查询和统计
- ✅ 自动清理过期链接（定时任务）
- ✅ 认证保护

### Bot Worker (workergram-bot)
- ✅ **签到系统** - 每日签到领积分，连续签到奖励
- ✅ **URL 短链接** - 创建和管理 URL 短链接
- ✅ **文件短链接** - 为 Telegram 文件生成下载链接
- ✅ **订阅解析** - 支持 Clash/YAML/Base64/VMess/VLESS/Trojan/SS 等
- ✅ **配额系统** - 积分兑换短链接配额
- ✅ **排行榜** - 积分排行榜
- ✅ **管理员功能** - 用户管理、积分调整、封禁/解封
- ✅ **群组支持** - 支持在群组中使用

## 部署步骤

### 前提条件

1. 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
2. 登录 Cloudflare：`wrangler login`
3. 创建两个 D1 数据库

```bash
# 创建数据库
npx wrangler d1 create workergram-download
npx wrangler d1 create workergram-bot
```

### 1️⃣ 部署 Download Worker

```bash
cd cf-deploy/download-worker

# 安装依赖（如果需要）
npm install

# 编辑配置 wrangler.toml，填入：
# - BOT_TOKEN: 你的 Telegram Bot Token
# - ADMIN_SECRET: 认证密钥（与 Bot Worker 保持一致）
# - database_id: 上一步创建的 D1 数据库 ID

# 初始化数据库表（可选）
npx wrangler d1 execute workergram-download --file=../schema-download.sql

# 本地测试
npm run dev

# 部署到 Cloudflare
npm run deploy
```

**记录下部署后的 URL：**
```
https://workergram-download.<your-subdomain>.workers.dev
```

### 2️⃣ 部署 Bot Worker

```bash
cd cf-deploy/bot-worker

# 安装依赖
npm install

# 编辑 wrangler.toml，填入：
# - BOT_TOKEN: 你的 Telegram Bot Token
# - ADMIN_CHAT_ID: 你的 Telegram User ID（作为管理员）
# - ADMIN_SECRET: 认证密钥
# - DOWNLOAD_WORKER_URL: 上一步部署的 Download Worker URL
# - DOWNLOAD_WORKER_SECRET: 与 Download Worker 的 ADMIN_SECRET 一致
# - database_id: D1 数据库 ID

# 初始化数据库表（可选）
npx wrangler d1 execute workergram-bot --file=../schema-bot.sql

# 本地测试
npm run dev

# 部署到 Cloudflare
npm run deploy
```

**记录下部署后的 URL：**
```
https://workergram-bot.<your-subdomain>.workers.dev
```

### 3️⃣ 设置 Webhook

部署成功后，需要设置 Telegram Webhook：

```bash
# 方法 1：通过 Bot Worker API 设置
curl -X POST "https://workergram-bot.<your-domain>.workers.dev/webhook/set" \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json"

# 方法 2：手动调用 Telegram API
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https%3A%2F%2Fworkergram-bot.%3Cyour-domain%3E.workers.dev%2Fwebhook"
```

验证 Webhook 是否设置成功：

```bash
curl "https://workergram-bot.<your-domain>.workers.dev/webhook/info"
```

## 环境变量说明

### Download Worker (wrangler.toml)

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `BOT_TOKEN` | Telegram Bot Token | `123456:ABC-DEF...` |
| `ADMIN_SECRET` | API 认证密钥 | `LCY001214lcy` |
| `MAX_FILE_SIZE` | 最大文件大小（字节） | `20971520` (20MB) |
| `CLEANUP_DAYS` | 自动清理天数 | `30` |

### Bot Worker (wrangler.toml)

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `BOT_TOKEN` | Telegram Bot Token | `123456:ABC-DEF...` |
| `ADMIN_CHAT_ID` | 管理员用户 ID | `7407559213` |
| `ADMIN_SECRET` | 认证密钥 | `LCY001214lcy` |
| `SIGNIN_POINTS` | 每次签到积分 | `10` |
| `STREAK_BONUS` | 连续签到奖励 | `20` |
| `STREAK_DAYS` | 连续签到周期 | `7` |
| `QUOTA_COST` | 配额兑换成本（积分） | `50` |
| `DOWNLOAD_WORKER_URL` | Download Worker 地址 | `https://...workers.dev` |
| `DOWNLOAD_WORKER_SECRET` | Download Worker 密钥 | `LCY001214lcy` |

## 使用说明

### 常用命令

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 |
| `/help` | 查看帮助 |
| `/signin` 或发送"签到" | 每日签到 (+10积分) |
| `/shorten <URL>` | 创建 URL 短链接 (-1配额) |
| 发送文件 + `/gen_link` | 生成文件下载链接 (-50积分) |
| `/sub <内容>` | 解析订阅/节点 |
| `/buy_quota <数量>` | 兑换配额 (50积分/个) |
| `/top` | 查看排行榜 |
| `/resolve <短码>` | 解析短链接 |
| `/admin stats` | 系统统计（管理员） |

### 工作流程

1. **用户签到** → 获得积分
2. **兑换配额** → 用积分换取 URL 短链接次数
3. **创建链接** → 使用配额创建 URL 短链接 / 用积分创建文件短链接
4. **分享链接** → 其他人可通过短码访问原链接或下载文件

## 注意事项

### ⚠️ 重要提示

1. **免费版限制**：Cloudflare Workers 免费版每天有 10 万次请求限制
2. **执行时间**：Workers 脚本执行时间限制为 30 秒（付费版）/ 10ms CPU 时间（免费版）
3. **D1 数据库**：免费版每日 500 万次读取，10 万次写入
4. **文件大小**：默认最大 20MB，可在配置中修改
5. **Bot Token 安全**：不要将 Token 提交到公开代码仓库

### 🔧 故障排查

**问题：Webhook 不工作？**
- 检查 Bot Token 是否正确
- 验证 Worker URL 是否可访问
- 查看 Workers 日志：`wrangler tail`

**问题：数据库错误？**
- 确认 D1 数据库已正确绑定
- 检查 database_id 是否正确
- 可能需要手动初始化表结构

**问题：文件下载失败？**
- 检查 BOT_TOKEN 是否有权限获取文件
- 确认文件未过期（Telegram 文件有时效性）
- 查看文件大小是否超过限制

## 技术架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Telegram App   │────▶│  Bot Worker      │────▶│  D1 Database │
│                 │◀────│  (Webhook)       │     │  (users,    │
└─────────────────┘     └────────┬─────────┘     │   links)    │
                                │               └─────────────┘
                                ▼
                       ┌──────────────────┐
                       │  Download Worker  │
                       │  (File Proxy)     │
                       └────────┬─────────┘
                                ▼
                       ┌──────────────────┐
                       │  D1 Database      │
                       │  (links)          │
                       └──────────────────┘
```

## 更新日志

### v2.0.0 (2026-06)
- ✅ 完整迁移至 Cloudflare Workers
- ✅ 使用 D1 替代 SQLite
- ✅ Webhook 模式替代 Polling
- ✅ 支持所有原有功能
- ✅ 优化性能和内存使用

---

**部署完成后，你的 Bot 和下载服务将运行在 Cloudflare 全球边缘网络！🚀**

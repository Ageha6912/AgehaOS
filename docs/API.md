# AgehaOS Auth API（Milestone 5）

> 实现位置：`server/`（Node.js + Fastify 5）。基线：[PRD.md](PRD.md) §12（用户系统）、§20（后端技术方向）、§21.1（User 数据模型）、§30.4/§30.5（Token 与 API 安全）。

## 1. 运行

```bash
npm run dev:server        # 开发（tsx watch），默认 http://127.0.0.1:8787
npm run start:server      # 前台运行
npm run test:server       # 后端测试（vitest，node 环境）
docker compose -f server/docker-compose.yml up -d   # 可选：本地 PostgreSQL
```

前端侧设 `VITE_AUTH_BACKEND=1` 启动 dev server 即启用远程认证（`/api` 经 Vite 代理同源转发到 `:8787`）；不设置则维持本地 localStorage 认证（v0.1 行为）。生产部署由反向代理把 `/api` 指向后端，代理需转发 `X-Forwarded-Host`（Vite 开发代理已通过 `xfwd: true` 示范）。

### 环境变量

| 变量                          | 默认值                       | 说明                                          |
| ----------------------------- | ---------------------------- | --------------------------------------------- |
| `AGEHA_PORT` / `AGEHA_HOST`   | `8787` / `127.0.0.1`         | 监听地址                                      |
| `AGEHA_STORE`                 | `DATABASE_URL` 有则 `postgres`，否则 `file` | 存储驱动：`memory` / `file` / `postgres` |
| `AGEHA_DATA_DIR`              | `server/data`                | file 驱动的数据目录（`agehaos-auth.json`）    |
| `DATABASE_URL`                | —                            | Postgres 连接串（postgres 驱动）              |
| `AGEHA_SESSION_TTL_MS`        | `604800000`（7 天）          | 会话有效期                                    |
| `AGEHA_RATE_LIMIT_LOGIN_MAX`  | `10`                         | 每窗口登录尝试上限 / IP                       |
| `AGEHA_RATE_LIMIT_REGISTER_MAX` | `20`                       | 每窗口注册上限 / IP                           |
| `AGEHA_RATE_LIMIT_WINDOW_MS`  | `60000`                      | 限流窗口                                      |
| `AGEHA_ALLOWED_ORIGINS`       | —                            | CSRF origin 额外白名单（逗号分隔）            |
| `AGEHA_LOG_LEVEL`             | `info`                       | pino 日志级别                                 |
| `NODE_ENV=production`         | —                            | 会话 Cookie 追加 `Secure`                     |

## 2. 会话模型（PRD §30.4）

- 令牌：256-bit 随机 opaque token，**只**存放于 `agehaos_session` HttpOnly Cookie —— JS 不可读，不入 LocalStorage。
- Cookie 属性：`HttpOnly; SameSite=Lax; Path=/; Max-Age=<TTL>`（生产追加 `Secure`）。
- 服务端会话表（DataStore）持有 token → userId 与过期时间；登出即删记录；登录时顺带清理过期会话。
- CSRF：`SameSite=Lax` 为主 + mutating 请求的 `Origin` 校验（同 host 或白名单放行，否则 403）。请求无 `Origin` 头（curl / 服务间调用）放行。
- 前端 localStorage 只缓存非敏感元数据（`{ user, expiresAt }`，键 `agehaos.auth.remote.v1`）用于启动快速路径；启动时 `reconcile()` 以服务端为准。

## 3. 端点

统一前缀 `/api`。所有错误响应为 `{ "error": "<code>" }`，code 与前端 `AuthErrorCode` 对齐。除特别说明外请求体为 JSON。

### GET /api/health

`200 { "ok": true }`。

### POST /api/auth/register

请求 `{ username, password }` → `201 { user, expiresAt }` + Set-Cookie（注册即登录）。

- `user`：`{ id, username, createdAt, updatedAt }`（ISO 字符串），永不含口令材料。
- 错误：`400 invalid-body`（schema 校验失败）、`409 user-exists`。

### POST /api/auth/login

请求 `{ username, password }` → `200 { user, expiresAt }` + Set-Cookie（每次登录轮换新 token）。

- 错误：`400 invalid-body`、`401 invalid-credentials`（用户不存在与口令错误同码，且走等时 scrypt 校验防账号枚举）、`429 rate-limited`。

### POST /api/auth/logout

`204` + 清除 Cookie（幂等：无会话也 204）。

### GET /api/auth/session · GET /api/users/me

`200 { user, expiresAt }` 或 `401 { "error": "not-authenticated" }`。

### PATCH /api/users/me

请求体（全部可选，缺省 = 不变，显式 `null` = 清除）：`{ displayName?: string|null (1–32), email?: string|null, avatar?: string|null }` → `200 { user }`。

- `avatar` 为客户端缩放后的 data URL（≤64KB 字符，格式白名单 `png/jpeg/webp` base64，拒绝 svg 等；PRD §12.1 修改头像）。
- 错误：`400 invalid-body`（schema、邮箱格式或头像格式）、`401 not-authenticated`。

### POST /api/users/me/password

请求 `{ currentPassword, newPassword }`（均 6–128 位）→ `204`。校验当前密码（错误 → `401 invalid-credentials`）；成功后**吊销该用户除当前会话外的全部会话**（防旧设备残留登录）。限流与 login 相同（10/min）。

### POST /api/auth/sessions/revoke-others

`200 { revoked: <count> }` —— 登出当前会话以外的全部会话（PRD §12.1 Session 管理）。无会话 → `401`。

### GET /api/auth/sessions · DELETE /api/auth/sessions/:id（设备管理，PRD §35）

- `GET` → `200 { sessions: [{ id, device, createdAt, expiresAt, current }] }`：当前会话排首；`id` 为 token 的 SHA-256 短哈希（**令牌本体绝不出服务端**）；`device` 为登录时 User-Agent 解析的短标签（浏览器 · 系统）。
- `DELETE /:id` → `200 { revoked: true }` 撤下对应会话；未知 id → `404`。
- 登录/注册创建会话时记录 `createdAt` 与 `device`（旧数据字段缺省容忍）。

### GET /api/sync/data/:domain · PUT /api/sync/data/:domain（用户同步 KV，PRD §35 + Phase 3 云文件切片）

- `domain` 为小写标识（`^[a-z][a-z0-9-]{0,63}$`，非法 → `400 {"error":"invalid-sync-domain"}`）。已用域：`settings`（用户配置）与 `files`（文本 VFS 快照，Phase 3 切片）。
- `GET` → `200 { data: string | null }`；`PUT` 请求 `{ data: string }`（≤256KB，超限 → `400 invalid-body`）→ `200 { ok: true }`。
- 无键的 `GET/PUT /api/sync/data` 保留为 `domain=settings` 的别名（存量客户端兼容）。
- 服务端是已认证的按（userId, domain）分键的哑 KV；合并策略归客户端（boot 拉取 + 防抖上推，整块 last-writer-wins）。存储层：memory / file（嵌套 `sync: { userId: { domain: entry } }`，旧扁平形状读取时自动迁移进 `settings` 域）/ postgres（`ageha_sync` 按 `(user_id, domain)` 唯一，迁移自动补 `domain` 列并重建唯一索引）。

### GET /api/store/catalog（远端应用目录，公开）

签名目录（ADR 18/20）：`{ keyId, algorithm:'ed25519', publicKey, payload:{version,generatedAt,apps}, signature }`。载荷为管理员发布过的目录（见下），未发布时回落内置样例；签名对规范化 JSON 计算，客户端验签 + `/apps/sites/` allowlist 过滤。

### GET/PUT /api/store/admin/catalog（目录管理，仅 admin，ADR 20）

- `GET` → `200 { apps: [...] }`；`PUT` 请求 `{ apps: [...] }`（≤50 条，整包替换）→ `200 { ok: true, apps }`。
- 深度校验（`validateCatalogApps`）：字段白名单（恰 8 字段）；`id` 唯一 `^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`；`entry` 必须匹配 `/apps/sites/<name>/index.html` 且无上跳；`permissions` ⊆ MVP 权限名；窗口 200–2000 整数；非法 → `400 {"error":"invalid-catalog"}`。
- 认证：会话 Cookie + `role=admin`；匿名 `401 not-authenticated`，普通用户 `403 not-admin`。

### 管理员引导（ADR 20）

`AGEHA_ADMIN_USERNAME` 环境变量：该用户名的注册者即时获得 `role=admin`；已存在同名用户在每次服务端启动时幂等提升（可追溯生效于既有库）。`/api/auth/*` 与 `/api/users/me` 的用户载荷携带 `role`（普通用户缺省不返回）。

### POST /api/ai/proxy（DDS §5.3，Phase B）

同源 LLM 代理：API Key 只存在服务端（`AGEHA_AI_API_KEY`，未配置 → `503 {"error":"ai-not-configured"}`，客户端走降级链）。

- 请求契约（schema 白名单，未知字段拒绝）：`{ anonymId (8–64), locale ('zh-CN'|'en'), context (≤16 键 / ≤2KB), prefs (≤20×32), slots (1–8×32) }`。
- 隐私：`anonymId` 为一次性随机 ID，仅服务端记日志分键，**不上游转发**；上游只收到 locale/context/prefs/slots。
- 上游：OpenAI 兼容 `/chat/completions`（`AGEHA_AI_BASE_URL`/`AGEHA_AI_MODEL`），超时 `AGEHA_AI_TIMEOUT_MS`（默认 2s）。
- 响应：`200 { items: [{slotId, text}] }` —— 服务端已过滤（未知槽位/超 200 字符/重复槽位丢弃，≤8 条）；空数组表示模型无可用品。
- 错误：`400 invalid-body`、`403 forbidden`（CSRF origin）、`429 rate-limited`（20/min/IP）、`502 ai-upstream`、`502 ai-invalid-response`（模型输出非 JSON）、`504 ai-timeout`。
- 阶段门控：Phase B 客户端只接受词表内的**结构化编排值**（提示卡变体号），自由文本一律丢弃不渲染（§5.3/§8.4）；Phase C 起扩展为完整过滤管线。

### POST /api/dynamic/samples（举报样本上传，DDS §8.6，匿名）

用户在 AI 内容面板举报自由文本并**于确认框显式同意后**上传的内容样本，供人工复审（铁律 4/10：最小化 + 显式同意）。

- **匿名**：无需登录、不携带任何用户/会话标识（举报者身份不出本地，§8.5 上行最小化）；滥用由共享限流（10/min/IP）、512 字符上限与服务端分类器把关。
- 请求：`{ text: string }`（1–512 字符；空白串 `400 invalid-body`）。
- 服务端分类器先行（`server/src/classifier.ts`，与客户端离线兜底词库同口径、独立演化）：`violation` → `422 {"error":"content-rejected"}` 且**不落库**（违规内容本体不入任何存储）；`misleading`/`discomfort`/`ok` → `201 {"status":"accepted","id","classification"}` 并落库。
- 存储：`ageha_content_samples`（postgres）/ file 存储序列化 `samples` 字段；容量 500 条，超出淘汰最旧（`MAX_CONTENT_SAMPLES`）。

### GET /api/dynamic/samples（复审清单，仅 admin）

- 认证：会话 Cookie + `role=admin`（与 ADR 20 目录管理同一 `requireAdmin` 门）；匿名 `401 not-authenticated`，普通用户 `403 not-admin`。
- 响应：`200 { samples: [{id, text, classification, createdAt}] }`，新样本在前。
- 复审 UI 未交付（PRD §47 应用审核范畴）；当前经 API 复审。

## 4. 安全机制（PRD §30.5）

- **口令哈希**：scrypt（N=2¹⁵, r=8, p=1, 64B key, 16B 随机盐，`maxmem` 64 MiB），存储格式 `scrypt$N$r$p$盐$哈希`（参数随哈希保存，可平滑升级成本），校验用 `timingSafeEqual`。
- **限流**：`@fastify/rate-limit` 按 IP + 路由（login 10/min、register 20/min、AI 代理 20/min、样本上传 10/min，可配）；响应带 `x-ratelimit-*` 头；多实例部署设 `AGEHA_REDIS_URL` 共享计数（ADR 21 附注，fail-open）。
- **输入校验**：Fastify JSON Schema（用户名 3–32 位 `^[a-zA-Z0-9_-]+$`、口令 6–128 位），schema 失败统一 `400 invalid-body`。
- **审计**：pino 结构化日志 `auth.register / auth.login / auth.login_failed / auth.logout`（成功日志只记 userId，不记用户名与令牌）。
- **安全头**：`@fastify/helmet` 默认全套（CSP、nosniff、frameguard、HSTS 等）。
- **信任代理**：`trustProxy: true` —— 反向代理转发 `X-Forwarded-Host` 时，CSRF origin 校验以浏览器侧 origin 为准。

## 5. 存储

`DataStore` 接口（`server/src/store/types.ts`）：`createUser / updateUser / findUserByUsername / findUserById / createSession / findSession / deleteSession / pruneExpiredSessions / deleteSessionsForUserExcept`，另有同步 KV（`getSyncData/putSyncData`）、管理员目录（`getAppCatalog/putAppCatalog`）与举报样本（`createContentSample/listContentSamples`，容量 500）。

| 驱动       | 用途                                       | 测试状态                             |
| ---------- | ------------------------------------------ | ------------------------------------ |
| `memory`   | 单测 / 一次性 dev                          | 32 项后端测试覆盖                    |
| `file`     | 本地 dev 默认（JSON + 原子重命名写入）      | 同上；真实重启持久化已在烟雾测试验证 |
| `postgres` | 生产（`DATABASE_URL`，幂等建表 + 参数化语句） | SQL 形状经 fake Pool 测试；**活库集成验证待环境**（本机无 Docker/PG，见 `server/docker-compose.yml`） |

Redis / S3 兼容对象存储按 PRD §20 属后续阶段（多实例限流共享、云文件），见 ARCHITECTURE §4.3。

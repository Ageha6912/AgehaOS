# AgehaOS 安全说明

> 依据 PRD §30（安全需求）、§45.6（安全验收）、§47（风险与应对）。本文档随安全相关改动同步更新。

## 1. 当前状态总览（v0.2）

| 要求（PRD §30）                                                         | 状态       | 说明                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| §30.1 App Sandbox（Default Deny → Explicit Permission → Scoped Access） | ✅ 部分    | `PermissionManager` Default Deny 已落地，`launchApp` 门禁强制校验；Type B 应用零能力运行；Type C SDK 提供按 appId 命名空间隔离的存储（Scoped Access）；File/Notification/User API 随后续阶段细化                             |
| §30.2 XSS                                                               | ✅         | 全程 React 默认转义；代码库禁用 `dangerouslySetInnerHTML` / `innerHTML`（CI 可grep 审计）；生产构建注入 CSP                                 |
| §30.3 iframe 安全                                                       | ✅         | Type B 已实现：`sandbox="allow-scripts"`（不给 `allow-same-origin`，不透明 origin）+ `/apps/sites/` 同源 allowlist（`src/core/apps/web-app.ts`）+ postMessage 白名单 schema 校验（`event.source` 严格相等、未知类型与字段一律丢弃）；App Store 目录为安装侧第一道闸 |
| §30.4 Token                                                             | ✅（远程）/⚠️ 折衷（本地） | **远程模式（`VITE_AUTH_BACKEND`，Milestone 5）**：会话令牌为 256-bit opaque token，仅存 `agehaos_session` HttpOnly Cookie（`SameSite=Lax`、生产 `Secure`），JS 不可读、不入 LocalStorage，localStorage 仅缓存非敏感 `{user, expiresAt}` 元数据；CSRF 以 SameSite + `Origin` 校验双层防护。**本地模式（默认）**：令牌仍存同源 localStorage，泄露面等同同源脚本，风险可接受 |
| §30.5 API 安全（鉴权/限流/审计）                                        | ✅ 认证面落地 | 后端：JSON Schema 输入校验、按 IP 路由限流（login 10/min / register 20/min）、helmet 安全头、pino 结构化审计（`auth.register/login/login_failed/logout`，只记 userId）；CSRF origin 校验见 §30.4。资源型鉴权随云文件/远端目录后续落地 |

## 2. 内容安全策略（CSP）

生产构建（`vite build`）通过 `vite.config.ts` 的 `contentSecurityPolicy()` 插件向 `index.html` 注入：

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'
```

- `script-src 'self'`：构建产物无内联脚本，禁止第三方脚本注入。
- `style-src 'unsafe-inline'`：窗口几何等使用内联 `style` 属性（不来自用户内容），保留。
- 开发服务器不受影响（HMR 需要内联脚本与 WebSocket，策略仅 `apply: 'build'`）。
- **部署要求**：反向代理（Nginx/Caddy）应把同一策略以 HTTP 响应头下发，并追加 `frame-ancestors 'none'`（meta 标签不支持该指令）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`（已内置 meta 兜底）、`Strict-Transport-Security`。

## 3. 认证与口令

### 3.1 本地模式（默认，v0.1 契约不变）

- 口令以「16 字节随机盐 + SHA-256(salt:password)」存储，绝不明文落盘；对外的 `User` 类型不暴露任何口令材料。
- 用户名规则：3–32 位字母/数字/`-`/`_`；口令最短 6 位。
- 会话：`{ token, userId, expiresAt }`，默认 7 天，惰性过期校验并在过期时清除。
- 已知折衷：本地会话令牌存于 localStorage（见上表 §30.4）。

### 3.2 远程模式（Milestone 5 后端，`VITE_AUTH_BACKEND=1`）

前端 `systemAuthService` 切换为 `RemoteAuthClient`（同一 `AuthProvider` 契约，UI 零改动），后端契约见 [API.md](API.md)：

- **令牌不出服务端**：登录/注册由后端 `Set-Cookie` 下发 `agehaos_session`（HttpOnly、SameSite=Lax、Path=/、7 天，生产追加 Secure）；前端缓存仅 `{user, expiresAt}`（键 `agehaos.auth.remote.v1`），启动时 `reconcile()` 以服务端会话为准。
- **CSRF**：SameSite=Lax 为主 + 后端对 mutating 请求做 `Origin` 校验（同 host / `AGEHA_ALLOWED_ORIGINS` 白名单放行，否则 403）；反代需转发 `X-Forwarded-Host`（Vite 开发代理已 `xfwd: true`），后端 `trustProxy` 采纳。
- **口令哈希（服务端）**：scrypt N=2¹⁵/r=8/p=1、16B 盐、`timingSafeEqual` 校验；登录失败与账号不存在等时（dummy scrypt）防枚举。
- **限流**：login 10/min、register 20/min 每 IP（可配），超限 `429 {"error":"rate-limited"}`；改密码路由与 login 同限流。
- **审计**：pino 结构化 `auth.*` 事件；成功日志只含 userId。
- **改密码即吊销其他会话**：`POST /api/users/me/password` 校验当前密码后重哈希，并吊销该用户除当前会话外的全部会话（防被窃 cookie 继续存活）；「登出其他设备」动作复用同一 DataStore 原语。

## 4. 已知风险与后续项（PRD §47）

- **后端（Milestone 5 进行中）**：postgres 驱动就绪但活库集成验证待环境（`server/docker-compose.yml`）；Redis 多实例限流共享、S3 对象存储随 Phase 3；OAuth/2FA 未开始。生产部署必须在 HTTPS 后（`Secure` cookie + HSTS）。
- **iframe 应用（Type B，v0.2 已落地）**：当前仅允许随构建打包的同源站点（`/apps/sites/`）；接入远端分发前必须先落来源校验、签名与版本管理，并重估 CSP `frame-src`。
- **第三方 App（App Store）**：Manifest 校验 + 权限确认流已就绪（零权限应用可直接安装）；目录当前随构建打包，远端目录需补来源校验、权限审核流、签名与版本管理。
- **大文件**：VFS 当前为文本内容；二进制与超大文件必须走 OPFS/流式方案（§47.3）。
- **依赖安全**：`npm audit` 纳入发布前检查（当前 0 已知漏洞）。

## 5. 问题上报

发现安全问题请优先私下反馈给维护者，勿直接公开建 issue；修复后在本文件补记。

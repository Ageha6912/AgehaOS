# AgehaOS 安全说明

> 依据 PRD §30（安全需求）、§45.6（安全验收）、§47（风险与应对）。本文档随安全相关改动同步更新。

## 1. 当前状态总览（v0.2）

| 要求（PRD §30）                                                         | 状态       | 说明                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| §30.1 App Sandbox（Default Deny → Explicit Permission → Scoped Access） | ✅ 部分    | `PermissionManager` Default Deny 已落地，`launchApp` 门禁强制校验；Type B 应用零能力运行；「Scoped Access」随 Type C SDK 应用细化             |
| §30.2 XSS                                                               | ✅         | 全程 React 默认转义；代码库禁用 `dangerouslySetInnerHTML` / `innerHTML`（CI 可grep 审计）；生产构建注入 CSP                                 |
| §30.3 iframe 安全                                                       | ✅         | Type B 已实现：`sandbox="allow-scripts"`（不给 `allow-same-origin`，不透明 origin）+ `/apps/sites/` 同源 allowlist（`src/core/apps/web-app.ts`）+ postMessage 白名单 schema 校验（`event.source` 严格相等、未知类型与字段一律丢弃）；App Store 目录为安装侧第一道闸 |
| §30.4 Token                                                             | ✅/⚠️ 折衷 | 本地 v0.1：会话令牌仅存于同源 localStorage，泄露面等同同源脚本，风险可接受；接入后端（Milestone 5）后必须迁移为 HttpOnly Cookie + CSRF 防护 |
| §30.5 API 安全（鉴权/限流/审计）                                        | ⏳ 后端    | `permission.denied` / `user.login` 等审计事件已在事件总线记录；限流与鉴权随 Milestone 5 后端落地                                            |

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

## 3. 认证与口令（本地 v0.1）

- 口令以「16 字节随机盐 + SHA-256(salt:password)」存储，绝不明文落盘；对外的 `User` 类型不暴露任何口令材料。
- 用户名规则：3–32 位字母/数字/`-`/`_`；口令最短 6 位。
- 会话：`{ token, userId, expiresAt }`，默认 7 天，惰性过期校验并在过期时清除。
- 已知折衷：本地会话令牌存于 localStorage（见上表 §30.4）；后端接入后由 HttpOnly Cookie 承载，localStorage 仅保留非敏感 UI 偏好。

## 4. 已知风险与后续项（PRD §47）

- **iframe 应用（Type B，v0.2 已落地）**：当前仅允许随构建打包的同源站点（`/apps/sites/`）；接入远端分发前必须先落来源校验、签名与版本管理，并重估 CSP `frame-src`。
- **第三方 App（App Store）**：Manifest 校验 + 权限确认流已就绪（零权限应用可直接安装）；目录当前随构建打包，远端目录需补来源校验、权限审核流、签名与版本管理。
- **大文件**：VFS 当前为文本内容；二进制与超大文件必须走 OPFS/流式方案（§47.3）。
- **依赖安全**：`npm audit` 纳入发布前检查（当前 0 已知漏洞）。

## 5. 问题上报

发现安全问题请优先私下反馈给维护者，勿直接公开建 issue；修复后在本文件补记。

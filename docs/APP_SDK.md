# AgehaOS App SDK（APP_SDK）

面向 Type C「Ageha App」开发者的官方文档（PRD §8.1、§17、§42）。SDK 允许运行在
AgehaOS 桌面里的第三方 Web 应用，通过沙箱桥使用系统能力——一切能力都以用户在
安装时逐项授权为前提（Default Deny，§10）。

## 1. 运行模型

- 应用以 **iframe 沙箱**运行：`sandbox="allow-scripts"`，来源为不透明 origin——
  应用自身无法使用 localStorage/Cookie 持久化，一切持久化都经 SDK 落在宿主侧。
- 入口必须位于同源 `/apps/sites/` allowlist 内（宿主侧强制，§30.3）。
- 通信走 `postMessage`：应用加载 SDK 后自动与宿主握手（`agehaos:hello` /
  `agehaos:ready`）；此后每个 SDK 调用一个往返，超时 5s。
- 每个请求都由宿主按 **（API, 动作）→ 权限** 白名单校验后执行；未授予的能力以
  rejected promise（`permission-denied`）回返，绝不静默失败。

### 接入

```html
<script src="/sdk/ageha-sdk.js"></script>
<script>
  AgehaOS.theme.get().then((theme) => console.log(theme))
</script>
```

### 权限申请

权限声明在应用 manifest 的 `permissions` 数组中，用户安装时在授权对话框逐项
确认（可全拒）。MVP 权限面（PRD §10.1）：

| 权限 | 授予的能力 |
| --- | --- |
| `storage` | 本应用隔离的键值存储 |
| `window` | 更新本应用窗口标题 |
| `filesystem.read` | 读取本应用主目录（见 §3） |
| `filesystem.write` | 写/建/删本应用主目录内条目 |
| `notification` | 发送系统通知 |
| `clipboard` | （SDK 面暂未开放） |
| `network` | （SDK 面暂未开放） |

无权限要求的只读面：`theme`、`user`、`permissions`、`system`（见 §4）。

## 2. API 一览

```ts
AgehaOS.storage   // storage 权限
AgehaOS.window    // window 权限
AgehaOS.files     // filesystem.read / filesystem.write 权限
AgehaOS.notification  // notification 权限
AgehaOS.theme     // 免许可
AgehaOS.user      // 免许可
AgehaOS.permissions   // 免许可
AgehaOS.system    // 免许可
```

### 2.1 `AgehaOS.storage`（按应用隔离的键值存储）

```ts
await AgehaOS.storage.set('note', { text: 'hi' })  // 值需可 JSON 序列化
const note = await AgehaOS.storage.get('note')      // 反序列化后的值或 null
await AgehaOS.storage.remove('note')
await AgehaOS.storage.keys()                        // string[]
```

配额：键名 1–64 字符（`[A-Za-z0-9_.-]`）、单值 ≤32KB、每应用 ≤64 键 /
总量 ≤256KB。命名空间按 appId 隔离——应用之间互不可见。

### 2.2 `AgehaOS.window`

```ts
await AgehaOS.window.setTitle('便签 (3)')   // 1–120 字符
```

### 2.3 `AgehaOS.files`（应用主目录内的文件访问）

所有路径**相对本应用主目录** `/Apps/<appId>/` 解析；`..` 上跳、控制字符与
越界路径一律 `invalid-path`——权限授予的是应用自己的目录，不是整盘（§10.3）。

```ts
await AgehaOS.files.mkdir('notes')                 // 建目录（父目录需已存在）
await AgehaOS.files.write('notes/a.txt', '内容')    // 创建或覆盖，≤256KB（UTF-8 字节）
const text = await AgehaOS.files.read('notes/a.txt')
const entries = await AgehaOS.files.list('notes')   // [{ name, type: 'file' | 'directory' }]
await AgehaOS.files.remove('notes/a.txt')           // 移入回收站（可恢复）
```

约束：主目录本身不可删（`root-protected`）；`write` 的父目录必须已存在
（`not-found`）；读/列需 `filesystem.read`，写/建/删需 `filesystem.write`。

### 2.4 `AgehaOS.notification`

```ts
await AgehaOS.notification.show({ title: '备份完成', body: '共 12 个文件' })
```

字面文本经宿主清洗（控制字符折叠为空格、去首尾空白）；标题 ≤64、正文 ≤200
字符。通知进入系统通知中心（右上角 toast + 铃铛历史），归属本应用。

### 2.5 `AgehaOS.theme`（免许可）

```ts
const theme = await AgehaOS.theme.get()   // 'light' | 'dark'
```

### 2.6 `AgehaOS.user`（免许可）

```ts
const user = await AgehaOS.user.get()   // { username, displayName } | null
```

只返回任务栏上已向用户展示的最小身份；**不含**邮箱、头像、会话令牌。未登录
返回 `null`。

### 2.7 `AgehaOS.permissions`（免许可）

```ts
const granted = await AgehaOS.permissions.all()   // string[]，如 ['storage', 'window']
```

本应用被授予的权限清单——运行前检查能力面，避免直接撞 `permission-denied`。

### 2.8 `AgehaOS.system`（免许可）

```ts
const info = await AgehaOS.system.info()   // { version, locale, tier }
// version: 宿主版本号；locale: 'zh-CN' | 'en'；tier: 'high' | 'mid' | 'low'（硬件档）
```

## 3. 错误码

所有失败以 rejected promise 抛 `Error`，`message` 为下列之一：

| 错误 | 含义 |
| --- | --- |
| `permission-denied` | 安装时未授予对应权限 |
| `unavailable` | 宿主未接入该能力（版本差异） |
| `unknown-action` | API 动作不存在 |
| `invalid-key` / `invalid-value` / `invalid-path` / `invalid-title` / `invalid-text` / `invalid-content` | 参数未通过校验 |
| `value-too-large` / `content-too-large` | 超出单值/单文件上限 |
| `too-many-keys` / `quota-exceeded` | 超出存储配额 |
| `storage-unavailable` | 宿主存储不可写 |
| `root-protected` | 试图删除应用主目录本身 |
| `not-found` / `already-exists` / `invalid-name` 等 | VFS 语义错误（原样透传） |
| `sdk-timeout` | 5s 内宿主未回执 |

## 4. 设计边界（开发者须知）

- 沙箱内没有自己的持久化：localStorage/Cookie 不可用，请使用 `storage` 与
  `files`。
- `filesystem` 授权的是**应用主目录**（ADR 16）——跨应用读取、系统目录访问
  不在能力面内。
- 通知与文件内容都会经宿主清洗/校验；超出限额的输入得到结构化错误而非截断。
- 隐私：SDK 面不向应用暴露任何遥测上传；`network`/`clipboard` 权限的 SDK 面
  尚未开放，manifest 声明了也不会获得能力。

## 5. 示例应用

App Store 内置样例（`public/apps/sites/`）：

- **便签**（sticky）：`storage` + `window`——持久化与标题更新；
- **云笔记**（fs-note）：`filesystem.read/write` + `notification`——笔记写入
  应用主目录、一键发送系统通知。

E2E 验收：`e2e/sdk-sticky.spec.ts`、`e2e/sdk-fs-note.spec.ts`。

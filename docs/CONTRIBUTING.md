# AgehaOS 协作约定

> 依据 PRD §34（测试策略）、§46（Definition of Done）、§53（文档协作约定）、§54（需求进入主线流程）。

## 1. 开发环境

- Node.js ≥ 20.19，npm ≥ 10
- 安装：`npm install`
- 推荐 VS Code 插件：见 `.vscode/extensions.json`（ESLint / Prettier / Tailwind / Vitest）

## 2. 常用命令

| 命令                    | 说明                       |
| ----------------------- | -------------------------- |
| `npm run dev`           | 启动开发服务器             |
| `npm run build`         | 类型检查 + 生产构建        |
| `npm run test`          | 运行全部单元测试（一次性） |
| `npm run test:watch`    | 监听模式测试               |
| `npm run test:coverage` | 覆盖率报告                 |
| `npm run lint`          | ESLint 检查                |
| `npm run format`        | Prettier 格式化            |

## 3. 分支模型

```text
main      # 稳定可发布
develop   # 集成分支
feature/* fix/* hotfix/*
```

## 4. 提交信息（Conventional Commits）

```text
feat: add window manager
fix: repair file delete flow
refactor: simplify app runtime
docs: update app sdk
test: add vfs integration tests
```

Issue 标签：`feat` `fix` `refactor` `security` `performance` `docs` `test`。

## 5. 测试要求（强制）

依据仓库全局规则：**每次改动必须编写或更新对应测试，交付前所有检查必须通过。**

- `src/core/**`（事件、i18n、窗口、运行时、VFS、权限）：单元测试必须覆盖公开 API 与边界情况（PRD §34.1）。
- UI 组件：Testing Library 断言用户可见行为（Loading / Empty / Error 态一并覆盖，PRD §46）。
- 涉及安全边界的改动（权限、沙箱、iframe、Token）：必须附带安全场景测试（PRD §34.4）。

### 交付前检查清单

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

四项全部通过才算完成。

## 6. Definition of Done（PRD §46）

1. 代码已合并
2. 有单元测试或集成测试
3. 有必要的 E2E 测试
4. 有错误处理
5. 有 Loading / Empty / Error 状态
6. 有权限检查
7. 有必要的日志
8. 有 API / 类型定义
9. 有 UI 文案（走 i18n，不硬编码）
10. 在目标浏览器验证通过
11. 相关文档已更新

## 7. 需求进入主线流程（PRD §54）

```text
Issue → Design → Implementation → Test → Review → Merge
```

新增能力必须先在 Issue 中明确：为什么需要、用户是谁、解决什么问题、依赖哪些系统能力、安全边界、如何测试与验收、是否影响现有 API。

## 8. 代码风格要点

- `src/core/**` 禁止依赖 React / DOM UI（保持框架无关，见 [ARCHITECTURE.md](ARCHITECTURE.md) §2）。
- UI 文案一律 `t('key')`，新增文案同时补 `zh-CN` 与 `en` 词典（类型强制对齐）。
- 系统事件先扩展 `SystemEventMap` 再使用。
- 样式消费 `@theme` 设计 Token（PRD §27），不写魔法色值/圆角。

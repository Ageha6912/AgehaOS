import js from '@eslint/js'
import css from '@eslint/css'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules', '.zcode/**', '.tmp/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { 'react-hooks': reactHooks },
    // 仅启用经典两条核心规则（rules-of-hooks / exhaustive-deps）。不扩展
    // 7.x 的 recommended / recommended-latest 预设：两者都捆绑了 React
    // Compiler 静态分析（refs / set-state-in-effect / purity…），会对既有
    // 的事件回调读 refs 模式（MenuBar 方向键遍历、窗口动效）整批误报，
    // 且规则集随小版本漂移会突然打破门禁。
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    files: ['vite.config.ts', 'playwright.config.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['server/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['e2e/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
  },
  {
    // src/styles（--sp-* 空间化样式，如 spatial.css）纳入 lint 门禁：目录
    // 参数必须解析到至少一个可 lint 文件，否则 eslint 对目录名直接报
    // 「all files matching are ignored」（exit 2）。@eslint/css 官方 CSS
    // 语言插件。规则 = recommended 收窄两档（同 react-hooks 先例：不整包
    // 捆绑与本仓架构相斥的规则）——
    // ① no-invalid-properties 关：本仓令牌体系是「单 CSS 入口」——--ag-*
    //    定义在 index.css 的 :root/.dark，spatial.css 只消费（CSS 自定义
    //    属性按计算值解析，跨文件本就合法）；插件不做跨文件解析，逐处误报
    //    unknown variable。
    // ② use-baseline 关：backdrop-filter 与 prefers-reduced-transparency
    //    兜底是玻璃语言的地基（DESIGN.md §0.2/红线 6 强制要求后者存在），
    //    baseline 档位否决它们等于否决材质契约。
    files: ['src/styles/**/*.css'],
    plugins: { css },
    language: 'css/css',
    rules: {
      ...css.configs.recommended.rules,
      'css/no-invalid-properties': 'off',
      'css/use-baseline': 'off',
    },
  },
])

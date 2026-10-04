/**
 * 羽化主题 Token 下发（AI-GENERATED-APPS-DESIGN §5.1）：沙箱 iframe 是不透明
 * origin，不继承父页面 CSS——宿主必须显式把 `--ageha-*` 变量子集送进 runner。
 *
 * 命名裁决（勘察 risks）：生成代码契约保持设计文档的 `--ageha-*`（提示词面向
 * AI 不变），宿主侧从现存 `--ag-*` Token（src/index.css 单一来源）取计算值
 * 映射生成；不重命名现存 Token 体系。fallback 字面量只在计算值不可得时兜底
 * （jsdom 不解析样式表）。
 */

const AGEHA_TOKEN_SUBSET: ReadonlyArray<{
  ageha: string
  ag: string
  light: string
  dark: string
}> = [
  { ageha: '--ageha-bg', ag: '--ag-bg', light: '#eef4fd', dark: '#0c1220' },
  { ageha: '--ageha-surface', ag: '--ag-surface', light: '#fbfdff', dark: '#141b2b' },
  { ageha: '--ageha-surface-soft', ag: '--ag-surface-soft', light: '#edf3fc', dark: '#1b2438' },
  { ageha: '--ageha-text', ag: '--ag-text', light: '#18202c', dark: '#e6ecf7' },
  { ageha: '--ageha-text-muted', ag: '--ag-text-muted', light: '#5a6b82', dark: '#94a3bf' },
  { ageha: '--ageha-border', ag: '--ag-border', light: '#d9e3f4', dark: '#263149' },
  { ageha: '--ageha-primary', ag: '--ag-primary', light: '#2f5fe8', dark: '#82a3ff' },
  { ageha: '--ageha-primary-contrast', ag: '--ag-primary-contrast', light: '#f7f9ff', dark: '#0d1220' },
  { ageha: '--ageha-danger', ag: '--ag-danger', light: '#dc2626', dark: '#f87171' },
  { ageha: '--ageha-success', ag: '--ag-success', light: '#059669', dark: '#34d399' },
  { ageha: '--ageha-warning', ag: '--ag-warning', light: '#b45309', dark: '#fbbf24' },
  // 扩展活泼色板（2026-10-03 taste v5：清新多巴胺，禁蓝紫——仅注入沙箱供生成应用使用）。
  { ageha: '--ageha-cyan', ag: '--ag-cyan', light: '#0891b2', dark: '#22d3ee' },
  { ageha: '--ageha-lime', ag: '--ag-lime', light: '#65a30d', dark: '#a3e635' },
  { ageha: '--ageha-orange', ag: '--ag-orange', light: '#ea580c', dark: '#fb923c' },
  { ageha: '--ageha-radius', ag: '--ag-radius-md', light: '12px', dark: '12px' },
]

function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/** 握手时随首个 chunk 下发的主题变量子集（浅/深色随宿主当前态）。 */
export function buildThemeTokenCss(): string {
  const dark = isDarkTheme()
  const root = typeof document !== 'undefined' ? document.documentElement : null
  const declarations = AGEHA_TOKEN_SUBSET.map(({ ageha, ag, light, dark: darkValue }) => {
    const fallback = dark ? darkValue : light
    let value = fallback
    if (root !== null) {
      const computed = getComputedStyle(root).getPropertyValue(ag).trim()
      if (computed !== '') value = computed
    }
    return `${ageha}:${value}`
  })
  return `:root{${declarations.join(';')}}`
}

/** 打包成 style 元素标记片（宿主在握手后作为 seq 0 先行下发）。 */
export function themeStyleChunkHtml(): string {
  return `<style id="eclosion-theme">${buildThemeTokenCss()}</style>`
}

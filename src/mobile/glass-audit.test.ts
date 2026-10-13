import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * M4-5 移动性能体检 · 玻璃白名单钉扎（docs/DESIGN.md §35.1，仿
 * src/index.css.test.ts 的源文本契约测试）。backdrop-filter 玻璃是移动端
 * 最贵的渲染路径之一；§35.1 白名单制只允许五处——Header（状态栏条）、
 * Dock、Today 卡、Bottom Sheet、Dialog，清单外一律实色或轻透明白纱。
 *
 * 本测试盘点移动 Shell 及其可达共享面（src/apps、src/components）的全部
 * blur 载体，钉扎「白名席位 ↔ 组件 ↔ 玻璃类」清单，断言白名单之外零
 * blur：任何新增载体（新玻璃类、Tailwind backdrop-blur-*、内联
 * backdrop-filter 声明）都会让本测试红。合法新增（落在五席位内）请同步
 * 更新下方 ALLOWED_* 清单并在 docs/DESIGN.md §35.1 留注记；清单外新增请
 * 改实色/轻透明白纱（§35.1 原文口径）。
 *
 * 职责边界（桌面零接触）：桌面玻璃（index.css 桌面段七面材质表 §0.2/§33.1、
 * spatial.css 空间窗口层 §36、羽化运行时页 public/apps/runtime/eclosion.html
 * 的 ax-* 设计系统）各有权威契约，不在本清单断言范围——全仓盘点结果记录在
 * 切片 notes，交人工复核。
 */

const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

/** 递归列出目录下全部 .ts/.tsx 源文件（POSIX 相对路径，排除测试夹具）。 */
function listProductFiles(rootDir: string, dir: string = rootDir): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...listProductFiles(rootDir, full))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full.slice(rootDir.length + 1).replaceAll('\\', '/'))
    }
  }
  return out
}

const MOBILE_DIR = join(process.cwd(), 'src', 'mobile')
const APPS_DIR = join(process.cwd(), 'src', 'apps')
const COMPONENTS_DIR = join(process.cwd(), 'src', 'components')

const mobileFiles = listProductFiles(MOBILE_DIR)
const appsFiles = listProductFiles(APPS_DIR)
const componentFiles = listProductFiles(COMPONENTS_DIR)

function readSource(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), 'utf8')
}

/** 去掉块注释与行注释（`https://` 的 `//` 不算行注释）——注释里的类名/属性名讨论不参与盘点。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** backdrop 玻璃的两种载体：CSS 标准属性与 Tailwind 工具类（非全局：配 .test/.search 无 lastIndex 态）。 */
const BACKDROP = /backdrop-filter|backdrop-blur(-[a-z0-9]+)?/

/** 同上全局版：仅供 matchAll 计数（matchAll 克隆正则、不携带 lastIndex 态）。 */
const BACKDROP_GLOBAL = /backdrop-filter|backdrop-blur(-[a-z0-9]+)?/g

/** §0.3/§33.1 全部玻璃/纸面材质类名——移动作用域只允许前两种（见 ALLOWED_*）。 */
const GLASS_MATERIAL =
  /\b(surface-glass|glass-hint|glass-veil|panel-frost|glass-raise|glass-deep|glass-popover|dock-glass|window-glass-focus|popover-panel|widget-card|chrome-paper|panel-paper|os-tooltip)\b/g

/** 某文件（去注释后）命中的全部玻璃材质类名集合。 */
function glassMaterialsIn(dir: string, rel: string): Set<string> {
  const src = stripComments(readSource(dir, rel))
  return new Set([...src.matchAll(GLASS_MATERIAL)].map((m) => m[1]))
}

/** 文件 → 命中材质 的映射（合并三个移动可达目录，键相对 src/）。 */
function glassMaterialMap(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const scopes = [
    ['mobile', MOBILE_DIR, mobileFiles] as const,
    ['apps', APPS_DIR, appsFiles] as const,
    ['components', COMPONENTS_DIR, componentFiles] as const,
  ]
  for (const [prefix, dir, files] of scopes) {
    for (const rel of files) {
      const hits = glassMaterialsIn(dir, rel)
      if (hits.size > 0) map.set(`${prefix}/${rel}`, hits)
    }
  }
  return map
}

/*
 * 白名单钉扎清单（2026-10-12 盘点现状，DESIGN.md §35.1 五席位 ↔ 现行实现）：
 * - Dock 位：MobileDock（surface-glass + glass-raise，§35.7）
 * - Bottom Sheet 位：启动器/通知/控制中心/最近任务/Files 长按操作单五张同构
 *   sheet（surface-glass + glass-raise，§35.8/§35.9）
 * - Dialog 位：三张共享弹层（backdrop = backdrop-blur-sm，面板 = surface-glass；
 *   M3-4 起经 .mobile-shell [role='dialog'] 壳作用域进移动）
 * - Header 位（状态栏）与 Today 卡位：白名单允许 blur，现状实色零 blur
 *   （MobileStatusBar/TodayWorldCard 的实色口径由各自组件测试钉扎）。
 */
const ALLOWED_SURFACE_GLASS = [
  'mobile/dock/MobileDock.tsx',
  'mobile/launcher/MobileLauncher.tsx',
  'mobile/notifications/MobileNotificationSheet.tsx',
  'mobile/controlcenter/MobileControlCenterSheet.tsx',
  'mobile/recents/MobileRecentsSheet.tsx',
  'apps/files/FileActionSheet.tsx',
  'components/confirm-dialog.tsx',
  'components/permission-consent-dialog.tsx',
  'components/prompt-dialog.tsx',
].sort()

const ALLOWED_GLASS_RAISE = [
  'mobile/dock/MobileDock.tsx',
  'mobile/launcher/MobileLauncher.tsx',
  'mobile/notifications/MobileNotificationSheet.tsx',
  'mobile/controlcenter/MobileControlCenterSheet.tsx',
  'mobile/recents/MobileRecentsSheet.tsx',
  'apps/files/FileActionSheet.tsx',
].sort()

/** Dialog 席位：backdrop-blur-sm 只允许这三张共享弹层的遮罩各带一处。 */
const ALLOWED_BACKDROP_BLUR: Record<string, number> = {
  'components/confirm-dialog.tsx': 1,
  'components/permission-consent-dialog.tsx': 1,
  'components/prompt-dialog.tsx': 1,
}

describe('mobile glass whitelist audit (DESIGN.md §35.1, M4-5)', () => {
  it('盘点：移动 Shell 产品源零 backdrop 字串（玻璃只走白名单类，不写内联声明）', () => {
    const offenders: string[] = []
    for (const rel of mobileFiles) {
      const src = stripComments(readSource(MOBILE_DIR, rel))
      if (BACKDROP.test(src)) offenders.push(`src/mobile/${rel}`)
    }
    expect(
      offenders,
      `§35.1：移动 Shell 源码不得出现 backdrop-filter / backdrop-blur-* 字串（玻璃载体只能是白名单类 surface-glass/glass-raise）。越界文件：${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('盘点：共享应用面零 backdrop 字串，Dialog 席位三件套除外', () => {
    const offenders: string[] = []
    for (const rel of appsFiles) {
      const src = stripComments(readSource(APPS_DIR, rel))
      if (BACKDROP.test(src)) offenders.push(`src/apps/${rel}`)
    }
    expect(
      offenders,
      `§35.1：共享应用（移动全屏渲染）不得自带 blur 面；sheet 类玻璃走白名单类。越界文件：${offenders.join(', ')}`,
    ).toEqual([])

    for (const rel of componentFiles) {
      const count = [...stripComments(readSource(COMPONENTS_DIR, rel)).matchAll(BACKDROP_GLOBAL)]
        .length
      const allowed = ALLOWED_BACKDROP_BLUR[`components/${rel}`] ?? 0
      expect(
        count,
        `src/components/${rel} 的 backdrop 载体数必须等于 Dialog 席位清单（合法新增请更新 ALLOWED_BACKDROP_BLUR 并在 §35.1 留注记）`,
      ).toBe(allowed)
    }
  })

  it('钉扎玻璃类清单：surface-glass + glass-raise 只落在五席位组件，其余材质类零出现', () => {
    const map = glassMaterialMap()
    const allMaterials = new Set<string>()
    for (const hits of map.values()) for (const m of hits) allMaterials.add(m)
    expect(
      [...allMaterials].sort(),
      '移动可达面只允许 surface-glass（基底）与 glass-raise（raise 档）两种玻璃类；出现其他材质类即越界',
    ).toEqual(['glass-raise', 'surface-glass'])

    const filesWith = (material: string): string[] =>
      [...map.entries()]
        .filter(([, hits]) => hits.has(material))
        .map(([rel]) => rel)
        .sort()

    expect(
      filesWith('surface-glass'),
      'surface-glass 白名单清单（五席位：Dock + 五张 Bottom Sheet + 三张 Dialog）',
    ).toEqual(ALLOWED_SURFACE_GLASS)
    expect(
      filesWith('glass-raise'),
      'glass-raise 白名单清单（Dock + 五张 Bottom Sheet；Dialog 面板不带 raise 档）',
    ).toEqual(ALLOWED_GLASS_RAISE)
  })

  it('钉扎移动 CSS 段零 blur 声明（index.css 移动段到文件尾，M0 视觉纪律）', () => {
    // 先全文去注释再定位：段头注释自身写着「不引入 blur/backdrop-filter」——
    // 从注释中段切片会让剥离器吃不到未闭合的块注释开头。
    const stripped = stripComments(css)
    const sectionAt = stripped.indexOf('.mobile-shell {')
    expect(sectionAt, 'index.css 移动段（.mobile-shell 根类）存在').toBeGreaterThan(-1)
    const mobileSection = stripped.slice(sectionAt)
    expect(mobileSection, '移动段不得出现 backdrop 载体（布局作用域段，非玻璃材质）').not.toMatch(
      BACKDROP,
    )
    expect(mobileSection, '移动段不得出现任何 blur() 声明').not.toMatch(/blur\s*\(/)
  })

  it('钉扎移动玻璃唯一载体：surface-glass 基底 + glass-raise（blur 20px raise 档）', () => {
    // 移动侧全部玻璃经这两个类到达（上方用例钉消费端）；本用例钉供给端——
    // 类定义本身携带 backdrop-filter（§35.7/§35.8：Dock 与 sheet 同档 20px）。
    const baseAt = css.indexOf('.surface-glass {')
    const base = css.slice(baseAt, css.indexOf('}', baseAt))
    expect(base).toContain('backdrop-filter: blur(var(--ag-glass-blur))')

    const raiseAt = css.indexOf('.glass-raise {')
    const raise = css.slice(raiseAt, css.indexOf('}', raiseAt))
    expect(raise).toContain('backdrop-filter: blur(var(--ag-blur-md)) saturate(150%)')

    // raise 档实值 20px（§35.7 口径「blur 20px」；桌面七面阶梯见 index.css.test.ts）。
    const rootStart = css.indexOf(':root {')
    const root = css.slice(rootStart, css.indexOf('\n}', rootStart))
    expect(root).toMatch(/--ag-blur-md:\s*20px/)
  })
})

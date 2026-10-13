import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * M4-5 移动性能体检 · 冷加载探针（零新依赖，只钉扎现状）。
 *
 * 移动 context（360×800 iPhone 档）先在一个**前置 context** 里注册进
 * Home，把会话经 storageState 带进**全新被测 context**（HTTP 缓存为空、
 * 无 service worker）——`goto('/')` 直落 boot 覆盖层 → MobileShell
 * Home，即真机「装好后首开 / PWA 首启」的冷加载路径。同 context reload
 * 会命中 HTTP 缓存（实测 DCL 76ms，是复访口径不是冷加载），不用。
 *
 * Performance API 断言三件事：① domContentLoadedEventEnd；② 首帧 =
 * first-contentful-paint（Paint Timing）；③ PerformanceObserver longtask
 * 长任务计数兜底上限（粗粒度回归哨兵，不是严格帧预算）。
 *
 * 阈值定档纪律（不拍脑袋）：同机同构建连跑 3 次取**中位数 × 1.5**（50%
 * 余量），实测样本记在阈值上方注释与本切片 notes。本 spec describe 级
 * retries=2（全局 CI 才 1 次、本地 0）：性能断言对偶发机器抖动让一步，
 * 避免假红；阈值本身来自中位数，重试后仍超限即真回归。
 */

const IPHONE_UA
  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** 移动设备档（与 mobile-shell.spec 360×800 手动档同源，DPR 取 2）。 */
const MOBILE_DEVICE = {
  viewport: { width: 360, height: 800 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: IPHONE_UA,
} as const

/*
 * 阈值定档（2026-10-12 实测，Windows x64 门禁机 / Chromium / vite preview
 * 生产构建，storageState 冷加载 + 1s 沉降窗，样本见切片 notes）：
 *   空载（单 worker）3 次   dcl 105/97/100（中位 100） fcp 164/160/148（中位 160） longtask 0/0/0
 *   门禁态（2 worker 并行）3 次  dcl 126/115/185（中位 126） fcp 196/188/268（中位 196） longtask 2/1/2（单条最长 63ms）
 *   重载共存佐证 1 次（与 desktop-stress 同跑）dcl 169 fcp 240 longtask 2——未出门禁态样本带。
 * 定档 = 门禁态（探针真实执行环境）中位数 ×1.5 → dcl 189 / fcp 294 / 长任务 3，
 * 再按 50/100ms 网格向上取整换确定性：**200 / 300 / 3**。长任务无中位余量
 * 可让（中位 2 ×1.5 = 3），重试兜底由 describe 级 retries=2 承担。
 */
const DCL_LIMIT_MS = 200
const FCP_LIMIT_MS = 300
const LONGTASK_CAP = 3

/** 页内探针（addInitScript 每个文档重装）：longtask 计数 + FCP 捕获。 */
interface PerfProbe {
  longtasks: number
  longtaskMaxMs: number
  fcp: number | null
}

async function installPerfProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __agehaPerf?: PerfProbe }
    w.__agehaPerf = { longtasks: 0, longtaskMaxMs: 0, fcp: null }
    // longtask：Chromium 支持；不支持的引擎静默零计数（断言退化为恒过，
    // 门禁只跑 Chromium 项目，这里只是防御）。
    try {
      new PerformanceObserver((list) => {
        const probe = (window as unknown as { __agehaPerf?: PerfProbe }).__agehaPerf
        if (!probe) return
        for (const entry of list.getEntries()) {
          probe.longtasks += 1
          probe.longtaskMaxMs = Math.max(probe.longtaskMaxMs, entry.duration)
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      /* longtask unsupported */
    }
    // FCP：buffered 补发观察器安装前的 paint 条目。
    try {
      new PerformanceObserver((list) => {
        const probe = (window as unknown as { __agehaPerf?: PerfProbe }).__agehaPerf
        if (!probe) return
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') probe.fcp = entry.startTime
        }
      }).observe({ type: 'paint', buffered: true })
    } catch {
      /* paint timing unsupported */
    }
  })
}

/** 读回页内探针 + 导航计时（一次 evaluate 收齐）。 */
async function readProbe(page: Page): Promise<{ dcl: number | null } & PerfProbe> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | null
    const probe = (window as unknown as { __agehaPerf?: PerfProbe }).__agehaPerf
    return {
      dcl: nav ? nav.domContentLoadedEventEnd : null,
      longtasks: probe?.longtasks ?? 0,
      longtaskMaxMs: probe?.longtaskMaxMs ?? 0,
      fcp: probe?.fcp ?? null,
    }
  })
}

/** 前置：注册新账号到 Home（本地认证模式），返回携带会话的 storageState。 */
async function registerAndExportSession(browser: Browser) {
  const setupCtx = await browser.newContext({ ...MOBILE_DEVICE })
  const setupPage = await setupCtx.newPage()
  await setupPage.goto('/')
  const loginForm = setupPage.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await setupPage.getByRole('button', { name: '没有账户？创建一个' }).click()
  await setupPage.getByLabel('用户名').fill('e2emobileperf')
  await setupPage.getByLabel('密码').fill('secret123')
  await setupPage.getByRole('button', { name: '注册' }).click()
  await expect(setupPage.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })
  const storageState = await setupCtx.storageState()
  await setupCtx.close()
  return storageState
}

test.describe('mobile cold-load performance probe', () => {
  test.describe.configure({ retries: 2 })

  test('冷加载 Home：DCL/首帧在中位数×1.5 阈值内，长任务不破兜底上限', async ({ browser }) => {
    const storageState = await registerAndExportSession(browser)

    // 被测导航：全新 context（空 HTTP 缓存、无 SW）+ 会话，直落 Home。
    const coldCtx = await browser.newContext({ ...MOBILE_DEVICE, storageState })
    const page = await coldCtx.newPage()
    await installPerfProbe(page)
    await page.goto('/')
    await expect(page.locator('[data-shell="mobile"]')).toBeVisible({ timeout: 15_000 })
    await page
      .waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
      .catch(() => {
        /* 覆盖层不曾出现也立即通过（helpers 同口径） */
      })
    // 固定沉降窗：让长任务计数覆盖到 Home 就绪后的首秒（窗口恒定，保证
    // 三次样本口径一致）。
    await page.waitForTimeout(1_000)

    const probe = await readProbe(page)
    // 实测数据打点到报告（定档留痕；重跑时与阈值注释对照）。
    console.log(
      `[mobile-perf] dcl=${probe.dcl?.toFixed(0)}ms fcp=${probe.fcp?.toFixed(0)}ms `
      + `longtasks=${probe.longtasks} (max ${probe.longtaskMaxMs.toFixed(1)}ms) `
      + `limits dcl<${DCL_LIMIT_MS} fcp<${FCP_LIMIT_MS} longtask<=${LONGTASK_CAP}`,
    )

    // 探针自检：读数必须在场（Performance API 缺席 = 探针坏了，不是快）。
    expect(probe.dcl, 'navigation timing 可用').not.toBeNull()
    expect(probe.fcp, 'paint timing（FCP）可用').not.toBeNull()

    expect(probe.dcl!, `domContentLoaded < ${DCL_LIMIT_MS}ms`).toBeLessThan(DCL_LIMIT_MS)
    expect(probe.fcp!, `first-contentful-paint < ${FCP_LIMIT_MS}ms`).toBeLessThan(FCP_LIMIT_MS)
    expect(probe.longtasks, `longtask 计数 <= ${LONGTASK_CAP}（兜底上限）`).toBeLessThanOrEqual(
      LONGTASK_CAP,
    )

    // Home 真身在场：品牌头（性能之外的基本正确性，防「快但白屏」假绿）。
    await expect(page.getByTestId('mobile-shell-brand')).toHaveText('AgehaOS')

    await coldCtx.close()
  })
})

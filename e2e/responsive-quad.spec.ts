import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { revealTaskbar } from './helpers'

/**
 * 响应式收尾探针（Desktop Shell 3.0 STEP 10，docs/DESIGN.md §25 + §33.4 验收
 * 口径）：1280x720 / 1366x768 / 1920x1080 / 2560x1440 四个桌面分辨率实测
 * 几何——
 * ① 无横向 overflow；
 * ② 左侧 system-rails 窄轨（收起 72px 浮岛 / 垂直居中）与展开态 Workspace
 *    Panel（316px 内容 = token 324 - 8）都不撑爆视口；
 * ③ 右侧 Floating System Center 顶锚 48 / 右留白 20 / 底不越 Dock 带；
 * ④ Dock 胶囊 68px、离底 20px、水平居中、不越界；
 * ⑤ 窗口 launch 落点完整在工作区内，向左拖出屏幕后仍保有 ≥80px 可见带
 *    （MIN_VISIBLE_EDGE 契约）且可拖回工作区。
 * 断言全部来自 boundingBox 实测（禁心算 rem）；每档分辨率把全部读数写入
 * .tmp/responsive-probe/<WxH>.json + 全页截图留存证据（.tmp 永不提交）。
 */

const RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const

/** 几何证据（每档分辨率一份 JSON，探针逐段合并写入，失败也留已测段）。 */
type Evidence = Record<string, unknown>

function evidencePath(width: number, height: number): string {
  return join(process.cwd(), '.tmp', 'responsive-probe', `${width}x${height}.json`)
}

function writeEvidence(width: number, height: number, data: Evidence): void {
  mkdirSync(join(process.cwd(), '.tmp', 'responsive-probe'), { recursive: true })
  writeFileSync(evidencePath(width, height), JSON.stringify(data, null, 2))
}

async function box(page: Page, testId: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId(testId).boundingBox()
  expect(box, testId).not.toBeNull()
  return box!
}

async function registerDesktopAt(page: Page, username: string): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(600) // 开机层退场 + 桌面落定（window-resize 先例）。
}

for (const vp of RESOLUTIONS) {
  test.describe(`responsive quad ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`shell geometry stays inside the viewport and windows stay draggable (STEP 10)`, async ({
      page,
    }) => {
      const evidence: Evidence = {
        viewport: vp,
        capturedAt: new Date().toISOString(),
      }
      const record = async (key: string, data: Evidence): Promise<void> => {
        evidence[key] = data
        writeEvidence(vp.width, vp.height, evidence)
      }

      await registerDesktopAt(page, `quad-e2e-${vp.width}`)
      await revealTaskbar(page)

      // ① 无横向 overflow（滚动宽度不超视口）。
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement as HTMLElement | null
        return { scrollWidth: el?.scrollWidth ?? 0, clientWidth: el?.clientWidth ?? 0 }
      })
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
      await record('horizontalOverflow', overflow)

      // ② 窄轨收起态：left 16px / 宽 72px（token 80 - 0.5rem）+ 组容器 1px
      //    描边 ×2 = 实测 74 / 垂直居中 / 上下都在视口内。
      const rail = await box(page, 'system-rails')
      expect(rail.x).toBeGreaterThanOrEqual(15.5)
      expect(rail.x).toBeLessThanOrEqual(16.5)
      expect(rail.width).toBeGreaterThanOrEqual(72)
      expect(rail.width).toBeLessThanOrEqual(75)
      expect(Math.abs(rail.y + rail.height / 2 - vp.height / 2)).toBeLessThanOrEqual(1)
      expect(rail.y).toBeGreaterThanOrEqual(0)
      expect(rail.y + rail.height).toBeLessThanOrEqual(vp.height)
      await record('railCollapsed', rail)

      // ③ 展开态 Workspace Panel（click pin → Esc 收起）：宽 316px（token
      //    324 - 0.5rem）+ 描边 ×2，整组仍在视口内；内容列自身无横向溢出。
      await page.getByTestId('sidebar-brand').click()
      await expect(page.getByTestId('system-rails')).toHaveAttribute('data-expanded', 'true')
      await expect(page.getByTestId('workspace-panel')).toBeVisible()
      await expect
        .poll(async () => (await box(page, 'system-rails')).width, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(316)
      const expanded = await box(page, 'system-rails')
      expect(expanded.width).toBeLessThanOrEqual(320)
      expect(expanded.x).toBeGreaterThanOrEqual(15.5)
      expect(expanded.x + expanded.width).toBeLessThanOrEqual(vp.width + 0.5)
      expect(expanded.y).toBeGreaterThanOrEqual(0)
      expect(expanded.y + expanded.height).toBeLessThanOrEqual(vp.height)
      const panelScroll = await page.getByTestId('workspace-panel').evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        box: el.getBoundingClientRect().toJSON(),
      }))
      expect(panelScroll.scrollWidth).toBeLessThanOrEqual(panelScroll.clientWidth + 1)
      await record('railExpanded', { group: expanded, panel: panelScroll })

      await page.keyboard.press('Escape')
      await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')
      await expect
        .poll(async () => (await box(page, 'system-rails')).width, { timeout: 5_000 })
        .toBeLessThanOrEqual(75)

      // ④ 右侧 Floating System Center：顶锚 48（菜单栏 32 + 1rem）、右留白
      //    20（right-5）、底不越 Dock 带（视口 - 88）。
      const widgets = await box(page, 'widget-rail')
      expect(widgets.y).toBeGreaterThanOrEqual(47.5)
      expect(widgets.y).toBeLessThanOrEqual(48.5)
      const widgetsInset = vp.width - (widgets.x + widgets.width)
      expect(widgetsInset).toBeGreaterThanOrEqual(19.5)
      expect(widgetsInset).toBeLessThanOrEqual(20.5)
      expect(widgets.y + widgets.height).toBeLessThanOrEqual(vp.height - 88 + 1)
      await record('systemCenter', widgets)

      // ⑤ Dock：高 68（token）/ 离底 20（dock-gap）/ 水平居中 / 不越界。
      const dock = await page.locator('footer nav').boundingBox()
      expect(dock, 'dock capsule').not.toBeNull()
      expect(dock!.height).toBeGreaterThanOrEqual(67)
      expect(dock!.height).toBeLessThanOrEqual(69)
      expect(vp.height - (dock!.y + dock!.height)).toBeGreaterThanOrEqual(19.5)
      expect(vp.height - (dock!.y + dock!.height)).toBeLessThanOrEqual(20.5)
      expect(Math.abs(dock!.x + dock!.width / 2 - vp.width / 2)).toBeLessThanOrEqual(1)
      expect(dock!.x).toBeGreaterThanOrEqual(0)
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(vp.width)
      await record('dock', dock!)

      // ⑥ 窗口：launch 落点完整在工作区内（§33.4.1：左右浮轨之间 + Dock 带上方）。
      await page.getByTestId('dock-pin-com.ageha.files').click()
      const region = page.getByRole('region', { name: '文件' })
      await expect(region).toBeVisible({ timeout: 10_000 })
      await page.waitForTimeout(900) // 开窗飞行落定（waitFor 可见 ≠ 动画完成）。
      const initial = (await region.boundingBox())!
      expect(initial.x).toBeGreaterThanOrEqual(96) // 左浮轨带（16+80）右侧。
      expect(initial.y).toBeGreaterThanOrEqual(40)
      expect(initial.x + initial.width).toBeLessThanOrEqual(vp.width - 296 + 1) // 右栏左侧。
      expect(initial.y + initial.height).toBeLessThanOrEqual(vp.height - 88 + 1) // Dock 带上方。
      await record('windowInitial', initial)

      // ⑦ 向左拖出屏幕（指针拉到 x=2）：右缘仍 ≥ 80px（MIN_VISIBLE_EDGE——
      //    窗口不会整体丢失），再从可见残带抓回工作区（可拖回 viewport）。
      await page.mouse.move(initial.x + initial.width / 2, initial.y + 14)
      await page.mouse.down()
      await page.mouse.move(2, initial.y + 14, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(400)
      const pushedLeft = (await region.boundingBox())!
      expect(pushedLeft.x).toBeLessThan(initial.x - 100)
      expect(pushedLeft.x + pushedLeft.width).toBeGreaterThanOrEqual(80)
      expect(pushedLeft.y).toBeGreaterThanOrEqual(0)
      await record('windowPushedLeft', pushedLeft)

      // 拖回：抓可见残带右端（避开左浮轨带与 8 向柄），目标 x 居工作区内。
      const targetX = 112 + Math.max(0, (vp.width - 444 - pushedLeft.width) / 2)
      await page.mouse.move(pushedLeft.x + pushedLeft.width - 40, pushedLeft.y + 14)
      await page.mouse.down()
      await page.mouse.move(targetX + pushedLeft.width - 40, pushedLeft.y + 14, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(400)
      const restored = (await region.boundingBox())!
      expect(restored.x).toBeGreaterThanOrEqual(96)
      expect(restored.x + restored.width).toBeLessThanOrEqual(vp.width - 296 + 1)
      expect(restored.y + restored.height).toBeLessThanOrEqual(vp.height - 88 + 1)
      await record('windowRestored', restored)

      // 证据截图（.tmp 永不提交；spec 本身 = 可重放证据）。
      await page.screenshot({
        path: join(process.cwd(), '.tmp', 'responsive-probe', `${vp.width}x${vp.height}.png`),
      })
    })
  })
}

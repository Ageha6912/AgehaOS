import { expect, test, type Page } from '@playwright/test'

/**
 * 多窗口视觉 QA（Shell 3.1 STEP 6，任务书 §33-§34）：1/2/3/5 窗的 z 序、
 * 阴影双档、与 Dock/Workspace Panel/System Center 的冲突、关闭退场 ghost。
 * 全部断言来自 computed style / elementFromPoint / boundingBox 实测（禁止
 * 心算）；拖拽前置 dragWindowClearOfRails 手法（helpers.ts:58）。
 * 最大化盖 chrome 由 window-maximize.spec 覆盖，此处不重复。
 */

async function register(page: Page): Promise<void> {
  await page.goto('/')
  const loginForm = page.getByRole('form', { name: '登录 AgehaOS' })
  await expect(loginForm).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '没有账户？创建一个' }).click()
  await page.getByLabel('用户名').fill(`multiwin-${Date.now().toString(36)}`)
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '注册' }).click()
  await page.getByTestId('sidebar-desktop').waitFor({ timeout: 15_000 })
  await page.waitForSelector('[data-testid="boot-screen"]', { state: 'detached', timeout: 15_000 })
}

async function dragClearOfRails(page: Page, region: ReturnType<Page['getByRole']>): Promise<void> {
  const box = (await region.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 14)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + 14, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

async function dragTo(
  page: Page,
  region: ReturnType<Page['getByRole']>,
  x: number,
  y: number,
): Promise<void> {
  const box = (await region.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 14)
  await page.mouse.down()
  const steps = Math.max(6, Math.round(Math.max(Math.abs(x - box.x), Math.abs(y - box.y)) / 30))
  await page.mouse.move(x + box.width / 2, y + 14, { steps })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

/** 点标题栏聚焦并返回该窗 computed zIndex。 */
async function focusWindow(
  page: Page,
  region: ReturnType<Page['getByRole']>,
): Promise<string> {
  const box = (await region.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + 14)
  await page.waitForTimeout(300)
  return region.evaluate((el) => getComputedStyle(el).zIndex)
}

test.use({ viewport: { width: 1920, height: 1080 } })

test('5 窗：z 序随聚焦、阴影双档、Dock 不被盖、右栏可点、Panel 共存、ghost 退场', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await register(page)

  // 依次开 5 窗并阶梯摆位。摆位约束：① 窗口 move 有工作区钳制（x ≤
  // 1492、y+高 ≤ 984——launch.ts/manager 口径），目标点必须落在钳制区内；
  // ② 五扇标题栏互不重叠且不被更高 z 窗身体覆盖（拖动顺序 = 置顶顺序，
  // 最后拖的计算器 z 最大）：
  //   store   (932,170) 560×520 → 标题栏 y[170,214]
  //   terminal(240,180) 660×440 → y[180,224]
  //   notes   (250,380) 720×480 → y[380,424]
  //   files   (110,424) 880×560 → y[424,468]（y 被钳到 424）
  //   calculator(1000,400) 300×440 → y[400,444]
  const plan: Array<[string, string, number, number]> = [
    ['com.ageha.store', '应用商店', 932, 170],
    ['com.ageha.terminal', '终端', 240, 180],
    ['com.ageha.notes', '记事', 250, 380],
    ['com.ageha.files', '文件', 110, 424],
    ['com.ageha.calculator', '计算器', 1000, 400],
  ]
  const regions: Record<string, ReturnType<Page['getByRole']>> = {}
  for (const [appId, name, x, y] of plan) {
    await page.getByTestId(`dock-pin-${appId}`).click()
    const region = page.getByRole('region', { name })
    await expect(region).toBeVisible()
    await dragClearOfRails(page, region)
    await dragTo(page, region, x, y)
    regions[name] = region
  }

  // ① z 序：最后点击（计算器）的 zIndex 全场最大。
  const calcZ = await focusWindow(page, regions['计算器']!)
  for (const name of ['文件', '记事', '终端', '应用商店']) {
    const z = await regions[name]!.evaluate((el) => getComputedStyle(el).zIndex)
    expect(Number(z)).toBeLessThan(Number(calcZ))
  }

  // ② 阴影双档在 5 窗下仍成立：active = 空间聚焦档（--sp-shadow-window-
  //    active），其余 = 空间基底档（--sp-shadow-window）——2026-10-10 空间化
  //    窗口切片换档，聚焦恒比失焦更深更沉的层级语义不变。
  const shadowOf = (name: string) =>
    regions[name]!.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(await shadowOf('计算器')).toContain('0px 52px 136px')
  for (const name of ['文件', '记事', '终端', '应用商店']) {
    expect(await shadowOf(name)).toContain('0px 24px 72px')
  }

  // ③ Dock 不被普通窗盖：Dock 中心 elementFromPoint 命中 Dock 子树。
  const dockHit = await page.evaluate(() => {
    const nav = document.querySelector('footer nav')
    const box = nav!.getBoundingClientRect()
    const el = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return nav!.contains(el!)
  })
  expect(dockHit).toBe(true)

  // ④ 右栏三卡（时钟/系统/通知）在 5 窗下仍有可点击区。
  const cards = await page.evaluate(() => {
    const out: Record<string, boolean> = {}
    for (const id of ['widgets-clock', 'widgets-system', 'widgets-notifications']) {
      const card = document.querySelector(`[data-testid="${id}"]`)
      if (!card) continue
      const box = card.getBoundingClientRect()
      out[id] = card.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }
    return out
  })
  expect(Object.values(cards).every(Boolean)).toBe(true)

  // ⑤ Workspace Panel 有窗时 hover 展开/收起不顶走窗口、收起后可点、
  //    多窗 branding faint（0.15）正确。
  const notesBox0 = (await regions['记事']!.boundingBox())!
  await page.getByTestId('sidebar').hover()
  await expect(page.getByTestId('system-rails')).toHaveAttribute('data-expanded', 'true')
  const brandDuring = await page
    .getByTestId('desktop-branding')
    .evaluate((el) => getComputedStyle(el).opacity)
  expect(brandDuring).toBe('0.15')
  await page.waitForTimeout(500)
  const notesBox1 = (await regions['记事']!.boundingBox())!
  expect(notesBox1.x).toBe(notesBox0.x)
  expect(notesBox1.y).toBe(notesBox0.y)
  await page.mouse.move(960, 900)
  await expect(page.getByTestId('system-rails')).not.toHaveAttribute('data-expanded', 'true')
  await page.waitForTimeout(400)
  // 收起后最顶层窗（计算器，① 已证 z 最大）标题栏立即可点（指针不被
  // 面板收起动画/任何残层截胡）。
  const calcBox = (await regions['计算器']!.boundingBox())!
  const calcClickable = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return el?.closest('section[aria-label="计算器"]') !== null
  }, [calcBox.x + calcBox.width / 2, calcBox.y + 14])
  expect(calcClickable).toBe(true)

  // ⑥ 关闭最顶层计算器窗：ghost 600ms 内退场，其原身体区域（曾盖住
  //    文件/记事窗的 [1000,1300] 带）露出下层且不截胡点击。
  await regions['计算器']!.getByRole('button', { name: '关闭窗口' }).click()
  await expect(regions['计算器']).toHaveCount(0)
  await page.waitForTimeout(700)
  const exposed = await page.evaluate(() => {
    const el = document.elementFromPoint(1150, 420)
    const section = el?.closest('section')
    return { label: section?.getAttribute('aria-label') ?? '', tag: el?.tagName ?? '' }
  })
  expect(exposed.label).not.toBe('计算器')
  // LI：底层窗口内容即列表项（应用商店列表，M3-4 窄容器适配后卡片列表项
  // 恰好落在该点位）——白名单语义是「露出的是底层 UI 本体而非残层」，
  // 列表项与既有 UL 同属合法底层元素。
  expect(['DIV', 'SECTION', 'MAIN', 'UL', 'LI', 'P', 'SPAN', 'HEADER', 'BUTTON']).toContain(
    exposed.tag,
  )
})

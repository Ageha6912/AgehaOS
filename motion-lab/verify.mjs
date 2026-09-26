#!/usr/bin/env node
/* ==========================================================================
 * motion-lab/verify.mjs — AgehaOS 动效实验室 · 浏览器验证脚本
 * --------------------------------------------------------------------------
 * 用法（仓库根目录执行）：
 *   node motion-lab/verify.mjs
 *
 * 做什么：
 *   1. 对 motion-lab/ 下每一个演示页面（含演示中心）用 file:// 协议在
 *      Chromium（headless）中打开，断言【零 console.error / 零 pageerror】；
 *   2. 对四个核心模块断言关键行为：
 *      · boot      → 6 秒内出现 data-boot="complete"，且 window.AgehaBoot
 *                    的 onBootProgress / onBootComplete / skip 三个方法存在；
 *      · dock      → 指针进入并移动后，某图标 tile 的 style.transform
 *                    发生变化（波浪确实在写合成层属性）；
 *      · menu-toast→ 触发下拉菜单后菜单可见（另加通知冒烟）；
 *      · window    → 点击「打开新窗」按钮后，出现新的可见窗口元素。
 *   3. 全部通过：打印 PASS 清单并以退出码 0 结束；
 *      任何失败：打印清晰失败清单并以退出码 1 结束。
 *
 * 约束：本脚本零外部网络依赖（只 import 仓库已装的 playwright，页面一律
 *   file:// 打开）；不修改任何模块实现，只做只读验证。
 * ========================================================================== */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------------------
 * 待验证页面清单（相对 motion-lab/ 的路径 + 可选的关键行为检查）
 * ------------------------------------------------------------------------- */
const PAGES = [
  { name: 'hub（演示中心）', file: 'index.html' },
  { name: 'boot（开机启动动画）', file: 'boot/index.html', check: 'boot' },
  { name: 'window（窗口生命周期）', file: 'window/index.html', check: 'window' },
  { name: 'dock（Dock 放大波浪）', file: 'dock/index.html', check: 'dock' },
  { name: 'menu-toast（菜单与通知）', file: 'menu-toast/index.html', check: 'menu-toast' },
  { name: 'enhance-basic（基础增强组合页）', file: 'enhance-basic/index.html' },
  { name: 'enhance-advanced（进阶炫技组合页）', file: 'enhance-advanced/index.html' },
  { name: 'enhance-advanced/parallax（视差景深）', file: 'enhance-advanced/parallax/index.html' },
  { name: 'enhance-advanced/aurora（流光氛围）', file: 'enhance-advanced/aurora/index.html' },
  { name: 'enhance-advanced/window-tilt（窗口转场）', file: 'enhance-advanced/window-tilt/index.html' },
  { name: 'enhance-advanced/dock-sheen（Dock 扫光）', file: 'enhance-advanced/dock-sheen/index.html' },
  { name: 'enhance-advanced/theme-glow（光晕呼吸）', file: 'enhance-advanced/theme-glow/index.html' },
];

/* ---------------------------------------------------------------------------
 * 关键行为检查（每项返回失败原因字符串；通过则返回 null）
 * ------------------------------------------------------------------------- */

/** boot：6s 内 data-boot="complete" + window.AgehaBoot 三方法齐全 */
async function checkBoot(page) {
  try {
    await page.waitForSelector('[data-boot="complete"]', { timeout: 6000 });
  } catch {
    return '6 秒内未出现 data-boot="complete"（开机流程未完成）';
  }
  const api = await page.evaluate(() => {
    const b = window.AgehaBoot;
    if (!b) return null;
    return {
      progress: typeof b.onBootProgress === 'function',
      complete: typeof b.onBootComplete === 'function',
      skip: typeof b.skip === 'function',
    };
  });
  if (!api) return 'window.AgehaBoot 不存在';
  const missing = Object.entries(api).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) return `window.AgehaBoot 缺少方法：${missing.join('、')}`;
  return null;
}

/** dock：指针进入 Dock 并移动后，某图标 tile 的 style.transform 发生变化 */
async function checkDock(page) {
  const dock = page.locator('#dock');
  const box = await dock.boundingBox();
  if (!box) return '未找到 #dock 元素';
  // 悬停到 Dock 中部再小幅移动，触发 pointerenter/pointermove（波浪起势 150ms）
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 4 });
  await page.waitForTimeout(400); // 等待 rAF 写入若干帧（enterMs=150 + 余量）
  const moved = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('#dock .dock-icon__tile'));
    return tiles.filter((t) => (t.style.transform || '').length > 0).length;
  });
  if (!moved) return '指针进入并移动后，没有任何 .dock-icon__tile 的 style.transform 发生变化';
  return null;
}

/** menu-toast：点击触发按钮后下拉菜单可见；再发一条通知冒烟 */
async function checkMenuToast(page) {
  await page.click('#menuFileBtn');
  try {
    await page.waitForSelector('#popFile', { state: 'visible', timeout: 2000 });
  } catch {
    return '点击 #menuFileBtn 后 #popFile 菜单不可见';
  }
  await page.keyboard.press('Escape'); // 收起菜单，避免遮挡后续点击
  await page.click('#notifyBtn');
  try {
    await page.waitForSelector('#toastLayer .ml-toast', { state: 'visible', timeout: 2000 });
  } catch {
    return '点击 #notifyBtn 后通知卡片未出现';
  }
  return null;
}

/** window：点击「打开新窗」后，打开的窗口数量增加且新窗口元素在场
 *  （模块初始 DOM 三窗都在场，故以模块自己的状态机信号——Dock 图标
 *  aria-pressed，由 syncDots 依窗口有效状态写入——判定「已打开」）。 */
async function checkWindow(page) {
  // 等待模块自身的自动演示（400ms 后自动打开第一扇窗）落定
  await page.waitForTimeout(900);
  const openApps = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.dock-icon[aria-pressed="true"]')).map((el) => el.dataset.app),
    );
  const before = await openApps();
  await page.click('#btn-open');
  try {
    await page.waitForFunction(
      (n) => document.querySelectorAll('.dock-icon[aria-pressed="true"]').length > n,
      before.length,
      { timeout: 2000 },
    );
  } catch {
    return `点击 #btn-open 后打开的窗口数量未从 ${before.length} 增加`;
  }
  const after = await openApps();
  const opened = after.find((app) => !before.includes(app));
  const newlyVisible = await page.locator(`.win[data-app="${opened}"]`).isVisible();
  if (!newlyVisible) return `新打开的窗口 .win[data-app="${opened}"] 不可见`;
  return null;
}

const CHECKS = { boot: checkBoot, window: checkWindow, dock: checkDock, 'menu-toast': checkMenuToast };

/* ---------------------------------------------------------------------------
 * 主流程
 * ------------------------------------------------------------------------- */
async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    console.error('[verify] 无法启动 Chromium（可尝试 `npx playwright install chromium`）：');
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }

  const context = await browser.newContext({
    // 显式声明「无减少动态偏好」，保证动效全量运行（降级路径另由系统开关手工验证）
    reducedMotion: 'no-preference',
    viewport: { width: 1280, height: 800 },
  });

  const results = []; // { name, file, ok, errors: [] }
  let failed = false;

  for (const item of PAGES) {
    const url = pathToFileURL(path.join(HERE, item.file)).href;
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

    const entry = { name: item.name, file: item.file, ok: true, errors: [] };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      // 给一次性入场/自动演示动画留出时间，之后再开始按行为检查
      await page.waitForTimeout(item.check ? 0 : 500);

      if (consoleErrors.length) {
        entry.ok = false;
        entry.errors.push(...consoleErrors.map((t) => `console.error: ${t}`));
      }
      if (pageErrors.length) {
        entry.ok = false;
        entry.errors.push(...pageErrors.map((t) => `pageerror: ${t}`));
      }

      if (item.check && entry.ok) {
        const reason = await CHECKS[item.check](page);
        if (reason) {
          entry.ok = false;
          entry.errors.push(`行为检查失败：${reason}`);
        }
      }
    } catch (err) {
      entry.ok = false;
      entry.errors.push(`页面加载/执行异常：${String(err && err.message ? err.message : err)}`);
    } finally {
      await page.close();
    }

    if (!entry.ok) failed = true;
    results.push(entry);
  }

  await browser.close();

  /* ---- 结果报告 ---- */
  console.log('==========================================================');
  console.log(' AgehaOS 动效实验室 · 浏览器验证报告');
  console.log('==========================================================');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.file})`);
    for (const e of r.errors) console.log(`      - ${e}`);
  }
  console.log('----------------------------------------------------------');
  const passed = results.filter((r) => r.ok).length;
  console.log(`合计：${passed}/${results.length} 页通过。`);
  console.log(failed ? '结果：FAIL（存在失败项，见上表）' : '结果：PASS（全部通过）');
  process.exit(failed ? 1 : 0);
}

main();

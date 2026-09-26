/**
 * ============================================================================
 * motion-lab/enhance-advanced/tests/smoke.mjs — 进阶炫技档 · 运行时冒烟测试
 * ----------------------------------------------------------------------------
 * 依赖仓库 devDependencies 中的 Playwright（浏览器已安装于 %LOCALAPPDATA%/ms-playwright）。
 * 运行：node tests/smoke.mjs
 * 覆盖静态检查做不到的运行时行为：
 *   A. 六个页面（组合页 + 5 个独立页）file:// 加载零报错（pageerror/console.error）；
 *   B. 独立页默认启用各自的动效（句柄/类/动画名符合预期）；
 *   C. 组合页：默认开关状态、开关切换、视差位移系数、窗口焦点切换
 *      （点击 + 键盘 Tab 两条路径）、主题切换联动、Dock 扫光动画挂载；
 *   D. prefers-reduced-motion: reduce 降级：无新增 rAF 循环、CSS 动画卸载、
 *      窗口仅 opacity 交叉淡化、降级提示点亮。
 * ============================================================================
 */
'use strict';

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (rel) => 'file:///' + path.join(ROOT, rel).split(path.sep).join('/');

let passed = 0;
let failed = 0;
function ok(name) { passed++; console.log('  \u2713 ' + name); }
function fail(name, err) {
  failed++;
  console.error('  \u2717 ' + name + ' \u2014\u2014 ' + (err && err.message ? err.message.split('\n')[0] : err));
}
async function step(name, fn) {
  try { await fn(); ok(name); } catch (err) { fail(name, err); }
}

/** 给页面挂上错误收集器 */
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return errors;
}

/** 点击控制面板里指定标题的效果开关 */
async function toggleEffect(page, title, on) {
  const label = page.locator('label.mlc-switch', { hasText: title });
  const checked = await label.locator('input').isChecked();
  if (checked !== on) await label.click();
  return label.locator('input');
}

const browser = await chromium.launch();

/* ============ A/B：六个页面加载 + 独立页默认态 ============ */
console.log('\n[A/B] 页面加载与独立页默认态');
{
  const standaloneChecks = {
    'index.html': async (page) => {
      await step('组合页：MLAdvanced 注册 5 个效果句柄', async () => {
        const keys = await page.evaluate(() => Object.keys(window.MLAdvanced || {}));
        assert.deepEqual(keys.sort(), ['aurora', 'dock', 'glow', 'parallax', 'windows']);
      });
      await step('组合页：默认视差启用（层已挂 will-change）', async () => {
        const wc = await page.evaluate(() => document.querySelector('.mlp-layer--far').style.willChange);
        assert.equal(wc, 'transform');
      });
      await step('组合页：默认光晕启用（呼吸动画已挂载）', async () => {
        const name = await page.evaluate(() => getComputedStyle(document.querySelector('.mlg-glow')).animationName);
        assert.equal(name, 'mlg-breathe');
      });
      await step('组合页：默认流光关闭（canvas 透明）', async () => {
        const op = await page.evaluate(() => getComputedStyle(document.querySelector('.mla-canvas')).opacity);
        assert.equal(parseFloat(op), 0);
      });
      await step('组合页：默认扫光关闭', async () => {
        const on = await page.evaluate(() => document.querySelector('.mld-dock').classList.contains('is-sheen-on'));
        assert.equal(on, false);
      });
      await step('组合页：开关勾选态与默认一致（视差/光晕勾选）', async () => {
        const state = await page.evaluate(() => {
          const get = (k) => document.querySelector(`[data-ml-toggle="${k}"]`).checked;
          return { parallax: get('parallax'), aurora: get('aurora'), windows: get('windows'), dock: get('dock'), glow: get('glow') };
        });
        assert.deepEqual(state, { parallax: true, aurora: false, windows: false, dock: false, glow: true });
      });
    },
    'parallax/index.html': async (page) => {
      await step('独立视差页：默认启用并挂 will-change', async () => {
        const wc = await page.evaluate(() => document.querySelector('.mlp-layer--near').style.willChange);
        assert.equal(wc, 'transform');
      });
    },
    'aurora/index.html': async (page) => {
      await page.waitForTimeout(400); // 等开关淡入过渡结束
      await step('独立流光页：默认启用（整体透明度 = 浅色档 0.2）', async () => {
        const op = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.mla-canvas')).opacity));
        assert.ok(Math.abs(op - 0.2) < 0.02, 'opacity=' + op);
      });
    },
    'window-tilt/index.html': async (page) => {
      await step('独立窗口页：首窗口默认聚焦、次窗口失焦降透明', async () => {
        const s = await page.evaluate(() => {
          const wins = [...document.querySelectorAll('.mtw')];
          return {
            aFocused: wins[0].classList.contains('is-focused'),
            bDim: parseFloat(getComputedStyle(wins[1]).opacity),
          };
        });
        assert.equal(s.aFocused, true);
        assert.ok(Math.abs(s.bDim - 0.86) < 0.02, 'dim=' + s.bDim);
      });
    },
    'dock-sheen/index.html': async (page) => {
      await step('独立扫光页：默认启用（::after 挂载 mlds-sweep 动画）', async () => {
        const name = await page.evaluate(() => getComputedStyle(document.querySelector('.mld-dock'), '::after').animationName);
        assert.equal(name, 'mlds-sweep');
      });
    },
    'theme-glow/index.html': async (page) => {
      await step('独立光晕页：默认启用（mlg-breathe 已挂载）', async () => {
        const name = await page.evaluate(() => getComputedStyle(document.querySelector('.mlg-glow')).animationName);
        assert.equal(name, 'mlg-breathe');
      });
    },
  };
  for (const [rel, checks] of Object.entries(standaloneChecks)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = collectErrors(page);
    await page.goto(url(rel), { waitUntil: 'load' });
    await checks(page);
    await step(`${rel} 加载零报错`, async () => {
      assert.deepEqual(errors, [], errors.join(' | '));
    });
    await page.close();
  }
}

/* ============ C：组合页交互行为 ============ */
console.log('\n[C] 组合页交互行为');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page);
  await page.goto(url('index.html'), { waitUntil: 'load' });

  await step('视差：三层位移系数严格递减（远 < 中 < 近）', async () => {
    await page.mouse.move(200, 200);
    await page.mouse.move(1050, 600, { steps: 6 });
    await page.waitForTimeout(260); // 插值收敛
    const tx = await page.evaluate(() =>
      ['.mlp-layer--far', '.mlp-layer--mid', '.mlp-layer--near'].map((sel) => {
        const t = getComputedStyle(document.querySelector(sel)).transform;
        return new DOMMatrixReadOnly(t === 'none' ? '' : t).m41;
      })
    );
    assert.ok(Math.abs(tx[2]) > Math.abs(tx[1]) && Math.abs(tx[1]) > Math.abs(tx[0]) && Math.abs(tx[0]) > 0,
      `far=${tx[0]} mid=${tx[1]} near=${tx[2]}`);
  });

  await step('视差：关闭开关后缓退归位并摘除 will-change', async () => {
    await toggleEffect(page, '壁纸视差景深', false);
    await page.waitForTimeout(450); // drainMs=220 + 余量
    const s = await page.evaluate(() => ({
      transform: document.querySelector('.mlp-layer--far').style.transform,
      wc: document.querySelector('.mlp-layer--far').style.willChange,
    }));
    assert.equal(s.transform, '');
    assert.equal(s.wc, '');
  });

  await step('流光：开启后 canvas 淡入到浅色档透明度', async () => {
    await toggleEffect(page, '流光渐变氛围', true);
    await page.waitForTimeout(400);
    const op = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.mla-canvas')).opacity));
    assert.ok(Math.abs(op - 0.2) < 0.02, 'opacity=' + op);
  });

  await step('窗口：点击切换焦点（点击路径）', async () => {
    await toggleEffect(page, '窗口切换转场', true);
    await page.locator('.mtw').nth(1).click();
    await page.waitForTimeout(400); // 激活动画 250ms + 余量
    const s = await page.evaluate(() => {
      const wins = [...document.querySelectorAll('.mtw')];
      return {
        bFocused: wins[1].classList.contains('is-focused'),
        aOp: parseFloat(getComputedStyle(wins[0]).opacity),
        bOp: parseFloat(getComputedStyle(wins[1]).opacity),
        bActivating: wins[1].classList.contains('is-activating'),
      };
    });
    assert.equal(s.bFocused, true);
    assert.ok(Math.abs(s.aOp - 0.86) < 0.02, 'A opacity=' + s.aOp);
    assert.equal(s.bOp, 1);
    assert.equal(s.bActivating, false, '动画结束后应摘除 is-activating');
  });

  await step('窗口：键盘 Tab 切换焦点（键盘路径）+ tilt ≤2deg', async () => {
    // Chromium 的 Tab 起始点停留在上一个焦点元素之后，这里先聚焦窗口 A
    // 作为真实 Tab 起点，再按一次 Tab 移到窗口 B（focusin 驱动同一激活逻辑）
    await page.evaluate(() => document.querySelectorAll('.mtw')[0].focus());
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => {
      const wins = [...document.querySelectorAll('.mtw')];
      return {
        activeIsB: document.activeElement === wins[1],
        bFocused: wins[1].classList.contains('is-focused'),
        aFocused: wins[0].classList.contains('is-focused'),
        ry: wins[1].style.getPropertyValue('--mtw-ry'),
      };
    });
    assert.equal(s.activeIsB, true);
    assert.equal(s.bFocused, true);
    assert.equal(s.aFocused, false);
    assert.ok(s.ry !== '', '应写入倾斜方向变量');
    assert.ok(Math.abs(parseFloat(s.ry)) <= 2, 'rotateY 幅度必须 ≤2deg');
  });

  await step('扫光：开启后 ::after 挂载循环动画', async () => {
    await toggleEffect(page, 'Dock 高光扫过', true);
    const name = await page.evaluate(() => getComputedStyle(document.querySelector('.mld-dock'), '::after').animationName);
    assert.equal(name, 'mlds-sweep');
  });

  await step('主题：一键切深色（ml-dark + 流光/光晕联动换装）', async () => {
    await page.locator('[data-ml-theme-btn]').click();
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({
      dark: document.documentElement.classList.contains('ml-dark'),
      auroraOp: parseFloat(getComputedStyle(document.querySelector('.mla-canvas')).opacity),
      glowColor: getComputedStyle(document.querySelector('.mlg-glow')).getPropertyValue('--mlg-color'),
    }));
    assert.equal(s.dark, true);
    assert.ok(Math.abs(s.auroraOp - 0.34) < 0.02, '深色流光 opacity=' + s.auroraOp);
    assert.ok(s.glowColor.includes('130'), '深色光斑色应取 --ml-primary-dark 族：' + s.glowColor);
  });

  await step('组合页全程零报错', async () => {
    assert.deepEqual(errors, [], errors.join(' | '));
  });

  await page.close();
}

/* ============ D：prefers-reduced-motion 降级 ============ */
console.log('\n[D] prefers-reduced-motion 降级');
{
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  await page.goto(url('index.html'), { waitUntil: 'load' });

  await step('降级：视差保持静态（不挂 will-change、不写位移）', async () => {
    await page.mouse.move(1050, 600, { steps: 4 });
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => ({
      wc: document.querySelector('.mlp-layer--far').style.willChange,
      transform: getComputedStyle(document.querySelector('.mlp-layer--far')).transform,
    }));
    assert.equal(s.wc, '');
    assert.equal(s.transform, 'none');
  });

  await step('降级：开启流光不启动 rAF 循环（静态一帧）', async () => {
    await page.evaluate(() => {
      window.__rafCount = 0;
      const raw = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__rafCount++; return raw(cb); };
    });
    await toggleEffect(page, '流光渐变氛围', true);
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => window.__rafCount);
    assert.equal(n, 0, 'reduce 下不应有新增 rAF 调用');
    const op = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.mla-canvas')).opacity));
    assert.ok(op > 0.1, '静态氛围帧仍在场（opacity=' + op + '）');
  });

  await step('降级：扫光与呼吸的 CSS 动画被卸载', async () => {
    await toggleEffect(page, 'Dock 高光扫过', true);
    await toggleEffect(page, '主题氛围光晕', true);
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({
      sweep: getComputedStyle(document.querySelector('.mld-dock'), '::after').animationName,
      breathe: getComputedStyle(document.querySelector('.mlg-glow')).animationName,
    }));
    assert.equal(s.sweep, 'none');
    assert.equal(s.breathe, 'none');
  });

  await step('降级：窗口仅 opacity 交叉淡化（无 transform/倾斜）', async () => {
    await toggleEffect(page, '窗口切换转场', true);
    await page.locator('.mtw').nth(1).click();
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const wins = [...document.querySelectorAll('.mtw')];
      return {
        bFocused: wins[1].classList.contains('is-focused'),
        bTransform: getComputedStyle(wins[1]).transform,
        bDur: getComputedStyle(wins[0]).transitionDuration,
      };
    });
    assert.equal(s.bFocused, true);
    assert.equal(s.bTransform, 'none');
    assert.equal(s.bDur, '0.12s', '失焦淡化应保留 120ms opacity 过渡');
  });

  await step('降级：提示条点亮', async () => {
    const hidden = await page.evaluate(() => document.querySelector('[data-ml-reduced-note]').hidden);
    assert.equal(hidden, false);
  });

  await step('降级模式全程零报错', async () => {
    assert.deepEqual(errors, [], errors.join(' | '));
  });

  await ctx.close();
}

await browser.close();
console.log(`\n===== 运行时冒烟：${passed} 项通过，${failed} 项失败 =====`);
process.exit(failed ? 1 : 0);

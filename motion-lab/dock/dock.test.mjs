/* ==========================================================================
 * motion-lab/dock/dock.test.mjs — Dock 模块验证脚本（Node 内置 test runner）
 * --------------------------------------------------------------------------
 * 运行：node --test motion-lab/dock/dock.test.mjs
 * 本文件是开发期验证工具，不属于演示本体（双击 index.html 不受影响）。
 * 覆盖两类断言：
 *   1) 数学函数：贝塞尔插值、高斯衰减、包络合成（直接调用 dock.js 导出的纯函数）；
 *   2) 静态审计：性能铁律（时长档 / 只动 transform·opacity / 无逐帧布局读取）、
 *      零外部网络依赖、令牌同源、降级说明齐备。
 * ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(here, 'index.html'), 'utf8');
const css = readFileSync(join(here, 'dock.css'), 'utf8');
const js = readFileSync(join(here, 'dock.js'), 'utf8');
const tokensPath = join(here, '..', 'shared', 'tokens.css');
const tokens = readFileSync(tokensPath, 'utf8');

/* dock.js 以经典 <script> 交付（仓库 package.json 为 "type": "module"，不能走
 * require/esm 导入，也不给交付文件塞测试钩子）。这里用 new Function 包裹求值，
 * 附加 return 把顶部常量与纯函数带出来供断言。 */
const factory = new Function(
  js + '\n;return { PARAMS, cubicBezierAt, gaussianScale, iconScale };'
);
const { PARAMS, cubicBezierAt, gaussianScale, iconScale } = factory();

/* 去掉注释后的 CSS/JS 源码：用于字面量审计，避免注释里的措辞（如 SPEC 术语
 * 「跟随 0ms」、box-shadow 等）干扰扫描。 */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* --------------------------------------------------------------------------
 * 1. 数学函数
 * ------------------------------------------------------------------------ */

test('贝塞尔曲线：端点精确、中点呈强减速特征（快出缓收）', () => {
  const ease = PARAMS.ease; // [0.2, 0, 0, 1] ←→ 令牌 --ml-ease-standard
  assert.equal(cubicBezierAt(ease, 0), 0);
  assert.equal(cubicBezierAt(ease, 1), 1);
  // x=50% 时间应完成约 88% 路径（强减速曲线的签名）
  const mid = cubicBezierAt(ease, 0.5);
  assert.ok(mid > 0.86 && mid < 0.9, `中点进度 ${mid} 应在 (0.86, 0.9)`);
});

test('贝塞尔曲线：全程单调不减（不会倒退）', () => {
  let prev = -Infinity;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const y = cubicBezierAt(PARAMS.ease, Math.min(t, 1));
    assert.ok(y >= prev - 1e-9, `t=${t.toFixed(2)} 处出现回退`);
    prev = y;
  }
});

test('高斯衰减：波峰=上限，远端趋近 1，σ 防御为 0 不产生 NaN', () => {
  const { maxScale, falloffRadius } = PARAMS;
  assert.equal(gaussianScale(0, falloffRadius, maxScale), maxScale);
  const near = gaussianScale(falloffRadius, falloffRadius, maxScale); // 1σ 处
  assert.ok(near > 1.3 && near < maxScale, `1σ 处 ${near.toFixed(3)} 应显著参与`);
  const far = gaussianScale(falloffRadius * 3, falloffRadius, maxScale); // 3σ 处
  assert.ok(far < 1.01, `3σ 处 ${far.toFixed(4)} 应几乎回落到 1`);
  assert.equal(gaussianScale(100, 0, maxScale), 1); // σ=0 防御：完全不放大
  assert.ok(Number.isFinite(gaussianScale(1e6, 68, maxScale)));
});

test('包络合成：influence 0 时恒等、1 时全波形、中间线性缩幅、超界收敛', () => {
  assert.equal(iconScale(0, 0, PARAMS), 1);
  assert.equal(iconScale(0, 1, PARAMS), PARAMS.maxScale);
  assert.equal(iconScale(0, 0.5, PARAMS), 1 + (PARAMS.maxScale - 1) * 0.5);
  assert.equal(iconScale(0, 2, PARAMS), PARAMS.maxScale);  // 上界钳制
  assert.equal(iconScale(0, -1, PARAMS), 1);               // 下界钳制
  assert.ok(iconScale(9999, 1, PARAMS) < 1.01);            // 远端趋近 1
});

/* --------------------------------------------------------------------------
 * 2. 静态审计：性能铁律与规范符合性（SPEC §3 / §6）
 * ------------------------------------------------------------------------ */

test('语法检查：dock.js 通过 node --check', () => {
  const r = spawnSync(process.execPath, ['--check', join(here, 'dock.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || 'node --check 失败');
});

test('三文件齐备且零外部网络依赖（字体/CDN/图标库）', () => {
  for (const [name, text] of [['index.html', html], ['dock.css', css], ['dock.js', js]]) {
    assert.ok(text.length > 0, `${name} 为空`);
    assert.doesNotMatch(text, /https?:\/\//, `${name} 含外部网络引用`);
  }
});

test('dock.css 第一行引用共享令牌，且令牌文件存在', () => {
  assert.equal(css.split('\n')[0].trim(), '@import "../shared/tokens.css";');
  assert.ok(tokens.includes('--ml-ease-standard'), 'tokens.css 缺少 --ml-ease-standard');
});

test('dock.js 的 ease 与令牌 --ml-ease-standard 同源（数值一致）', () => {
  const m = tokens.match(/--ml-ease-standard:\s*cubic-bezier\(([^)]+)\)/);
  assert.ok(m, 'tokens.css 中未找到 --ml-ease-standard');
  const tokenPts = m[1].split(',').map((s) => parseFloat(s.trim()));
  assert.deepEqual(PARAMS.ease, tokenPts);
});

test('时长铁律：JS 过渡参数全部落在 150~300ms 档', () => {
  assert.ok(PARAMS.enterMs >= 150 && PARAMS.enterMs <= 300, `enterMs=${PARAMS.enterMs}`);
  assert.ok(PARAMS.settleMs >= 150 && PARAMS.settleMs <= 300, `settleMs=${PARAMS.settleMs}`);
  // pressTauMs 是指数平滑时间常数（非过渡时长），视觉收敛 ≈ 3τ ≈ 180ms，落在铁律手感档
  assert.ok(PARAMS.pressTauMs > 0 && PARAMS.pressTauMs <= 100, `pressTauMs=${PARAMS.pressTauMs}`);
});

test('时长铁律：CSS 中的 ms 字面量只允许 档位值/降级 0.01ms/pulse 豁免 2400ms', () => {
  // 2400ms 为激活点 pulse 循环周期（任务要求的呼吸感，非过渡时长，见 dock.css 注释；
  // 其余过渡一律引用 --ml-dur-* 令牌，唯一字面量是 tooltip 出现延迟 200ms）。
  const allowed = new Set([200, 2400, 0.01]);
  const found = [...cssCode.matchAll(/(\d+(?:\.\d+)?)ms\b/g)].map((m) => parseFloat(m[1]));
  assert.ok(found.length > 0, '未扫描到任何时长（审计失效？）');
  for (const v of found) {
    assert.ok(allowed.has(v), `dock.css 出现越档时长 ${v}ms（只允许 200 / 2400 豁免 / 0.01 降级）`);
  }
  assert.ok(found.includes(2400), 'pulse 周期 2400ms 应存在（有注释的循环豁免）');
});

test('属性红线：transition/animation 只涉及 opacity / transform / visibility', () => {
  const decls = [...cssCode.matchAll(/(?:transition|animation)\s*:\s*[^;]+;/g)].map((m) => m[0]);
  assert.ok(decls.length > 0, '未找到 transition/animation 声明（审计失效？）');
  const forbidden = /(width|height|top\b|left\b|right\b|bottom\b|margin|padding|box-shadow|background|border|font|color)\b/;
  for (const d of decls) {
    // 去掉 "transition:" 前缀与句尾分号后，逐段取首个单词 = 属性名
    const props = d.replace(/;$/, '').replace(/^[^:]*:\s*/, '').split(',').map((seg) => seg.trim().split(/\s+/)[0]);
    for (const p of props) {
      assert.doesNotMatch(p, forbidden, `过渡/动画涉及非合成层属性：${p} ←→ ${d}`);
      assert.match(p, /^(opacity|transform|visibility|ml-dock-dot-pulse|none)$/, `未知属性段：${p}`);
    }
  }
  assert.doesNotMatch(css, /will-change/, 'will-change 应由 JS 动态挂载/移除，禁止常驻 CSS（SPEC §3.5）');
});

test('rAF 纪律：帧内零布局读取（getBoundingClientRect 仅出现在 measure 一处）', () => {
  const count = (jsCode.match(/getBoundingClientRect/g) || []).length;
  assert.equal(count, 1, `getBoundingClientRect 调用点应为 1（实测缓存），实际 ${count}`);
  assert.match(jsCode, /function measure[\s\S]*?getBoundingClientRect/, '唯一读取点应在 measure() 内');
  // pointermove 回调结构性检查：只写 state.pointerX，不触发计算/动画/布局读取
  const pm = jsCode.match(/addEventListener\('pointermove',\s*\(?e\)?\s*=>\s*\{([\s\S]*?)\}\);/);
  assert.ok(pm, 'pointermove 回调缺失');
  assert.match(pm[1], /state\.pointerX\s*=\s*e\.clientX/, 'pointermove 应记录指针坐标');
  assert.doesNotMatch(pm[1], /measure|ensureLoop|requestAnimationFrame|getBoundingClientRect|style\./,
    'pointermove 回调必须只记数据（SPEC §3.3），不得触发计算/动画/样式写入');
  // 意图注释保留在原始源码中（注释剥离后的 jsCode 上查不到）
  assert.match(js, /只记数据/, 'pointermove 回调应保留「只记数据」意图注释');
});

test('图标数量在 8~10 个，且每个都带名称 tooltip 与激活点', () => {
  const n = (html.match(/class="dock-icon"/g) || []).length;
  assert.ok(n >= 8 && n <= 10, `图标数 ${n} 不在 8~10`);
  assert.equal((html.match(/dock-icon__tip/g) || []).length, n);
  assert.equal((html.match(/dock-icon__dot/g) || []).length, n);
});

test('降级说明写进页面注释（触屏 / 键盘 / prefers-reduced-motion）', () => {
  assert.match(html, /触屏/);
  assert.match(html, /键盘/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('激活点三要素：主题蓝令牌 + box-shadow 光晕 + pulse 动画', () => {
  const dot = css.slice(css.indexOf('.dock-icon__dot'));
  assert.match(dot, /var\(--ml-primary\)/);
  assert.match(dot, /box-shadow:[^;]*var\(--ml-primary\)/);
  assert.match(css, /@keyframes ml-dock-dot-pulse/);
  assert.match(css, /animation:\s*ml-dock-dot-pulse/);
});

test('只写 transform（scale + translateY），不写布局属性', () => {
  const writes = [...jsCode.matchAll(/style\.transform\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  // 3 个写入点：波浪主写入 + 收敛归位清空 + 降级清空
  assert.equal(writes.length, 3, `transform 写入点应为 3，实际 ${writes.length}`);
  const active = writes.filter((w) => w !== "''");
  assert.equal(active.length, 1, '除两处清空外应只有一个实际写入点');
  assert.match(active[0], /translateY/, '波浪写入缺少 translateY（上浮）');
  assert.match(active[0], /scale/, '波浪写入缺少 scale（放大）');
  assert.doesNotMatch(active[0], /(width|height|top|left|margin|padding)/, '波浪写入涉及布局属性');
});

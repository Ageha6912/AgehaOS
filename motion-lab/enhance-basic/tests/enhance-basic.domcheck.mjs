#!/usr/bin/env node
/**
 * enhance-basic DOM 冒烟测试（jsdom，直接运行）：
 *
 *   node tests/enhance-basic.domcheck.mjs
 *
 * 把组合演示页整体加载进 jsdom（runScripts + 加载外部脚本），在真实 DOM 上
 * 验证五个效果的运行时行为与 prefers-reduced-motion 降级分支：
 *   - 普通 DOM：主题切换 / 玻璃档位与实色兜底 / 键盘按压 / 依次入场与重播 /
 *               光晕 rAF 跟随 / 涟漪注入与自清理 / 各演示开关
 *   - 降级 DOM：玻璃直接落定 / 不绑键盘按压 / 入场直接 settled /
 *               光晕 1:1 瞬时跟随 / 不注入涟漪
 * 断言全部通过则退出码 0，否则 1。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, '..', 'index.html');
const html = readFileSync(htmlPath, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 加载一份演示页 DOM；reduced=true 时 matchMedia 对 reduced-motion 返回 true */
function makeDom({ reduced = false } = {}) {
  const scriptErrors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String((e && e.message) || e);
    // jsdom 内置 CSS 解析器不认识部分新语法（如空格色值/伪类），样式解析报错与本测试无关
    if (msg.includes('Could not parse CSS')) return;
    scriptErrors.push(msg);
  });
  const dom = new JSDOM(html, {
    url: 'file:///' + htmlPath.replace(/\\/g, '/'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true, // 提供 requestAnimationFrame（光晕 rAF 跟随需要）
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = (q) => ({
        matches: reduced && String(q).includes('prefers-reduced-motion'),
        media: String(q),
        onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false; },
      });
    },
  });
  const loaded = new Promise((resolve, reject) => {
    dom.window.addEventListener('load', resolve);
    dom.window.addEventListener('error', (e) => reject(new Error('页面脚本错误: ' + e.message)));
  });
  return { dom, loaded, scriptErrors, window: dom.window, document: dom.window.document };
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`);
}

const q = (doc, sel) => doc.querySelector(sel);
const key = (win, type, k) => new win.KeyboardEvent(type, { key: k, bubbles: true });
const mouse = (win, type, x, y, bubbles) => new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: !!bubbles });

/* ===================== 普通 DOM：完整行为 ===================== */
{
  const { dom, loaded, scriptErrors, window: win, document: doc } = makeDom({ reduced: false });
  await loaded;
  await sleep(30);

  console.log('== 普通偏好（完整动效路径） ==');

  // 主题切换（demo-page.js：body 挂 ml-dark）
  const themeBtn = q(doc, '#themeToggle');
  themeBtn.click();
  check('主题切换：点击后 body 获得 ml-dark', doc.body.classList.contains('ml-dark'));
  check('主题切换：按钮 aria-pressed 同步', themeBtn.getAttribute('aria-pressed') === 'true');
  themeBtn.click();
  check('主题切换：再点恢复浅色', !doc.body.classList.contains('ml-dark'));

  /* 01 玻璃 */
  const glassRoot = q(doc, '[data-demo="glass"]');
  const card = q(glassRoot, '.glass-card');
  check('玻璃：默认档位为 PARAMS.defaultTier=md', card.getAttribute('data-blur') === 'md');
  q(glassRoot, '[data-blur-tier="lg"]').click();
  check('玻璃：点档位按钮一次性切换到 lg', card.getAttribute('data-blur') === 'lg');
  check('玻璃：档位按钮 is-active 跟随', q(glassRoot, '[data-blur-tier="lg"]').classList.contains('is-active')
    && !q(glassRoot, '[data-blur-tier="md"]').classList.contains('is-active'));
  const glassSwitch = q(glassRoot, '[data-demo-switch]');
  glassSwitch.checked = false;
  glassSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('玻璃：开关关闭 → 实色兜底 is-solid', card.classList.contains('is-solid'));
  glassSwitch.checked = true;
  glassSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('玻璃：开关重开 → 撤销兜底并重放入场', !card.classList.contains('is-solid'));

  /* 02 按压 */
  const pressRoot = q(doc, '[data-demo="press"]');
  const icon = q(pressRoot, '.press-icon');
  icon.dispatchEvent(key(win, 'keydown', 'Enter'));
  check('按压：键盘 Enter 按下 → is-pressed', icon.classList.contains('is-pressed'));
  icon.dispatchEvent(key(win, 'keyup', 'Enter'));
  check('按压：键盘 Enter 抬起 → 撤销按压态', !icon.classList.contains('is-pressed'));
  const pressSwitch = q(pressRoot, '[data-demo-switch]');
  pressSwitch.checked = false;
  pressSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('按压：开关关闭 → 舞台挂 is-off', q(pressRoot, '.press-stage').classList.contains('is-off'));
  icon.dispatchEvent(key(win, 'keydown', ' '));
  check('按压：关闭后键盘不再注入按压态', !icon.classList.contains('is-pressed'));
  pressSwitch.checked = true;
  pressSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));

  /* 03 依次入场 */
  const staggerRoot = q(doc, '[data-demo="stagger"]');
  const row = q(staggerRoot, '.stagger-row');
  const items = Array.from(staggerRoot.querySelectorAll('.stagger-item'));
  check('入场：加载后自动播放（row.is-entered）', row.classList.contains('is-entered'));
  const indices = items.map((el) => Number(el.style.getPropertyValue('--se-i')));
  check('入场：元素错峰序号 0..n 递增', indices.every((v, i) => v === i), indices.join(','));
  check('入场：错峰间隔注入 --se-stagger=60ms', row.style.getPropertyValue('--se-stagger') === '60ms');
  // jsdom 无 CSS 动画引擎，手动派发 animationend 模拟逐个播完
  items.forEach((el) => el.dispatchEvent(new win.Event('animationend', { bubbles: true })));
  check('入场：全部播完 → row.is-settled 落定（摘除 fill 锁定）', row.classList.contains('is-settled'));
  q(staggerRoot, '[data-demo-replay]').click();
  check('入场：重播 → 撤销落定并重新触发', row.classList.contains('is-entered') && !row.classList.contains('is-settled'));
  const staggerSwitch = q(staggerRoot, '[data-demo-switch]');
  staggerSwitch.checked = false;
  staggerSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('入场：开关关闭 → 错峰间隔归零（同帧到场）', row.style.getPropertyValue('--se-stagger') === '0ms');

  /* 04 光晕 */
  const glowRoot = q(doc, '[data-demo="glow"]');
  const canvas = q(glowRoot, '.glow-canvas');
  const orb = q(glowRoot, '.glow-orb');
  canvas.dispatchEvent(mouse(win, 'pointerenter', 50, 40, false));
  check('光晕：pointerenter → is-visible 亮起', orb.classList.contains('is-visible'));
  const t0 = orb.style.transform;
  canvas.dispatchEvent(mouse(win, 'pointermove', 120, 80, true));
  await sleep(120); // 让 rAF 跑若干帧
  const t1 = orb.style.transform;
  const px = (t) => (t.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/) || [0, 0, 0]).map(Number).slice(1);
  const [x0, y0] = px(t0);
  const [x1, y1] = px(t1);
  check('光晕：transform 只写 translate3d（合成层路径）', /^translate3d\(-?[\d.]+px, -?[\d.]+px, 0\)$/.test(t1), t1);
  check('光晕：rAF 平滑跟随向目标收敛（x/y 双向移动）', x1 > x0 && y1 > y0, `(${x0},${y0}) → (${x1},${y1})`);
  check('光晕：目标换算正确（目标-半径=120-160=-40 / 80-160=-80）', Math.abs(x1 - -40) < 40 && Math.abs(y1 - -80) < 40);
  const glowSwitch = q(glowRoot, '[data-demo-switch]');
  glowSwitch.checked = false;
  glowSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('光晕：开关关闭 → 光斑隐藏且不再跟随', !orb.classList.contains('is-visible'));
  canvas.dispatchEvent(mouse(win, 'pointermove', 300, 300, true));
  await sleep(60);
  const [x2] = px(orb.style.transform);
  check('光晕：关闭后指针移动不再写入 transform', x2 === x1, `x 保持 ${x2}`);

  /* 05 涟漪 */
  const rippleRoot = q(doc, '[data-demo="ripple"]');
  const rippleBtn = Array.from(rippleRoot.querySelectorAll('[data-ripple]'))[0];
  rippleBtn.dispatchEvent(mouse(win, 'pointerdown', 10, 10, true));
  let span = q(rippleBtn, '.cr-ripple');
  check('涟漪：pointerdown 注入 span.cr-ripple', !!span);
  check('涟漪：坐标经 --cr-x/--cr-y 注入（transform 定位）',
    span && span.style.getPropertyValue('--cr-x') === '10px' && span.style.getPropertyValue('--cr-y') === '10px');
  span.dispatchEvent(new win.Event('animationend'));
  check('涟漪：animationend 后自清理', !q(rippleBtn, '.cr-ripple'));
  const rippleCard = q(rippleRoot, '.ripple-card');
  rippleCard.dispatchEvent(key(win, 'keydown', ' '));
  span = q(rippleCard, '.cr-ripple');
  check('涟漪：键盘 Space 在元素中心触发（可达性等价）', !!span);
  span.dispatchEvent(new win.Event('animationend'));
  const rippleSwitch = q(rippleRoot, '[data-demo-switch]');
  rippleSwitch.checked = false;
  rippleSwitch.dispatchEvent(new win.Event('change', { bubbles: true }));
  rippleBtn.dispatchEvent(mouse(win, 'pointerdown', 10, 10, true));
  check('涟漪：开关关闭 → 不再注入', !q(rippleBtn, '.cr-ripple'));

  check('普通 DOM：无脚本错误', scriptErrors.length === 0, scriptErrors.join(' | ') || '干净');
  dom.window.close();
}

/* ===================== 降级 DOM：prefers-reduced-motion: reduce ===================== */
{
  const { dom, loaded, scriptErrors, window: win, document: doc } = makeDom({ reduced: true });
  await loaded;
  await sleep(30);

  console.log('\n== prefers-reduced-motion: reduce（降级路径） ==');

  const card = q(doc, '[data-demo="glass"] .glass-card');
  check('玻璃降级：直接落定（is-materialized，不播入场动画）', card.classList.contains('is-materialized'));

  const icon = q(doc, '[data-demo="press"] .press-icon');
  icon.dispatchEvent(key(win, 'keydown', 'Enter'));
  check('按压降级：不绑定键盘按压类（反馈退化为 :active/:focus-visible）', !icon.classList.contains('is-pressed'));

  const row = q(doc, '[data-demo="stagger"] .stagger-row');
  check('入场降级：直接呈现最终画面（is-entered + is-settled）',
    row.classList.contains('is-entered') && row.classList.contains('is-settled'));
  q(doc, '[data-demo="stagger"] [data-demo-replay]').click();
  check('入场降级：重播同样瞬时落定', row.classList.contains('is-settled'));

  const canvas = q(doc, '[data-demo="glow"] .glow-canvas');
  const orb = q(doc, '[data-demo="glow"] .glow-orb');
  canvas.dispatchEvent(mouse(win, 'pointerenter', 120, 80, false));
  canvas.dispatchEvent(mouse(win, 'pointermove', 120, 80, true));
  await sleep(60);
  check('光晕降级：1:1 瞬时跟随（无惯性拖尾）', orb.style.transform === 'translate3d(-40px, -80px, 0)',
    orb.style.transform);

  const btn = q(doc, '[data-demo="ripple"] [data-ripple]');
  btn.dispatchEvent(mouse(win, 'pointerdown', 10, 10, true));
  check('涟漪降级：不注入（动效关闭）', !q(btn, '.cr-ripple'));

  check('降级 DOM：无脚本错误', scriptErrors.length === 0, scriptErrors.join(' | ') || '干净');
  dom.window.close();
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exitCode = failed === 0 ? 0 : 1;

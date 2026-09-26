/* ==========================================================================
 * check.mjs — menu-toast 模块验收脚本（node motion-lab/menu-toast/check.mjs）
 * --------------------------------------------------------------------------
 * 两级检查：
 *   A. 静态合规：三文件齐备、零外部依赖、CSS 首行令牌导入、过渡只动
 *      transform/opacity、无裸时长、PARAMS 集中、reduced-motion 检测等；
 *   B. 运行时冒烟（jsdom，取自仓库 node_modules）：开合/关闭路径、通知
 *      生命周期、hover 暂停驻留、腾位上移、计时器清理。
 * 全部通过时退出码 0，任何失败退出码 1。
 * ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const FILES = { html: 'index.html', css: 'menu-toast.css', js: 'menu-toast.js' };

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  const tag = ok ? '[PASS] ' : '[FAIL] ';
  console.log(tag + name + (detail ? ' —— ' + detail : ''));
  if (ok) pass += 1; else fail += 1;
}
function section(title) {
  console.log('\n== ' + title + ' ==');
}

/* 去掉注释再扫描，避免说明文字误报 */
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

section('A. 静态合规检查');

const missing = Object.values(FILES).filter((f) => !existsSync(join(dir, f)));
check('A1. 三文件齐备（index.html / menu-toast.css / menu-toast.js）', missing.length === 0, missing.join(', ') || '全部存在');
check('A2. 共享令牌文件存在（../shared/tokens.css）', existsSync(join(dir, '..', 'shared', 'tokens.css')));

if (fail === 0) {
  const html = readFileSync(join(dir, FILES.html), 'utf8');
  const cssRaw = readFileSync(join(dir, FILES.css), 'utf8');
  const jsRaw = readFileSync(join(dir, FILES.js), 'utf8');
  const css = stripCssComments(cssRaw);
  const js = stripJsComments(jsRaw);

  /* —— 零外部网络依赖 —— */
  const httpHits = [html, css, js].map((s, i) => ({ file: Object.values(FILES)[i], hits: s.match(/https?:\/\//g) })).filter((r) => r.hits);
  check('A3. 零外部网络依赖（无 http/https 引用）', httpHits.length === 0, httpHits.map((r) => r.file).join(', ') || '未发现');

  /* —— 结构引用 —— */
  check('A4. HTML 引用本模块 CSS/JS', html.includes('href="menu-toast.css"') && html.includes('src="menu-toast.js"'));

  /* —— 令牌导入 —— */
  check('A5. CSS 首行为 @import "../shared/tokens.css"', cssRaw.trimStart().startsWith('@import "../shared/tokens.css";'));
  const tokenUses = (css.match(/var\(--ml-/g) || []).length;
  check('A6. CSS 引用 --ml-* 令牌（≥15 处）', tokenUses >= 15, '实际 ' + tokenUses + ' 处');

  /* —— 性能铁律：过渡只动 transform/opacity —— */
  const badTrans = [];
  for (const m of css.matchAll(/transition\s*:\s*([^;{}]+)[;}]/g)) {
    for (const seg of m[1].split(',')) {
      const prop = seg.trim().split(/[\s(]/)[0];
      if (prop && prop !== 'none' && prop !== 'opacity' && prop !== 'transform') badTrans.push(prop);
    }
  }
  check('A7. 全部 transition 只过渡 opacity/transform（无布局/绘制属性）', badTrans.length === 0, badTrans.join(', ') || '通过');
  check('A8. 无 animation/keyframes（统一走 transition）', !/animation\s*:|@keyframes/.test(css));

  /* —— 性能铁律：无裸时长（全部走 --ml-dur-* 令牌） —— */
  const rawTimes = css.match(/\b\d+(?:\.\d+)?m?s\b/g) || [];
  check('A9. CSS 无裸时长数值（全部 var(--ml-dur-*)）', rawTimes.length === 0, rawTimes.join(', ') || '通过');

  /* —— blur 不逐帧动画（不出现在任何 transition/animation 声明中） —— */
  const blurInTrans = [...css.matchAll(/transition\s*:\s*([^;{}]+)[;}]/g)].some((m) => /blur|backdrop/.test(m[1]));
  check('A10. blur/backdrop-filter 不参与过渡', !blurInTrans);

  /* —— PARAMS 与降级 —— */
  const jsLines = jsRaw.split('\n');
  const paramsLine = jsLines.findIndex((l) => l.includes('const PARAMS = {'));
  check('A11. JS 顶部集中唯一 PARAMS 对象（前 60 行内）', paramsLine >= 0 && paramsLine < 60, '第 ' + (paramsLine + 1) + ' 行');
  check('A12. JS 检测 prefers-reduced-motion（matchMedia）', js.includes('prefers-reduced-motion') && js.includes('matchMedia'));
  check('A13. JS 存在 clearTimeout 计时器清理', (js.match(/clearTimeout/g) || []).length >= 5);
  check('A14. CSS 有 prefers-reduced-motion 降级块', css.includes('@media (prefers-reduced-motion: reduce)'));
  check('A15. HTML 通知层 aria-live 可感知', html.includes('aria-live="polite"'));
}

section('B. 运行时冒烟（jsdom）');
let jsdomOk = false;
let JSDOM = null;
try {
  ({ JSDOM } = await import('jsdom'));
  jsdomOk = true;
} catch {
  console.log('[SKIP] jsdom 不可用（仓库未安装依赖？），运行时冒烟未执行——仅静态检查结论有效');
}

if (jsdomOk) {
  const htmlSrc = readFileSync(join(dir, FILES.html), 'utf8').replace(/<script[^>]*src="menu-toast\.js"[^>]*>\s*<\/script>/, '');
  const jsSrc = readFileSync(join(dir, FILES.js), 'utf8');

  const dom = new JSDOM(htmlSrc, {
    url: 'file://' + join(dir, FILES.html).replace(/\\/g, '/'),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      /* jsdom 未实现 matchMedia：按「未开启减弱动效」桩掉 */
      window.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
      });
      /* jsdom 无布局：给统一假高度，让堆叠位移（腾位）可断言 */
      Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() { return 64; },
      });
    },
  });
  dom.window.eval(jsSrc);

  const { window } = dom;
  const doc = window.document;
  /* jsdom 在 eval 时 readyState 仍为 loading，DOMContentLoaded 未触发：
     显式派发一次；模块 boot 有幂等护栏，真实环境的原生事件不会导致双跑 */
  doc.dispatchEvent(new window.Event('DOMContentLoaded'));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (name, ok, detail = '') => check(name, ok, detail);

  /* —— 主题切换 —— */
  const themeBtn = doc.getElementById('themeBtn');
  themeBtn.click();
  assert('B1. 主题切换：html 获得 ml-dark', doc.documentElement.classList.contains('ml-dark'));
  themeBtn.click();
  assert('B2. 主题切换：再次点击还原浅色', !doc.documentElement.classList.contains('ml-dark'));

  /* —— 顶部下拉菜单：打开 / Esc 关闭 —— */
  const fileBtn = doc.getElementById('menuFileBtn');
  const popFile = doc.getElementById('popFile');
  const cardFile = popFile.querySelector('.ml-pop-card');
  fileBtn.click();
  assert('B3. 下拉菜单打开：is-open + 可见 + aria-expanded', cardFile.classList.contains('is-open')
    && popFile.style.visibility === 'visible'
    && fileBtn.getAttribute('aria-expanded') === 'true');
  assert('B4. 打开即聚焦首个菜单项', doc.activeElement === cardFile.querySelector('[role="menuitem"]'));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert('B5. Esc 关闭下拉菜单：is-open 移除', !cardFile.classList.contains('is-open'));

  /* —— 右键上下文菜单：指针位置打开 / preventDefault / 外点关闭 —— */
  const desktop = doc.getElementById('desktop');
  const popCtx = doc.getElementById('popContext');
  const cardCtx = popCtx.querySelector('.ml-pop-card');
  const ctxEvent = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 });
  desktop.dispatchEvent(ctxEvent);
  assert('B6. 桌面区域 contextmenu 被 preventDefault', ctxEvent.defaultPrevented);
  assert('B7. 右键打开上下文菜单（is-open + 可见）', cardCtx.classList.contains('is-open') && popCtx.style.visibility === 'visible');
  doc.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  assert('B8. 点击外部快速关闭上下文菜单', !cardCtx.classList.contains('is-open'));

  /* —— 菜单项动作：状态行更新 + 自动关闭 —— */
  desktop.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 90 }));
  cardCtx.querySelector('[data-action="新建文件夹"]').click();
  assert('B9. 菜单项点击：状态行更新并关闭菜单', doc.getElementById('statusLine').textContent.includes('新建文件夹')
    && !cardCtx.classList.contains('is-open'));

  /* —— 通知：创建 / 结构 / 手动关闭 —— */
  const layer = doc.getElementById('toastLayer');
  doc.getElementById('notifyBtn').click();
  assert('B10. 发一条通知：堆叠层出现 1 条', layer.children.length === 1);
  const toastCard = layer.children[0].querySelector('.ml-toast');
  assert('B11. 通知进场：is-in 已挂载', toastCard.classList.contains('is-in'));
  assert('B12. 通知结构：标题/正文/图标/关闭按钮齐备', !!toastCard.querySelector('.ml-toast-title')
    && !!toastCard.querySelector('.ml-toast-text')
    && !!toastCard.querySelector('.ml-toast-icon')
    && !!toastCard.querySelector('.ml-toast-close'));
  toastCard.querySelector('.ml-toast-close').click();
  await sleep(450);
  assert('B13. 关闭按钮触发滑出并移除 DOM', layer.children.length === 0);

  /* —— 驻留 3s 自动消失 + hover 暂停（SPEC §1.4） —— */
  doc.getElementById('notifyBtn').click();
  const hoverCard = layer.children[0].querySelector('.ml-toast');
  await sleep(800);
  hoverCard.dispatchEvent(new window.Event('pointerenter'));
  await sleep(2600);
  assert('B14. hover 暂停驻留：3.4s 后仍在（>3s 驻留期）', layer.children.length === 1);
  hoverCard.dispatchEvent(new window.Event('pointerleave'));
  await sleep(2900);
  assert('B15. 恢复倒计时后自动滑出并移除', layer.children.length === 0);

  /* —— 连发三条 + 腾位上移（transform 过渡） —— */
  doc.getElementById('burstBtn').click();
  await sleep(1250);
  assert('B16. 连发三条：堆叠层 3 条', layer.children.length === 3);
  const oldest = layer.children[0];
  const second = layer.children[1];
  const beforeShift = second.style.transform;
  oldest.querySelector('.ml-toast-close').click();
  assert('B17. 腾位上移：最旧一条开始滑出，下方 transform 立即重排为顶端', second.style.transform !== beforeShift
    && second.style.transform === 'translateY(0px)', beforeShift + ' → ' + second.style.transform);
  await sleep(450);
  assert('B18. 滑出完成后移除节点（剩 2 条）', layer.children.length === 2);
  layer.children[0].querySelector('.ml-toast-close').click();
  layer.children[1].querySelector('.ml-toast-close').click();
  await sleep(450);
  assert('B19. 全部关闭后堆叠层清空', layer.children.length === 0);
}

section('C. 真实浏览器冒烟（Playwright · chromium headless）');
let pw = null;
try {
  pw = await import('playwright-core');
} catch {
  console.log('[SKIP] playwright-core 不可用，浏览器冒烟未执行——A/B 结论仍有效');
}

if (pw) {
  const assert = (name, ok, detail = '') => check(name, ok, detail);
  let browser = null;
  try {
    browser = await pw.chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });
    await page.goto(pathToFileURL(join(dir, FILES.html)).href);

    assert('C1. 页面加载零 JS 错误', pageErrors.length === 0, pageErrors.join(' | '));

    /* 菜单动效层关闭态：过渡仅 opacity/transform，0.15s 档（--ml-dur-fast） */
    const cardTrans = await page.$eval('#popFile .ml-pop-card', (el) => {
      const cs = getComputedStyle(el);
      return { prop: cs.transitionProperty, dur: cs.transitionDuration };
    });
    assert('C2. 菜单卡片过渡属性 opacity,transform（0.15s 档）',
      /^opacity,\s*transform$/.test(cardTrans.prop) && /^0\.15s,\s*0\.15s$/.test(cardTrans.dur),
      JSON.stringify(cardTrans));

    /* 右键菜单：定位层 transform 摆位到指针位置 */
    await page.mouse.click(500, 300, { button: 'right' });
    const ctxTf = await page.$eval('#popContext', (el) => getComputedStyle(el).transform);
    const ctxM = ctxTf.match(/matrix\(1, 0, 0, 1, ([\d.]+), ([\d.]+)\)/);
    assert('C3. 右键菜单定位层 transform 摆位到指针 (500,300)',
      !!ctxM && Math.round(Number(ctxM[1])) === 500 && Math.round(Number(ctxM[2])) === 300, ctxTf);

    await page.waitForTimeout(400);
    const ctxCard = await page.$eval('#popContext .ml-pop-card', (el) => {
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, tf: cs.transform };
    });
    assert('C4. 进场完成：opacity=1、上浮位移归零',
      ctxCard.opacity === '1' && /matrix\(1, 0, 0, 1, 0, 0\)|none/.test(ctxCard.tf), JSON.stringify(ctxCard));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const vis = await page.$eval('#popContext', (el) => getComputedStyle(el).visibility);
    assert('C5. Esc 退场完成后定位层 visibility=hidden', vis === 'hidden', vis);

    /* 通知关闭态初值：用「冻结过渡」的探针元素读真实计算值（translateX = 自身宽度 + 余量） */
    const probe = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'ml-toast';
      el.style.transition = 'none'; /* 冻结在关闭态初值，读完即移除 */
      document.getElementById('toastLayer').appendChild(el);
      const out = { tf: getComputedStyle(el).transform, width: el.offsetWidth };
      el.remove();
      return out;
    });
    assert('C6. 通知关闭态停在屏幕外右缘（tx ≥ 卡片宽度）',
      /matrix\(1, 0, 0, 1, ([\d.]+), 0\)/.test(probe.tf) && Number(probe.tf.match(/matrix\(1, 0, 0, 1, ([\d.]+), 0\)/)[1]) >= probe.width,
      'tf=' + probe.tf + ' width=' + probe.width);

    await page.click('#notifyBtn');
    await page.waitForTimeout(500);
    const inEnd = await page.$eval('.ml-toast', (el) => getComputedStyle(el).transform);
    assert('C7. 滑入完成：translateX 归零', /matrix\(1, 0, 0, 1, 0, 0\)|none/.test(inEnd), inEnd);

    await page.click('#notifyBtn');
    await page.waitForTimeout(120);
    const slotY = await page.$$eval('.ml-toast-slot', (els) => els.map((e) => e.style.transform));
    const secondY = slotY.length === 2 ? Number((slotY[1].match(/translateY\(([\d.]+)px\)/) || [0, -1])[1]) : -1;
    assert('C8. 第二条向下堆叠（slot translateY = 首条高度 + 间距）',
      slotY.length === 2 && slotY[0] === 'translateY(0px)' && secondY >= 50,
      slotY.join(' | '));

    await page.click('.ml-toast-slot:first-child .ml-toast-close');
    await page.waitForTimeout(60);
    const slotY2 = await page.$$eval('.ml-toast-slot', (els) => els.map((e) => e.style.transform));
    assert('C9. 腾位上移：最旧一条滑出，下方 slot 立即重排为 translateY(0px)',
      slotY2.length === 2 && slotY2[1] === 'translateY(0px)', slotY2.join(' | '));

    await page.mouse.move(400, 600); /* 移开指针，避免「悬停暂停驻留」干扰自动消失断言 */
    await page.waitForTimeout(3600);
    const restCount = await page.$$eval('.ml-toast-slot', (els) => els.length);
    assert('C10. 驻留 3s 后自动滑出并移除', restCount === 0, '剩余 ' + restCount);

    assert('C11. 交互全程零 JS 错误', pageErrors.length === 0, pageErrors.join(' | '));

    /* —— prefers-reduced-motion 真实仿真：直接显隐 —— */
    const rmContext = await browser.newContext({ reducedMotion: 'reduce' });
    const rmPage = await rmContext.newPage();
    await rmPage.goto(pathToFileURL(join(dir, FILES.html)).href);
    await rmPage.mouse.click(500, 300, { button: 'right' });
    const rmCard = await rmPage.$eval('#popContext .ml-pop-card', (el) => {
      const cs = getComputedStyle(el);
      return { tf: cs.transform, dur: cs.transitionDuration, opacity: cs.opacity };
    });
    assert('C12. reduced-motion：位移归零、过渡 0s、直接显隐',
      (rmCard.tf === 'none' || rmCard.tf === 'matrix(1, 0, 0, 1, 0, 0)') && Number(rmCard.dur.replace(/s$/, '')) === 0 && rmCard.opacity === '1',
      JSON.stringify(rmCard));
    await rmContext.close();
  } catch (err) {
    check('C0. 浏览器冒烟执行完成', false, String(err));
  } finally {
    if (browser) await browser.close();
  }
}

console.log('\n== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail === 0 ? 0 : 1);

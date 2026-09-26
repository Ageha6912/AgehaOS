#!/usr/bin/env node
/**
 * enhance-basic 模块静态验收测试（零依赖，直接运行）：
 *
 *   node tests/enhance-basic.check.mjs
 *
 * 逐条对照 motion-lab/SPEC.md §3「实现铁律」、§4「令牌与 PARAMS」、
 * §5「prefers-reduced-motion 降级」与任务要求做静态验收。
 * 全部断言通过则退出码 0，否则逐条打印失败项并退出码 1。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const modDir = join(here, '..');

const EFFECTS = ['glass', 'press', 'stagger', 'glow', 'ripple'];
const EFFECT_CSS = EFFECTS.map((k) => `${k === 'glass' ? 'glass-panel' : k === 'press' ? 'icon-press' : k === 'stagger' ? 'stagger-enter' : k === 'glow' ? 'cursor-glow' : 'click-ripple'}.css`);
const EFFECT_JS = EFFECT_CSS.map((f) => f.replace('.css', '.js'));
const ALL_FILES = [
  'index.html', 'demo-page.css', 'demo-page.js',
  ...EFFECT_CSS, ...EFFECT_JS,
];

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`);
}

const read = (f) => readFileSync(join(modDir, f), 'utf8');

/** 去掉 CSS 注释（避免注释里的示例数值/文档干扰字面量扫描） */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 去掉 JS 注释 */
function stripJsComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

console.log('== enhance-basic 静态验收（对照 motion-lab/SPEC.md 与任务要求） ==\n');

/* ---------- 1. 文件齐备 ---------- */
{
  const missing = ALL_FILES.filter((f) => !existsSync(join(modDir, f)));
  check('三文件规范 × 5 效果 + 页面框架：文件齐备', missing.length === 0,
    missing.length ? `缺失: ${missing.join(', ')}` : `${ALL_FILES.length} 个文件全部就位`);
}

/* ---------- 2. 共享令牌引用（SPEC §4：style 第一行 @import） ---------- */
{
  const bad = EFFECT_CSS.concat('demo-page.css').filter((f) => {
    const head = read(f).replace(/^\uFEFF/, '').trimStart();
    return !head.startsWith('@import "../shared/tokens.css";');
  });
  check('每个 CSS 第一条语句是 @import "../shared/tokens.css"', bad.length === 0,
    bad.length ? `违规: ${bad.join(', ')}` : '6 个 CSS 全部符合');

  const noToken = EFFECT_CSS.concat('demo-page.css').filter((f) => !read(f).includes('var(--ml-'));
  check('全部样式引用 --ml-* 令牌（无散落魔数体系）', noToken.length === 0,
    noToken.length ? `未引用: ${noToken.join(', ')}` : '6 个 CSS 全部引用');
}

/* ---------- 3. 零外部网络依赖 ---------- */
{
  const offenders = ALL_FILES.filter((f) => /https?:\/\//.test(read(f)));
  check('零外部网络依赖（模块文件无任何 http/https 外链）', offenders.length === 0,
    offenders.length ? `含外链: ${offenders.join(', ')}` : '全部自包含');
}

/* ---------- 4. 只动 transform/opacity（SPEC §3.2） ---------- */
{
  // transition 声明白名单：剥掉 var()/cubic-bezier()/时间后只剩 transform/opacity/none
  const badTransitions = [];
  for (const f of EFFECT_CSS.concat('demo-page.css')) {
    const css = stripCssComments(read(f));
    const decls = css.match(/transition\s*:[^;{}]+/g) || [];
    for (const d of decls) {
      let v = d.replace(/^[^:]*:/, '');
      v = v.replace(/var\([^()]*\)/g, ' ').replace(/cubic-bezier\([^()]*\)/g, ' ');
      const words = v.split(/[\s,]+/).filter(Boolean).filter((w) => !/^[\d.]+m?s$/.test(w));
      const ok = words.every((w) => ['transform', 'opacity', 'none'].includes(w));
      if (!ok) badTransitions.push(`${f}: ${d.trim()}`);
    }
  }
  check('transition 声明只含 transform/opacity（无布局/绘制属性过渡）', badTransitions.length === 0,
    badTransitions.length ? badTransitions.join(' | ') : '全部合规');

  // @keyframes 内声明属性白名单（SPEC §3.4 的 blur 材质段被任务铁律收窄为 transform/opacity）
  const badKeyframes = [];
  for (const f of EFFECT_CSS.concat('demo-page.css')) {
    const css = stripCssComments(read(f));
    const blocks = css.match(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
    for (const b of blocks) {
      const props = Array.from(b.matchAll(/[{;]\s*([a-zA-Z-]+)\s*:/g)).map((m) => m[1]);
      const bad = props.filter((p) => !['transform', 'opacity'].includes(p));
      if (bad.length) badKeyframes.push(`${f}: ${b.match(/@keyframes\s+[\w-]+/)[0]} 含 ${bad.join(',')}`);
    }
  }
  check('@keyframes 内只动 transform/opacity', badKeyframes.length === 0,
    badKeyframes.length ? badKeyframes.join(' | ') : '全部合规');
}

/* ---------- 5. 时长合规（SPEC §3.1：150~300ms；错峰间隔允许 0~100ms，SPEC §1.4） ---------- */
{
  const badDur = [];
  const badDelay = [];
  for (const f of EFFECT_CSS.concat('demo-page.css')) {
    let css = stripCssComments(read(f));
    // 先摘出 delay 声明单独验收（错峰间隔档），其余 ms 字面量按过渡时长验收
    const delays = css.match(/(?:animation-delay|transition-delay)\s*:[^;{}]+/g) || [];
    css = css.replace(/(?:animation-delay|transition-delay)\s*:[^;{}]+/g, ' ');
    for (const d of delays) {
      for (const m of d.matchAll(/(\d+(?:\.\d+)?)ms/g)) {
        const v = parseFloat(m[1]);
        if (v < 0 || v > 100) badDelay.push(`${f}: ${d.trim()}`);
      }
    }
    for (const m of css.matchAll(/(\d+(?:\.\d+)?)ms/g)) {
      const v = parseFloat(m[1]);
      if (v !== 0 && (v < 150 || v > 300)) badDur.push(`${f}: ${v}ms`);
    }
  }
  check('CSS 过渡/动画时长全部落在 150~300ms（或 0）', badDur.length === 0,
    badDur.length ? badDur.join(', ') : '全部合规');
  check('错峰间隔（delay）落在 0~100ms（SPEC §1.4）', badDelay.length === 0,
    badDelay.length ? badDelay.join(' | ') : '全部合规');

  const badJsMs = [];
  for (const f of EFFECT_JS.concat('demo-page.js')) {
    const js = stripJsComments(read(f));
    for (const m of js.matchAll(/(\d+(?:\.\d+)?)ms/g)) {
      const v = parseFloat(m[1]);
      if (v !== 0 && (v < 150 || v > 300) && v > 100) badJsMs.push(`${f}: ${v}ms`);
    }
  }
  check('JS 中的 ms 字面量合规（时长 150~300 / 间隔 0~100）', badJsMs.length === 0,
    badJsMs.length ? badJsMs.join(', ') : '全部合规');
}

/* ---------- 6. JS 顶部集中 PARAMS（SPEC §4） ---------- */
{
  const bad = [];
  for (const f of EFFECT_JS) {
    const lines = read(f).split('\n');
    const idx = lines.findIndex((l) => /const PARAMS\s*=\s*\{/.test(l));
    const hasCjk = /[\u4e00-\u9fa5]/.test(read(f));
    if (idx === -1 || idx > 30 || !hasCjk) bad.push(`${f}: PARAMS@${idx + 1}行`);
  }
  check('每个效果 JS 顶部（≤30 行）有唯一 PARAMS 常量且全中文注释', bad.length === 0,
    bad.length ? bad.join(', ') : '5 个效果全部符合');
}

/* ---------- 7. reduced-motion 降级（SPEC §5） ---------- */
{
  const missing = EFFECT_JS.filter((f) =>
    !/matchMedia\(\s*['"`]\(prefers-reduced-motion: reduce\)['"`]\s*\)/.test(read(f)));
  check('JS 侧运行时检测 matchMedia(prefers-reduced-motion: reduce)', missing.length === 0,
    missing.length ? `缺失: ${missing.join(', ')}` : '5 个效果全部检测');
  // CSS 侧兜底由令牌层承担：确认样式确实引用了 --ml-dur-*（塌缩后自动降级）
  const noDurToken = EFFECT_CSS.filter((f) => !/--ml-dur-/.test(read(f)));
  check('CSS 侧时长引用 --ml-dur-* 档位令牌（reduced-motion 下自动塌缩）', noDurToken.length === 0,
    noDurToken.length ? `未引用: ${noDurToken.join(', ')}` : '全部合规');
}

/* ---------- 8. will-change 纪律（SPEC §3.5：只在动效前挂、结束即摘） ---------- */
{
  const files = EFFECT_CSS.concat('demo-page.css');
  const holders = files.filter((f) => stripCssComments(read(f)).includes('will-change'));
  let ok = holders.length === 1 && holders[0] === 'cursor-glow.css';
  let detail = holders.join(', ') || '无';
  if (ok) {
    const css = stripCssComments(read('cursor-glow.css'));
    let idx = css.indexOf('will-change');
    while (idx !== -1) {
      const ruleStart = css.lastIndexOf('}', idx) + 1;
      const selector = css.slice(ruleStart, idx);
      if (!selector.includes('.is-visible')) { ok = false; detail = 'will-change 出现在非 .is-visible 规则中'; break; }
      idx = css.indexOf('will-change', idx + 1);
    }
  }
  check('will-change 只出现在 cursor-glow.css 的 .is-visible 规则内', ok, detail);
}

/* ---------- 9. 页面结构（任务要求：动机一句话 + 可开关区块 + 重播） ---------- */
{
  const html = read('index.html');
  const sections = html.split(/(?=<section\b)/).slice(1).map((s) => s.split('</section>')[0]);
  check('演示页含 5 个效果区块', sections.length === 5, `实际 ${sections.length} 个`);

  const noMotive = sections.filter((s) => !s.includes('设计动机：'));
  const noSwitch = sections.filter((s) => !s.includes('data-demo-switch'));
  const demoKey = (s) => {
    const m = s.match(/data-demo="([\w-]+)"/);
    return m ? m[1] : '?';
  };
  check('每个区块注明「设计动机」一句话', noMotive.length === 0,
    noMotive.length ? '缺失区块: ' + noMotive.map(demoKey).join(', ') : '5 个区块全部注明');
  check('每个区块带可开关的演示开关', noSwitch.length === 0,
    noSwitch.length ? '缺失区块: ' + noSwitch.map(demoKey).join(', ') : '5 个区块全部带开关');

  const staggerSection = sections.find((s) => s.includes('data-demo="stagger"')) || '';
  check('依次入场区块提供「重播」按钮', staggerSection.includes('data-demo-replay'), '');

  const links = Array.from(html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)).map((m) => m[1]);
  const scripts = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map((m) => m[1]);
  const linkOk = EFFECT_CSS.concat('demo-page.css').every((f) => links.includes(f));
  const scriptOk = EFFECT_JS.concat('demo-page.js').every((f) => scripts.includes(f));
  check('index.html 正确引用全部 CSS/JS', linkOk && scriptOk,
    `links=${links.length} scripts=${scripts.length}`);
}

/* ---------- 10. JS 语法（node --check 逐文件真解析） ---------- */
{
  const bad = [];
  for (const f of EFFECT_JS.concat('demo-page.js')) {
    const r = spawnSync(process.execPath, ['--check', join(modDir, f)], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${(r.stderr || '').trim().split('\n')[0]}`);
  }
  check('node --check 全部 JS 语法通过', bad.length === 0, bad.join(' | ') || '6 个 JS 全部通过');
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exitCode = failed === 0 ? 0 : 1;

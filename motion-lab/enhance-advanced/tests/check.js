#!/usr/bin/env node
/**
 * ============================================================================
 * motion-lab/enhance-advanced/tests/check.js — 进阶炫技档 · 静态验收测试
 * ----------------------------------------------------------------------------
 * 零依赖（仅 Node 内置），运行：node tests/check.js
 * 覆盖 SPEC §6 模块验收清单中可静态判定的项：
 *   1. 三文件齐备 + 引用路径全部本地存在（零外部网络依赖）；
 *   2. 每个效果 css 首行 @import 共享令牌；
 *   3. 交互过渡时长全部落在 150~300ms（氛围循环按注释白名单豁免）；
 *   4. keyframes 只动 transform/opacity（animation-timing-function 除外）；
 *   5. 每个效果 css 均有 prefers-reduced-motion: reduce 降级块；
 *   6. 每个 JS 有唯一 PARAMS 对象 + 中文注释 + matchMedia 检测；
 *   7. 全部 JS 通过 node --check 语法校验；
 *   8. 组合演示页默认开关状态 = 只开「壁纸视差 + 氛围光晕」两项。
 * 运行时行为验证另见 tests/smoke.mjs（Playwright 冒烟）。
 * ============================================================================
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EFFECTS = ['parallax', 'aurora', 'window-tilt', 'dock-sheen', 'theme-glow'];
const EFFECT_FILES = [];
for (const e of EFFECTS) {
  EFFECT_FILES.push(`${e}/index.html`, `${e}/${e}.css`, `${e}/${e}.js`);
}
const ALL_FILES = ['index.html', 'style.css', 'script.js', ...EFFECT_FILES];

let failures = 0;
let passed = 0;
function ok(name) { passed++; console.log('  \u2713 ' + name); }
function bad(name, detail) { failures++; console.error('  \u2717 ' + name + (detail ? ' \u2014\u2014 ' + detail : '')); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

/** 去掉 CSS 注释，避免注释中的示例数值/属性名干扰扫描 */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 剔除可访问性降级 @media 块（其内部时长允许为 0.01ms/120ms 特例） */
function stripA11yMediaBlocks(css) {
  return css.replace(
    /@media\s*\((?:prefers-reduced-motion|prefers-reduced-transparency)[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g,
    ''
  );
}

console.log('\n[1] 文件齐备与本地引用（零外部网络依赖）');
for (const rel of ALL_FILES) {
  check(`存在 ${rel}`, exists(rel));
}
{
  const htmlFiles = ['index.html', ...EFFECTS.map((e) => `${e}/index.html`)];
  for (const rel of htmlFiles) {
    const dir = path.dirname(path.join(ROOT, rel));
    const html = read(rel);
    check(`${rel} 含 <meta charset>`, /<meta[^>]+charset=["']?UTF-8/i.test(html));
    check(`${rel} 含 lang="zh-CN"`, /<html[^>]+lang=["']zh-CN["']/i.test(html));
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    let localOk = true;
    let missing = '';
    for (const ref of refs) {
      if (/^(https?:)?\/\//i.test(ref)) { localOk = false; missing = `外部引用 ${ref}`; break; }
      if (!fs.existsSync(path.resolve(dir, ref))) { localOk = false; missing = `缺失引用 ${ref}`; break; }
    }
    check(`${rel} 引用全部本地且存在`, localOk, missing);
  }
  // css 的 @import 也必须是本地共享令牌
  const cssFiles = ['style.css', ...EFFECTS.map((e) => `${e}/${e}.css`)];
  for (const rel of cssFiles) {
    const css = read(rel);
    const imports = [...css.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
    let localOk = imports.length > 0;
    let missing = '';
    for (const ref of imports) {
      if (/^(https?:)?\/\//i.test(ref)) { localOk = false; missing = `外部 @import ${ref}`; break; }
      if (!fs.existsSync(path.resolve(path.dirname(path.join(ROOT, rel)), ref))) {
        localOk = false; missing = `缺失 @import ${ref}`; break;
      }
    }
    check(`${rel} @import 全部本地且存在`, localOk, missing);
  }
}

console.log('\n[2] 共享令牌引用（css 首行 @import --ml-* 令牌）');
check('style.css 首行 @import "../shared/tokens.css"',
  read('style.css').trimStart().startsWith('@import "../shared/tokens.css";'));
for (const e of EFFECTS) {
  check(`${e}/${e}.css 首行 @import "../../shared/tokens.css"`,
    read(`${e}/${e}.css`).trimStart().startsWith('@import "../../shared/tokens.css";'));
}
{
  const cssFiles = ['style.css', ...EFFECTS.map((e) => `${e}/${e}.css`)];
  for (const rel of cssFiles) {
    check(`${rel} 实际使用 var(--ml-*) 令牌`, /var\(--ml-[a-z-]+\)/.test(stripCssComments(read(rel))));
  }
}

console.log('\n[3] 时长铁律：交互过渡 150~300ms（氛围循环按白名单豁免）');
const AMBIENT_ANIM_NAMES = ['mlds-sweep', 'mlg-breathe']; // 任务指定的低频氛围循环
{
  const cssFiles = ['style.css', ...EFFECTS.map((e) => `${e}/${e}.css`)];
  for (const rel of cssFiles) {
    const css = stripA11yMediaBlocks(stripCssComments(read(rel)));
    // transition 声明里的毫秒时长
    for (const m of css.matchAll(/transition\s*:[^;}]*/g)) {
      for (const d of m[0].matchAll(/(\d+(?:\.\d+)?)ms/g)) {
        const v = parseFloat(d[1]);
        check(`${rel} transition ${v}ms 在 150~300ms`, v >= 150 && v <= 300, m[0].trim());
      }
    }
    // animation 声明里的毫秒时长
    for (const m of css.matchAll(/animation\s*:[^;}]*/g)) {
      const decl = m[0];
      if (/animation\s*:\s*none\b/.test(decl)) continue;
      const isAmbient = AMBIENT_ANIM_NAMES.some((n) => decl.includes(n));
      for (const d of decl.matchAll(/(\d+(?:\.\d+)?)ms/g)) {
        const v = parseFloat(d[1]);
        if (isAmbient) {
          check(`${rel} 氛围循环 ${v}ms（豁免：${AMBIENT_ANIM_NAMES.join('/')}）`, true);
        } else {
          check(`${rel} animation ${v}ms 在 150~300ms`, v >= 150 && v <= 300, decl.trim());
        }
      }
    }
    // 正向检查：声明了过渡/动画的文件，时长必须引用令牌档（或属氛围白名单）
    const hasMotion = /(?:transition|animation)\s*:/.test(css);
    const usesDurToken = /var\(--ml-dur-|var\(--mlg-cycle|var\(--mlds-cycle/.test(css);
    const hasAmbient = AMBIENT_ANIM_NAMES.some((n) => css.includes(n));
    if (hasMotion) {
      check(`${rel} 过渡/动画时长引用 --ml-dur-* 令牌档`, usesDurToken || hasAmbient);
    }
  }
}

console.log('\n[4] keyframes 只动 transform/opacity（+ timing-function）');
{
  const cssFiles = ['style.css', ...EFFECTS.map((e) => `${e}/${e}.css`)];
  const ALLOWED = new Set(['transform', 'opacity', 'animation-timing-function']);
  for (const rel of cssFiles) {
    const css = stripCssComments(read(rel));
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*?)\}/g)) {
      const name = m[1];
      const inner = m[2];
      const props = [...inner.matchAll(/(?:^|[\s;{])([a-zA-Z-]+)\s*:/g)].map((x) => x[1]);
      const offenders = [...new Set(props.filter((p) => !ALLOWED.has(p)))];
      check(`@keyframes ${name} 仅动 transform/opacity`, offenders.length === 0,
        offenders.join(', '));
    }
  }
}

console.log('\n[5] prefers-reduced-motion 降级块');
for (const e of EFFECTS) {
  const css = read(`${e}/${e}.css`);
  check(`${e}/${e}.css 含 @media (prefers-reduced-motion: reduce)`,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
}

console.log('\n[6] JS 规约：唯一 PARAMS + 中文注释 + matchMedia 检测');
{
  const jsFiles = ['script.js', ...EFFECTS.map((e) => `${e}/${e}.js`)];
  for (const rel of jsFiles) {
    const js = read(rel);
    const paramCount = (js.match(/const PARAMS\s*=\s*\{/g) || []).length;
    if (rel === 'script.js') {
      // 控制器无动效参数，不要求 PARAMS
      check(`${rel} 无 PARAMS（控制器不含动效参数）`, paramCount === 0);
    } else {
      check(`${rel} 有唯一 PARAMS 对象`, paramCount === 1);
    }
    check(`${rel} 含中文注释`, /[\u4e00-\u9fa5]/.test(js));
    if (rel !== 'script.js') {
      check(`${rel} 含 matchMedia('(prefers-reduced-motion: reduce)') 检测`,
        js.includes("matchMedia('(prefers-reduced-motion: reduce)')"));
    }
  }
}

console.log('\n[7] JS 语法（node --check）');
{
  const jsFiles = ['script.js', ...EFFECTS.map((e) => `${e}/${e}.js`)];
  for (const rel of jsFiles) {
    try {
      execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
      check(`${rel} 语法通过`, true);
    } catch (err) {
      check(`${rel} 语法通过`, false, String(err.stderr || err.message).slice(0, 200));
    }
  }
}

console.log('\n[8] 组合演示页默认开关 = 视差 + 光晕（其余关闭）');
{
  const html = read('index.html');
  const expected = {
    'data-ml-parallax': true,
    'data-ml-aurora': false,
    'data-ml-windows': false,
    'data-ml-dock': false,
    'data-ml-theme-glow': true,
  };
  for (const [attr, want] of Object.entries(expected)) {
    const m = html.match(new RegExp(attr + '[^>]*data-ml-enabled="(true|false)"'));
    check(`${attr} 初始 ${want ? '开启' : '关闭'}`, !!m && m[1] === String(want),
      m ? `实际 ${m[1]}` : '未找到根元素');
  }
  check('组合页加载全部 5 个效果样式与脚本',
    EFFECTS.every((e) => html.includes(`${e}/${e}.css`) && html.includes(`${e}/${e}.js`)));
}

console.log(`\n===== 静态验收：${passed} 项通过，${failures} 项失败 =====`);
process.exit(failures ? 1 : 0);

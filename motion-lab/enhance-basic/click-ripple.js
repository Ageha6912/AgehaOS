(() => {
  'use strict';
  /**
   * enhance-basic / click-ripple.js — 05 点击涟漪
   * 职责：pointerdown / 键盘 Enter-Space 处注入涟漪 span（播完自清理）、
   * 演示开关。扩散动画本体由 CSS animation 完成，JS 不逐帧。
   */

  /**
   * 模块动效参数——按性能表现微调时只改这里（全部中文注释，SPEC §4）。
   */
  const PARAMS = {
    durationMs: 300,  // 涟漪扩散时长 ms —— 与 CSS 侧 var(--ml-dur-slow) 同源（铁律上限档）
    startAlpha: 0.4,  // 涟漪起始不透明度 —— 注入 CSS 变量 --cr-alpha
    cover: 1.15,      // 覆盖系数：直径 =「点击点到最远角距离 ×2」× cover，保证铺满宿主
    maxDiameter: 720, // 涟漪直径上限 px：防止在超大容器里一次生成巨图层拖累合成器
    keyboard: true,   // 键盘 Enter/Space 在元素中心触发同款涟漪（无指针坐标的等价反馈）
  };

  // SPEC §5：prefers-reduced-motion 运行时检测。
  // 降级选型：「动效关闭」——不注入涟漪（无扩散运动），点击反馈退化为
  // 宿主 :active 的瞬时微缩放（CSS 侧，时长被令牌塌缩）。
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.querySelector('[data-demo="ripple"]');
  if (!root) return;

  const switchEl = root.querySelector('[data-demo-switch]');
  let enabled = true;
  if (switchEl) {
    switchEl.addEventListener('change', () => { enabled = switchEl.checked; });
  }

  /** 在宿主 (x, y) 处注入一枚涟漪；播完 animationend 自清理 */
  function spawn(host, x, y) {
    if (!enabled || REDUCED) return;
    const rect = host.getBoundingClientRect(); // 一次读布局（点击瞬间，非逐帧）
    // 直径取「点击点到最远角距离 ×2 ×覆盖系数」：从任意点都能铺满宿主
    let maxDist = 0;
    const corners = [
      [rect.left, rect.top], [rect.right, rect.top],
      [rect.left, rect.bottom], [rect.right, rect.bottom],
    ];
    corners.forEach((c) => {
      const d = Math.hypot(c[0] - x, c[1] - y);
      if (d > maxDist) maxDist = d;
    });
    const diameter = Math.min(maxDist * 2 * PARAMS.cover, PARAMS.maxDiameter);

    const r = document.createElement('span');
    r.className = 'cr-ripple';
    // 一次性写入定位/尺寸变量：keyframes 与之同源，坐标也走 transform
    r.style.setProperty('--cr-d', diameter + 'px');
    r.style.setProperty('--cr-x', (x - rect.left) + 'px');
    r.style.setProperty('--cr-y', (y - rect.top) + 'px');
    r.style.setProperty('--cr-alpha', String(PARAMS.startAlpha));
    r.addEventListener('animationend', () => r.remove(), { once: true }); // 结束自清理
    host.appendChild(r);
    // 兜底清理：极端情况下 animationend 不触发（如宿主被 display:none）也不残留
    window.setTimeout(() => { if (r.parentNode) r.parentNode.removeChild(r); }, PARAMS.durationMs + 200);
  }

  root.addEventListener('pointerdown', (e) => {
    const host = e.target && e.target.closest ? e.target.closest('[data-ripple]') : null;
    if (!host) return;
    spawn(host, e.clientX, e.clientY);
  });

  if (PARAMS.keyboard) {
    root.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const host = e.target && e.target.closest ? e.target.closest('[data-ripple]') : null;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      spawn(host, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
  }
})();

(() => {
  'use strict';
  /**
   * enhance-basic / cursor-glow.js — 04 鼠标跟随光晕
   * 职责：rAF 节流的指针跟随（事件回调只记数据，每帧最多一次样式写入）、
   * 进出舞台淡入淡出、演示开关。
   */

  /**
   * 模块动效参数——按性能表现微调时只改这里（全部中文注释，SPEC §4）。
   */
  const PARAMS = {
    size: 320,       // 光斑直径 px —— 注入 CSS 变量 --cg-size
    opacity: 0.5,    // 光斑不透明度 —— 注入 CSS 变量 --cg-opacity
    smoothing: 0.18, // 跟随平滑系数 0~1：1 = 1:1 瞬时跟随，越小拖尾越长；reduced-motion 下强制 1（SPEC §5：跟随类降级为 1:1 瞬时跟随）
    fadeMs: 150,     // 进出舞台淡入淡出时长 ms —— 与 CSS 侧 var(--ml-dur-fast) 同源；铁律 150~300 内
    blend: 'auto',   // mix-blend-mode：'auto' = 浅色 multiply / 深色 screen（CSS 侧定义）；'normal' = 关闭混合
  };

  // SPEC §5：prefers-reduced-motion 运行时检测（rAF 驱动模块必须在 JS 检测）。
  // 降级选型：「元素 1:1 瞬时跟随（无惯性与回弹）」——平滑系数强制为 1，
  // opacity 过渡时长另被令牌塌缩到 0.01ms，瞬现瞬隐。
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.querySelector('[data-demo="glow"]');
  if (!root) return;

  const stage = root.querySelector('.glow-stage');
  const canvas = root.querySelector('.glow-canvas');
  const orb = root.querySelector('.glow-orb');
  const switchEl = root.querySelector('[data-demo-switch]');
  if (!stage || !canvas || !orb) return;

  // 参数注入：CSS 只写一份实现，数值可调处统一收口到 PARAMS
  stage.style.setProperty('--cg-size', PARAMS.size + 'px');
  stage.style.setProperty('--cg-opacity', String(PARAMS.opacity));
  if (PARAMS.blend === 'normal') stage.classList.add('is-blend-normal');

  const half = PARAMS.size / 2;
  const ease = REDUCED ? 1 : PARAMS.smoothing;

  let rect = null;               // 舞台几何缓存：避免每次 pointermove 都读布局
  let targetX = 0, targetY = 0;  // 目标点（事件回调里只记数据，不写样式——SPEC §3.3）
  let curX = 0, curY = 0;        // 当前呈现值（每帧从这里续算，可中断、可反向）
  let rafId = 0;
  let enabled = true;

  function measure() { rect = canvas.getBoundingClientRect(); }

  /** 唯一的样式写入口：一帧至多调用一次 */
  function apply(x, y) {
    orb.style.transform = 'translate3d(' + (x - half) + 'px, ' + (y - half) + 'px, 0)';
  }

  function tick() {
    rafId = 0;
    curX += (targetX - curX) * ease;
    curY += (targetY - curY) * ease;
    apply(curX, curY);
    // 收敛判定：足够近就停帧（光斑静置不烧空闲帧）；指针再动会重新调度
    if (Math.abs(targetX - curX) > 0.5 || Math.abs(targetY - curY) > 0.5) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  canvas.addEventListener('pointerenter', (e) => {
    if (!enabled) return;
    measure();
    targetX = e.clientX - rect.left;
    targetY = e.clientY - rect.top;
    curX = targetX; curY = targetY; // 首现即就地亮起，不从场外飞入
    apply(curX, curY);
    orb.classList.add('is-visible'); // opacity 淡入（CSS 过渡；令牌塌缩时瞬现）
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!enabled) return;
    if (!rect) measure(); // 窗口尺寸/滚动变化后惰性重测
    targetX = e.clientX - rect.left;
    targetY = e.clientY - rect.top;
    schedule();
  });

  canvas.addEventListener('pointerleave', () => {
    // 淡出：opacity 过渡由 CSS 接管；transform 停在原地；will-change 随类摘除
    orb.classList.remove('is-visible');
  });

  // 舞台几何失效（惰性重测）：resize 与滚动都不立即读布局
  window.addEventListener('resize', () => { rect = null; });
  window.addEventListener('scroll', () => { rect = null; }, { passive: true });

  if (switchEl) {
    switchEl.addEventListener('change', () => {
      enabled = switchEl.checked;
      if (!enabled) {
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        orb.classList.remove('is-visible');
      }
    });
  }
})();

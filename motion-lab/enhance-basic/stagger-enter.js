(() => {
  'use strict';
  /**
   * enhance-basic / stagger-enter.js — 03 进桌面依次入场
   * 职责：注入错峰间隔/位移参数、一次性播放、播完落定、重播与错峰开关。
   * 动画本体由 CSS animation 完成（合成器接管），JS 只做类切换与计数。
   */

  /**
   * 模块动效参数——按性能表现微调时只改这里（全部中文注释，SPEC §4）。
   */
  const PARAMS = {
    durationMs: 250, // 单个元素入场时长 ms —— 与 CSS 侧 var(--ml-dur-mid) 同源；铁律 150~300 内
    staggerMs: 60,   // 错峰间隔 ms —— SPEC §1.4 规定 40~60（超 100ms 会拖沓）；注入 --se-stagger
    risePx: 14,      // 上浮位移距离 px（translateY 起点）——注入 --se-rise
    baseDelayMs: 0,  // 首元素前置延迟 ms —— 注入 --se-base
  };

  // SPEC §5：prefers-reduced-motion 运行时检测。
  // 降级选型：「短促淡入直接呈现最终画面」——JS 直接落到 settled 终态
  // （所有元素同帧在场、无位移），重播按钮同样瞬时落定。
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.querySelector('[data-demo="stagger"]');
  if (!root) return;

  const row = root.querySelector('.stagger-row');
  const items = Array.prototype.slice.call(root.querySelectorAll('.stagger-item'));
  const replayBtn = root.querySelector('[data-demo-replay]');
  const switchEl = root.querySelector('[data-demo-switch]');
  if (!row || items.length === 0) return;

  // 参数注入：间隔/位移集中到 CSS 变量，动画本体仍由 CSS 合成器接管
  row.style.setProperty('--se-stagger', PARAMS.staggerMs + 'ms');
  row.style.setProperty('--se-rise', PARAMS.risePx + 'px');
  row.style.setProperty('--se-base', PARAMS.baseDelayMs + 'ms');
  items.forEach((el, i) => el.style.setProperty('--se-i', String(i)));

  let staggerOn = true;
  let remaining = 0; // 尚未播完的元素数（animationend 计数）

  /** 播放/重播：摘掉两态 → 强制 reflow 一次 → 重新触发一次性 animation */
  function play() {
    row.style.setProperty('--se-stagger', (staggerOn ? PARAMS.staggerMs : 0) + 'ms');
    if (REDUCED) {
      row.classList.add('is-entered', 'is-settled'); // 降级：直接呈现最终画面
      return;
    }
    remaining = items.length;
    row.classList.remove('is-entered', 'is-settled');
    void row.offsetWidth; // 一次性 reflow，确保同一帧内重启动画
    row.classList.add('is-entered');
  }

  // 全部播完 → .is-settled 摘掉 fill 锁定（回到无动画自然态）
  row.addEventListener('animationend', (e) => {
    if (!e.target || !e.target.classList || !e.target.classList.contains('stagger-item')) return;
    remaining -= 1;
    if (remaining <= 0) row.classList.add('is-settled');
  });

  if (replayBtn) replayBtn.addEventListener('click', play);

  // 演示开关：开 = 逐个错峰（PARAMS.staggerMs）；关 = 全部同帧到场
  if (switchEl) {
    switchEl.addEventListener('change', () => {
      staggerOn = switchEl.checked;
      play();
    });
  }

  play(); // 首次进场：一次性播放（模拟进桌面后元素依次到场）
})();

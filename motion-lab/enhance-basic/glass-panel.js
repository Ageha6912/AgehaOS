(() => {
  'use strict';
  /**
   * enhance-basic / glass-panel.js — 01 毛玻璃拟态面板
   * 职责：模糊档位切换（一次性）、实色兜底开关、materialize 入场重放。
   * 本模块按任务要求拆分为独立 .css/.js（与 SPEC §4 三文件约定不同，以需求为准）。
   */

  /**
   * 模块动效参数——按性能表现微调时只改这里（全部中文注释，SPEC §4）。
   */
  const PARAMS = {
    materializeMs: 250, // 入场 materialize 时长 ms —— 与 CSS 侧 var(--ml-dur-mid) 同源；铁律 150~300 内
    defaultTier: 'md',  // 默认模糊档 xs/sm/md/lg —— 对应 --ml-blur-xs/sm/md/lg；blur 永不逐帧动画（SPEC §3.4）
    liftPx: 2,          // 悬停抬升位移 px —— 注入 CSS 变量 --glass-lift（transform 实现）
  };

  // SPEC §5：prefers-reduced-motion 运行时检测（不许手填进 PARAMS）。
  // 降级选型：「短促淡入直接呈现最终画面」——JS 直接摘除入场动画，
  // 玻璃材质（blur 档）与实色兜底逻辑不受影响，状态全部可感知。
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.querySelector('[data-demo="glass"]');
  if (!root) return;

  const card = root.querySelector('.glass-card');
  const switchEl = root.querySelector('[data-demo-switch]');
  const tierBtns = Array.prototype.slice.call(root.querySelectorAll('.glass-tier'));
  if (!card) return;

  // 抬升位移收口到 PARAMS：CSS 只写一份实现
  root.querySelector('.glass-stage').style.setProperty('--glass-lift', PARAMS.liftPx + 'px');

  /** 重放入场 materialize：摘掉「已播完」标记 → 动画重新声明 → 重启 */
  function playMaterialize() {
    if (REDUCED) return; // 降级：直接呈现最终画面，不重放
    card.classList.remove('is-materialized');
    void card.offsetWidth; // 一次性 reflow，确保同一帧内重启生效
  }

  // 动画播完即摘除 fill 锁定（fill-mode both 的终态会压住 hover 的 transform）
  card.addEventListener('animationend', () => {
    card.classList.add('is-materialized');
  });

  /** 模糊档位一次性切换：换 data-blur 即换 --ml-blur-* 档，无过渡（SPEC §3.4） */
  function setTier(tier) {
    if (['xs', 'sm', 'md', 'lg'].indexOf(tier) === -1) return;
    card.setAttribute('data-blur', tier);
    tierBtns.forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-blur-tier') === tier));
  }

  tierBtns.forEach((b) => {
    b.addEventListener('click', () => setTier(b.getAttribute('data-blur-tier')));
  });

  // 演示开关：开 = 玻璃材质 + 重放 materialize；关 = 实色兜底（@supports 失败路径同观感）
  if (switchEl) {
    switchEl.addEventListener('change', () => {
      if (switchEl.checked) {
        card.classList.remove('is-solid');
        playMaterialize();
      } else {
        card.classList.add('is-solid');
      }
    });
  }

  setTier(PARAMS.defaultTier);
  if (REDUCED) card.classList.add('is-materialized'); // 降级：不播入场动画
})();

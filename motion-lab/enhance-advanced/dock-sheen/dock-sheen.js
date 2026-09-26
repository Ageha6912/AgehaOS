/**
 * ============================================================================
 * AgehaOS 动效实验室 · 进阶炫技档
 * 效果 4/5 —— Dock 高光扫过（dock-sheen.js）
 * ----------------------------------------------------------------------------
 * 设计动机：给静态底座一次低频的「釉面反光」——高光带斜向扫过 Dock，
 *   暗示材质是真实玻璃；静默期占循环 76%，只在你不注意时路过一次。
 * 实现三档差异：
 *   纯 CSS——伪元素 + animation 只动 transform/opacity，全程合成器接管、
 *     零 JS 常驻开销，★推荐默认档；
 *   JS rAF——可精确控制亮度包络，但为 9s 一次的扫光开常驻循环不值（空转耗电）；
 *   WebGL——纯 2D 高光，纹理化成本远超收益，无意义。
 * 推荐默认档：纯 CSS（本文件只把 PARAMS 注入为自定义属性 + 切换开关类）。
 * 说明：本效果为低频氛围循环动画（非交互过渡），扫过段约 2.2s 不受
 *   150~300ms 过渡档约束；启用/停用开关走 --ml-dur-fast（150ms）。
 * ============================================================================
 */
(function () {
  'use strict';

  /** 模块动效参数——按性能表现微调时只改这里（全部中文注释）。
   *  CSS 侧通过同名自定义属性消费，注入后即时生效。 */
  const PARAMS = {
    cycleMs: 9000,        // 扫光循环周期 ms（静默期占 76%——低频氛围、不抢戏）
    angleDeg: -16,        // 高光带倾角 deg（负值 = 右高左低的斜向扫过）
    stripWidthPct: 30,    // 高光带宽度（占 Dock 宽度百分比）
    peakLight: 0.5,       // 浅色主题高光峰值透明度（白高光压低不刺眼）
    peakDark: 0.65,       // 深色主题高光峰值透明度（深底需更亮才可读）
    delayMs: 1500,        // 启用后首扫延迟 ms（让位页面进场，不抢戏）
    reducedMotion: false, // 运行时由 matchMedia 检测覆写；CSS 侧另有降级：直接关闭循环
  };
  PARAMS.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initDockSheen(dock) {
    if (!dock) return null;

    /* PARAMS → CSS 自定义属性（单一来源；keyframes/渐变内以 var() 消费） */
    dock.style.setProperty('--mlds-cycle', PARAMS.cycleMs + 'ms');
    dock.style.setProperty('--mlds-angle', PARAMS.angleDeg + 'deg');
    dock.style.setProperty('--mlds-strip-w', PARAMS.stripWidthPct + '%');
    dock.style.setProperty('--mlds-peak-light', String(PARAMS.peakLight));
    dock.style.setProperty('--mlds-peak-dark', String(PARAMS.peakDark));
    dock.style.setProperty('--mlds-delay', PARAMS.delayMs + 'ms');

    let enabled = false;

    function setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      // 扫动本体全在 CSS；这里只翻开关类。停用时 ::after 以 150ms 淡出，
      // 位移关键帧随之终止——高光带回到场外（被 overflow 裁剪，无跳变）。
      dock.classList.toggle('is-sheen-on', on);
    }

    return { root: dock, setEnabled: setEnabled };
  }

  /* 自动初始化：见 parallax.js 底部说明 */
  window.MLAdvanced = window.MLAdvanced || {};
  const rootEl = document.querySelector('[data-ml-dock]');
  const handle = initDockSheen(rootEl);
  window.MLAdvanced.dock = handle;
  if (handle && rootEl.getAttribute('data-ml-enabled') !== 'false') {
    handle.setEnabled(true);
  }
})();

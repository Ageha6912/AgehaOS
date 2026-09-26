/**
 * ============================================================================
 * AgehaOS 动效实验室 · 进阶炫技档
 * 效果 5/5 —— 主题氛围光晕（theme-glow.js）
 * ----------------------------------------------------------------------------
 * 设计动机：让主题色从「平面上的颜色」变成「空间里的光」——一枚跟随主题
 *   色的大光斑在壁纸深处缓慢呼吸（opacity/scale 缓慢循环）。
 * 实现三档差异：
 *   纯 CSS——单 div + radial-gradient + keyframes，零 JS 常驻开销，★推荐默认档；
 *   JS rAF——只有需要跟随指针/实时渐变时才有意义，静态呼吸不值得占循环；
 *   WebGL——一枚径向渐变用不到着色器，纯浪费。
 * 推荐默认档：纯 CSS（本文件只把 PARAMS 注入为自定义属性 + 开关淡入淡出）。
 * 说明：呼吸周期 9s 属缓慢氛围循环（非交互过渡），不受 150~300ms 档约束；
 *   开关淡入淡出 200ms（--ml-dur-base）。
 * ============================================================================
 */
(function () {
  'use strict';

  /** 模块动效参数——按性能表现微调时只改这里（全部中文注释）。 */
  const PARAMS = {
    cycleMs: 9000,        // 呼吸周期 ms（缓慢循环；氛围动画非交互过渡，不受 150~300ms 档约束）
    scaleMax: 1.12,       // 呼吸放大峰值（transform scale，合成层属性）
    minLight: 0.45,       // 浅色主题透明度谷值
    maxLight: 0.75,       // 浅色主题透明度峰值
    minDark: 0.5,         // 深色主题透明度谷值（深底需更高存在感）
    maxDark: 0.9,         // 深色主题透明度峰值
    sizeVmax: 72,         // 光斑直径（vmax，铺出「大光斑」氛围）
    fadeMs: 200,          // 开关淡入淡出时长 ms，对应令牌 --ml-dur-base
    reducedMotion: false, // 运行时由 matchMedia 检测覆写；CSS 侧另有降级：循环关闭、保留静态谷值
  };
  PARAMS.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initThemeGlow(wrap) {
    if (!wrap) return null;
    const glow = wrap.querySelector('.mlg-glow');
    if (!glow) return null;

    /* PARAMS → CSS 自定义属性（单一来源；CSS 侧按主题取 light/dark 分档） */
    wrap.style.setProperty('--mlg-cycle', PARAMS.cycleMs + 'ms');
    wrap.style.setProperty('--mlg-scale', String(PARAMS.scaleMax));
    wrap.style.setProperty('--mlg-min-light', String(PARAMS.minLight));
    wrap.style.setProperty('--mlg-max-light', String(PARAMS.maxLight));
    wrap.style.setProperty('--mlg-min-dark', String(PARAMS.minDark));
    wrap.style.setProperty('--mlg-max-dark', String(PARAMS.maxDark));
    wrap.style.setProperty('--mlg-size', PARAMS.sizeVmax + 'vmax');
    wrap.style.setProperty('--mlg-fade', PARAMS.fadeMs + 'ms');

    let enabled = false;
    let stopTimer = 0;

    function setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      window.clearTimeout(stopTimer);
      if (on) {
        // 先挂动画（从谷值起步），同时包罩淡入——无跳变
        glow.classList.add('is-on');
        wrap.classList.add('is-on');
      } else {
        // 包罩先淡出，淡出完成后再停动画，杜绝「动画中断跳变」
        wrap.classList.remove('is-on');
        stopTimer = window.setTimeout(function () {
          if (!enabled) glow.classList.remove('is-on');
        }, PARAMS.fadeMs + 40);
      }
    }

    return { root: wrap, setEnabled: setEnabled };
  }

  /* 自动初始化：见 parallax.js 底部说明 */
  window.MLAdvanced = window.MLAdvanced || {};
  const rootEl = document.querySelector('[data-ml-theme-glow]');
  const handle = initThemeGlow(rootEl);
  window.MLAdvanced.glow = handle;
  if (handle && rootEl.getAttribute('data-ml-enabled') !== 'false') {
    handle.setEnabled(true);
  }
})();

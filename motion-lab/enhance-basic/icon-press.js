(() => {
  'use strict';
  /**
   * enhance-basic / icon-press.js — 02 图标按压微动效
   * 职责：把按压幅度收口到 PARAMS（注入 CSS 变量）、补键盘按压态、接演示开关。
   * 按压本体由 CSS transition 完成（合成器接管），JS 不参与逐帧。
   */

  /**
   * 模块动效参数——按性能表现微调时只改这里（全部中文注释，SPEC §4）。
   */
  const PARAMS = {
    pressScale: 0.92, // 按下缩放（任务指定 0.92）——注入 CSS 变量 --ip-press-scale
    pressMs: 150,     // 按下时长 ms —— 与 CSS 侧按下态 var(--ml-dur-fast) 同源（微反馈最低档）
    releaseMs: 150,   // 松开回弹时长 ms —— 与 CSS 侧常态 var(--ml-dur-fast) 同源；回弹感来自松开侧 --ml-ease-spring 曲线
    keyboard: true,   // 键盘 Enter/Space 触发同款按压态（可达性：焦点可达即反馈可达）
  };

  // SPEC §5：prefers-reduced-motion 运行时检测。
  // 降级选型：「动效关闭」——CSS 侧时长档被令牌塌缩到 0.01ms（缩放瞬时完成，
  // 状态变化仍可感知）；JS 侧不再绑定键盘按压类，反馈退化为原生 :active
  // 瞬时状态与 :focus-visible 焦点环。
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.querySelector('[data-demo="press"]');
  if (!root) return;

  const stage = root.querySelector('.press-stage');
  const switchEl = root.querySelector('[data-demo-switch]');
  if (!stage) return;

  stage.style.setProperty('--ip-press-scale', String(PARAMS.pressScale));

  let enabled = true;
  if (switchEl) {
    switchEl.addEventListener('change', () => {
      enabled = switchEl.checked;
      stage.classList.toggle('is-off', !enabled);
      if (!enabled) {
        Array.prototype.forEach.call(stage.querySelectorAll('.press-icon.is-pressed'), (el) => {
          el.classList.remove('is-pressed');
        });
      }
    });
  }

  // 键盘等价反馈（降级时不绑定）：keydown 按下、keyup/失焦抬起
  if (PARAMS.keyboard && !REDUCED) {
    stage.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const icon = e.target.closest('.press-icon');
      if (icon && enabled) icon.classList.add('is-pressed');
    });
    stage.addEventListener('keyup', (e) => {
      const icon = e.target.closest('.press-icon');
      if (icon) icon.classList.remove('is-pressed');
    });
    // blur 不冒泡，用捕获兜底：焦点被抢走时抬起按压态
    stage.addEventListener('blur', (e) => {
      const icon = e.target && e.target.closest && e.target.closest('.press-icon');
      if (icon) icon.classList.remove('is-pressed');
    }, true);
  }
})();

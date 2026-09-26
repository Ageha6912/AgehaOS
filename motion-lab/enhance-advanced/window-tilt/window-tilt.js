/**
 * ============================================================================
 * AgehaOS 动效实验室 · 进阶炫技档
 * 效果 3/5 —— 窗口切换转场（window-tilt.js）
 * ----------------------------------------------------------------------------
 * 设计动机：焦点切换是最高频的状态变化——用轻微 crossfade + ≤2deg 的 3D
 *   tilt 让「注意力从 A 窗移到 B 窗」变成一次可见的小起立；失焦窗口轻微
 *   降透明度、微缩退后，聚焦关系一目了然。
 * 实现三档差异：
 *   纯 CSS——类切换 + transition/animation 全程合成器接管、天然可中断、
 *     性能最佳；缺口是「朝旧窗口方向倾斜」需要 JS 计算方向；
 *   JS 设方向 + CSS 合成动画（本文件）——JS 只在激活瞬间写两个自定义属性，
 *     动画本体全部交合成器，★推荐默认档；
 *   WebGL——为 2D UI 做整窗 3D 需把 DOM 烘焙成纹理，成本极高、无必要。
 * 推荐默认档：JS 设方向 + CSS transition/animation。
 * 性能说明：本文件没有 rAF 循环——只在点击/聚焦瞬间读一次几何（两次
 *   getBoundingClientRect）并写入自定义属性，其余时间零 JS 开销；
 *   时长与缓动走 tokens 档（--ml-dur-mid / --ml-dur-base），PARAMS 数值
 *   与令牌同值并在注释互指。
 * ============================================================================
 */
(function () {
  'use strict';

  /** 模块动效参数——按性能表现微调时只改这里（全部中文注释）。 */
  const PARAMS = {
    tiltDegY: 1.6,         // 激活入场 rotateY 幅度 deg（铁律：≤2deg）
    tiltDegX: 0.8,         // 激活入场 rotateX 幅度 deg（铁律：≤2deg）
    scaleFrom: 0.985,      // 激活入场起始缩放（轻微后仰再立起）
    dim: 0.86,             // 失焦窗口透明度（轻微降，内容仍可辨）
    scaleUnfocused: 0.995, // 失焦窗口轻微缩小（景深暗示）
    durInMs: 250,          // 激活动画时长 ms，对应令牌 --ml-dur-mid（窗口开合主体档）
    durOutMs: 200,         // 失焦淡出时长 ms，对应令牌 --ml-dur-base（退场更快）
    perspectivePx: 1400,   // 3D 视距 px：越大越平缓含蓄，越小透视越夸张
    reducedMotion: false,  // 运行时由 matchMedia 检测覆写（SPEC §4，不许手填）
  };
  PARAMS.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initWindowTilt(field) {
    if (!field) return null;
    const wins = Array.prototype.slice.call(field.querySelectorAll('.mtw'));
    if (!wins.length) return null;

    /* PARAMS 注入为 CSS 自定义属性：几何/时长单一来源（CSS 侧用同名 var 消费） */
    field.style.setProperty('--mtw-dim', String(PARAMS.dim));
    field.style.setProperty('--mtw-scale-out', String(PARAMS.scaleUnfocused));
    field.style.setProperty('--mtw-scale-in', String(PARAMS.scaleFrom));
    field.style.setProperty('--mtw-dur-in', PARAMS.durInMs + 'ms');
    field.style.setProperty('--mtw-dur-out', PARAMS.durOutMs + 'ms');
    field.style.setProperty('--mtw-persp', PARAMS.perspectivePx + 'px');

    let enabled = false;

    /** 聚焦某窗口（幂等）；倾斜方向 = 新窗口朝旧窗口所在方向轻轻让位。 */
    function focusWin(win) {
      if (!enabled || !win || wins.indexOf(win) === -1) return;
      if (win.classList.contains('is-focused')) return;
      const prev = field.querySelector('.mtw.is-focused');
      if (prev && !PARAMS.reducedMotion) {
        // 方向计算：两窗口中心连线决定 rotateX/Y 的符号（幅度受 PARAMS 钳制在 ≤2deg）
        const a = prev.getBoundingClientRect();
        const b = win.getBoundingClientRect();
        const dx = b.left + b.width / 2 - (a.left + a.width / 2);
        const dy = b.top + b.height / 2 - (a.top + a.height / 2);
        win.style.setProperty('--mtw-ry', (-Math.sign(dx || 1) * PARAMS.tiltDegY).toFixed(2) + 'deg');
        win.style.setProperty('--mtw-rx', (Math.sign(dy || 1) * PARAMS.tiltDegX).toFixed(2) + 'deg');
      }
      if (prev) prev.classList.remove('is-focused');
      // 入场倾斜走 keyframes（一次性）；失焦淡出走 transition（天然可中断）
      win.classList.add('is-focused', 'is-activating');
    }

    function closestWin(node) {
      return node && node.closest ? node.closest('.mtw') : null;
    }

    function onClick(e) {
      focusWin(closestWin(e.target));
    }

    function onFocusIn(e) {
      // 键盘 Tab 聚焦与点击聚焦同源（focus-visible 环照常渲染）
      focusWin(closestWin(e.target));
    }

    function onAnimationEnd(e) {
      const t = e.target;
      if (t && t.classList && t.classList.contains('is-activating')) {
        t.classList.remove('is-activating');
      }
    }

    function setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      // is-off：CSS 强制全亮平铺（transition 正常触发淡回，无跳变）
      field.classList.toggle('is-off', !on);
      if (on) {
        field.addEventListener('click', onClick);
        field.addEventListener('focusin', onFocusIn);
        field.addEventListener('animationend', onAnimationEnd);
      } else {
        field.removeEventListener('click', onClick);
        field.removeEventListener('focusin', onFocusIn);
        field.removeEventListener('animationend', onAnimationEnd);
      }
    }

    return { root: field, setEnabled: setEnabled };
  }

  /* 自动初始化：见 parallax.js 底部说明 */
  window.MLAdvanced = window.MLAdvanced || {};
  const rootEl = document.querySelector('[data-ml-windows]');
  const handle = initWindowTilt(rootEl);
  window.MLAdvanced.windows = handle;
  if (handle && rootEl.getAttribute('data-ml-enabled') !== 'false') {
    handle.setEnabled(true);
  }
})();

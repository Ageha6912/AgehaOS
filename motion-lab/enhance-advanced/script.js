/**
 * ============================================================================
 * AgehaOS 动效实验室 · 进阶炫技档
 * script.js —— 演示页控制器（组合页与各独立演示页共用）
 * ----------------------------------------------------------------------------
 * 职责：
 *   1. 绑定组合演示页的五个效果开关（checkbox[data-ml-toggle] ↔ 效果句柄）；
 *   2. 主题切换按钮（html.ml-dark 一键切深色，并广播 ml-theme-change 事件
 *      供 canvas 类效果重建精灵/换色）；
 *   3. 检测 prefers-reduced-motion 并点亮降级提示。
 * 各效果的启停逻辑全部在各自 <effect>.js 的句柄（window.MLAdvanced.*）里，
 * 本文件不含任何动效实现。
 * ============================================================================
 */
(function () {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const handles = window.MLAdvanced || {};

  /* ---- 1) 效果开关（组合演示页；独立演示页无开关则自动跳过） ---- */
  const toggles = document.querySelectorAll('[data-ml-toggle]');
  for (let i = 0; i < toggles.length; i++) {
    (function (input) {
      const key = input.getAttribute('data-ml-toggle');
      const handle = handles[key];
      if (!handle) {
        input.disabled = true; // 对应效果缺失（文件未加载/DOM 不在），开关置灰
        return;
      }
      // 初始勾选态与根元素 data-ml-enabled 对齐（组合页默认只开「视差 + 光晕」）
      input.checked = handle.root.getAttribute('data-ml-enabled') !== 'false';
      input.addEventListener('change', function () {
        handle.setEnabled(input.checked);
      });
    })(toggles[i]);
  }

  /* ---- 2) 主题切换（组合页与独立页共用同一按钮约定） ---- */
  const themeBtn = document.querySelector('[data-ml-theme-btn]');
  function syncThemeLabel() {
    if (!themeBtn) return;
    const dark = document.documentElement.classList.contains('ml-dark');
    themeBtn.textContent = dark ? '☀ 切换浅色主题' : '☾ 切换深色主题';
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      document.documentElement.classList.toggle('ml-dark');
      // canvas 类效果（流光氛围）监听此事件以换精灵配色与整体透明度
      document.dispatchEvent(
        new CustomEvent('ml-theme-change', {
          detail: { dark: document.documentElement.classList.contains('ml-dark') },
        })
      );
      syncThemeLabel();
    });
    syncThemeLabel();
  }

  /* ---- 3) 减少动态偏好：点亮各页预置的降级提示 ---- */
  if (REDUCED) {
    document.documentElement.classList.add('ml-reduced');
    const notes = document.querySelectorAll('[data-ml-reduced-note]');
    for (let i = 0; i < notes.length; i++) notes[i].hidden = false;
  }
})();

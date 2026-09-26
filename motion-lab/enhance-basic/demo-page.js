(() => {
  'use strict';
  /**
   * enhance-basic / demo-page.js — 演示页框架脚本
   * 只负责全局主题切换（浅色 ↔ 深色）：按 SPEC §4 给 <body> 加 class="ml-dark"，
   * tokens.css 的深色语义层即整体翻转（渐变/玻璃/阴影/文字全部跟随）。
   * 五个效果各自的行为在各自 *.js 中，互不依赖、互不感知。
   */
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const dark = document.body.classList.toggle('ml-dark');
    btn.textContent = dark ? '☀ 切换浅色' : '☾ 切换深色';
    btn.setAttribute('aria-pressed', String(dark));
  });
})();

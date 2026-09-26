/**
 * ============================================================================
 * AgehaOS 动效实验室 · 进阶炫技档
 * 效果 2/5 —— 流光渐变氛围（aurora.js）
 * ----------------------------------------------------------------------------
 * 设计动机：给桌面铺一层缓慢流动的极光光斑，让「系统有温度」——低透明度、
 *   慢速度，只在深浅两主题下各自给出恰好的存在感。
 * 实现三档差异：
 *   纯 CSS——大半径 blur 光斑 + keyframes 位移，合成器接管性能好，但交叠处
 *     的加色发光还原度低，超大 blur 在低端机反成瓶颈；
 *   JS Canvas 2D（本文件）——光斑预烘焙成离屏精灵、每帧只 drawImage 合成，
 *     半分辨率绘制天然柔边，★推荐默认档；
 *   WebGL——着色器多光源叠加还原度最高，但复杂度/初始化成本最高，对
 *     缓慢氛围收益有限。
 * 推荐默认档：JS Canvas 2D（精灵烘焙）。
 * 性能说明：单 rAF 循环（不与其它 rAF 效果叠加成多循环）；document.hidden
 *   自动暂停（rAF 在后台标签本就挂起，此处再加显式守卫）；dpr 上限 2；
 *   内部分辨率 × renderScale；帧率上限 fpsCap；主题色光斑精灵仅在建/
 *   主题切换时重建，不在帧循环内创建渐变对象。
 * ============================================================================
 */
(function () {
  'use strict';

  /** 模块动效参数——按性能表现微调时只改这里（全部中文注释）。 */
  const PARAMS = {
    maxDpr: 2,          // devicePixelRatio 上限（任务要求 ≤2，高分屏不按 3 绘制）
    renderScale: 0.5,   // 内部渲染分辨率缩放（0.25~1）：0.5 = 半分辨率 + CSS 拉伸，填充率减半
    blobCount: 4,       // 光斑数量（每帧 drawImage 次数 = 此值，开销线性）
    radiusMin: 0.3,     // 光斑半径下限（占画面短边比例）
    radiusMax: 0.55,    // 光斑半径上限
    coreAlpha: 0.85,    // 光斑精灵径向渐变中心的透明度
    alphaLight: 0.2,    // 浅色主题 canvas 整体透明度（低透明度氛围）
    alphaDark: 0.34,    // 深色主题 canvas 整体透明度（深底需更高存在感）
    speed: 0.05,        // 流动基准角速度 rad/s（越慢越「呼吸」，太快会抢戏）
    orbitMin: 0.05,     // 光斑漂移轨道半径下限（占画面短边）
    orbitMax: 0.14,     // 光斑漂移轨道半径上限
    fpsCap: 30,         // 帧率上限：缓慢流动 30fps 与 60fps 观感无差、开销减半
    // 浅色主题光斑色（对齐 tokens §3 的钴蓝/蓝白族）
    colorsLight: ['#2f5fe8', '#7fa4ff', '#9db9ff', '#c9d9ff'],
    // 深色主题光斑色（加入青/紫两笔极光感，仍围绕 --ml-primary-dark 族）
    colorsDark: ['#2f5fe8', '#82a3ff', '#4fd2ff', '#8a7bff'],
    reducedMotion: false, // 运行时由 matchMedia 检测覆写（SPEC §4，不许手填）
  };
  PARAMS.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 确定性伪随机（固定种子 LCG）：每次刷新光斑布局一致，便于调参与回归 */
  let seed = 20260926;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function isDark() {
    return document.documentElement.classList.contains('ml-dark');
  }

  function initAurora(canvas) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    let sprites = [];   // 预烘焙光斑精灵（离屏 canvas）
    let blobs = [];     // 光斑运动参数
    let rafId = 0;
    let enabled = false;
    let lastDraw = 0;
    let clearTimer = 0;

    /** 预烘焙一枚光斑精灵：径向渐变中心实、边缘透明（只在初始化/换主题时执行）。 */
    function makeSprite(color) {
      const s = 256;
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, hexToRgba(color, PARAMS.coreAlpha));
      grad.addColorStop(0.55, hexToRgba(color, PARAMS.coreAlpha * 0.35));
      grad.addColorStop(1, hexToRgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
      return c;
    }

    function buildSprites() {
      const colors = isDark() ? PARAMS.colorsDark : PARAMS.colorsLight;
      sprites = colors.map(makeSprite);
    }

    function buildBlobs() {
      blobs = [];
      for (let i = 0; i < PARAMS.blobCount; i++) {
        blobs.push({
          bx: 0.12 + rnd() * 0.76,                    // 基准位置 x（0~1）
          by: 0.15 + rnd() * 0.7,                     // 基准位置 y（0~1）
          r: PARAMS.radiusMin + rnd() * (PARAMS.radiusMax - PARAMS.radiusMin),
          orbit: PARAMS.orbitMin + rnd() * (PARAMS.orbitMax - PARAMS.orbitMin),
          sm: 0.6 + rnd() * 0.8,                      // 速度倍率（各光斑不同步）
          ph: rnd() * Math.PI * 2,                    // 初相位
          a: 0.5 + rnd() * 0.5,                       // 单光斑透明度系数
        });
      }
    }

    /** 画布物理分辨率 = CSS 尺寸 × min(dpr, maxDpr) × renderScale。 */
    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, PARAMS.maxDpr);
      const scale = dpr * PARAMS.renderScale;
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
    }

    /** 主题应用：整体透明度 + 精灵换色。 */
    function applyTheme() {
      canvas.style.opacity = String(isDark() ? PARAMS.alphaDark : PARAMS.alphaLight);
      buildSprites();
    }

    /** 渲染一帧；t 为秒。 */
    function render(t) {
      const w = canvas.width;
      const h = canvas.height;
      const m = Math.min(w, h);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = isDark() ? 'lighter' : 'source-over';
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        // 双轴异相椭圆轨道 + 半径轻呼吸：缓慢、永不重复同一路径
        const x = (b.bx + Math.cos(t * PARAMS.speed * b.sm + b.ph) * b.orbit) * w;
        const y = (b.by + Math.sin(t * PARAMS.speed * b.sm * 0.83 + b.ph * 1.7) * b.orbit) * h;
        const r = b.r * m * (1 + 0.08 * Math.sin(t * PARAMS.speed * 0.5 + b.ph * 3));
        ctx.globalAlpha = b.a;
        ctx.drawImage(sprites[i % sprites.length], x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(now) {
      rafId = 0;
      if (!enabled) return;
      if (document.hidden) {
        // 后台暂停：挂起重启链，回到前台时由 visibilitychange 唤醒
        return;
      }
      // 帧率上限：距上一帧不足一个节拍则跳过本次绘制
      if (now - lastDraw < 1000 / PARAMS.fpsCap - 1) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      lastDraw = now;
      render(now / 1000);
      rafId = requestAnimationFrame(frame);
    }

    function ensureRunning() {
      if (!rafId && enabled && !PARAMS.reducedMotion) rafId = requestAnimationFrame(frame);
    }

    function setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      window.clearTimeout(clearTimer);
      if (enabled) {
        resize();
        applyTheme();
        if (PARAMS.reducedMotion) {
          // 降级选型（SPEC §5）：保留「极简」档——渲染一帧静态氛围，不启动循环
          render(7.3);
          return;
        }
        ensureRunning();
      } else {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        canvas.style.opacity = '0'; // CSS transition 负责淡出
        clearTimer = window.setTimeout(function () {
          if (!enabled && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }, 240);
      }
    }

    /* 尺寸变化：重建画布分辨率；降级静态帧同步重绘 */
    window.addEventListener('resize', function () {
      if (!enabled) return;
      resize();
      if (PARAMS.reducedMotion) render(7.3);
    });

    /* 页面回到前台：rAF 重启链（若此前被守卫截断） */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) ensureRunning();
    });

    /* 主题切换（由演示页控制器派发）：换精灵配色与整体透明度 */
    document.addEventListener('ml-theme-change', function () {
      applyTheme();
      if (enabled && PARAMS.reducedMotion) render(7.3);
    });

    return { root: canvas, setEnabled: setEnabled };
  }

  /* 自动初始化：见 parallax.js 底部说明 */
  window.MLAdvanced = window.MLAdvanced || {};
  const rootEl = document.querySelector('[data-ml-aurora]');
  const handle = initAurora(rootEl);
  window.MLAdvanced.aurora = handle;
  if (handle && rootEl.getAttribute('data-ml-enabled') !== 'false') {
    handle.setEnabled(true);
  }
})();

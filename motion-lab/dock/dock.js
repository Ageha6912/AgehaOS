/* ==========================================================================
 * motion-lab/dock/dock.js — Dock 放大波浪（rAF 驱动，仅 transform）
 * --------------------------------------------------------------------------
 * 实现约定（SPEC §1.3 距离衰减波浪 / §3 实现铁律）：
 * · 波形公式：scale = 1 + (maxScale-1)·exp(-d²/2σ²)，d 为指针到图标中心的
 *   水平距离，σ = PARAMS.falloffRadius——近者放大多、远者趋于 1，连续无跳变。
 * · 1:1 跟随：pointermove 回调只记录坐标（数据），每帧在 rAF 里统一计算并
 *   写入 transform——帧内零布局读取。图标中心坐标在初始化 / resize /
 *   pointerenter 时一次性实测缓存（scale 以中心为原点，中心 x 不随缩放漂移，
 *   缓存恒定有效）。
 * · 进入/收敛包络：指针进入时整体幅度用 enterMs 起势、离开后用 settleMs
 *   收敛回落（SPEC §2「收敛 200ms 级」）；包络只是幅度外衣，包络满格期间
 *   波形严格 1:1 跟随指针。中途进入/离开都从当前包络值续算，可随时反向
 *   （SPEC §3.6 可中断）。
 * · will-change 纪律：波浪即将发生（pointerenter）时挂载，收敛完成后移除
 *   （SPEC §3.5），不常驻占用合成层预算。
 * · prefers-reduced-motion: reduce：整体关闭波浪 / 按压 / 上浮（rAF 不启动），
 *   只保留悬停变色（CSS 侧），并实时响应系统开关变化（SPEC §5）。
 *
 * 与规范的差异（以需求为准）：无——文件名 dock.js 对应 SPEC §4 的 script.js。
 * ========================================================================== */
'use strict';

/**
 * 模块动效参数——按性能表现微调时只改这里（全部中文注释）。
 * 时长字段对应 shared/tokens.css 的时长档（150/200/250/300ms 铁律档），
 * 令牌层在 prefers-reduced-motion 下会自动塌缩，但本模块波浪由 rAF 驱动，
 * 降级开关看下方 REDUCED 检测，不依赖时长塌缩。
 */
const PARAMS = {
  maxScale: 1.6,           // 波峰放大上限（倍）。波峰上探 ≈ icon-size×(maxScale-1)/2 + liftHeight
  falloffRadius: 68,       // 高斯衰减宽度 σ（px）：越大波浪越宽；过宽会使相邻图标在波峰处重叠
                           //  （本模块只允许 scale + translateY，不能横向推开邻居），建议 ≤ 1.2×图标间距
  liftHeight: 6,           // 波峰处图标额外上浮高度（px），随放大比例线性参与
  enterMs: 150,            // 指针进入 Dock 时波浪起势时长 ms（对应令牌 --ml-dur-fast 档；
                           //   仅作用于整体幅度包络，包络满格后波形 1:1 跟随指针，无滞后）
  settleMs: 200,           // 指针离开后收敛回落时长 ms（对应令牌 --ml-dur-base 档，SPEC §2 约定 200ms 级）
  ease: [0.2, 0, 0, 1],    // 起势 / 收敛共用曲线：与令牌 --ml-ease-standard 同值的贝塞尔控制点，
                           //   rAF 侧无法直接引用 CSS 变量，故在此同值声明（令牌注释互指）
  pressScale: 0.94,        // 按下瞬间图标的压缩倍率（物理按压反馈；1 = 关闭该反馈）
  pressTauMs: 60,          // 按压缩放指数平滑时间常数 ms（越小越跟手；≈ --ml-dur-fast 档的手感）
};

/* --------------------------------------------------------------------------
 * 纯函数（便于 Node 单测 dock.test.mjs 直接验证）
 * ------------------------------------------------------------------------ */

/** 三次贝塞尔 y(x) 求值，语义与 CSS cubic-bezier(x1,y1,x2,y2) 完全一致。
 * ease 为 [x1, y1, x2, y2]，t 为时间进度（0~1），返回路径进度。 */
function cubicBezierAt(ease, t) {
  const x1 = ease[0], y1 = ease[1], x2 = ease[2], y2 = ease[3];
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // 贝塞尔分量式：B(s) = 3(1-s)²s·c1 + 3(1-s)s²·c2 + s³
  const comp = (s, c1, c2) => 3 * (1 - s) * (1 - s) * s * c1 + 3 * (1 - s) * s * s * c2 + s * s * s;
  // 先二分求解 x(s) = t，再代回 y(s)（x(s) 单调，二分稳定）
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) {
    const x = comp(s, x1, x2);
    if (Math.abs(x - t) < 1e-5) break;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return comp(s, y1, y2);
}

/** 高斯衰减：scale = 1 + (max-1)·exp(-d²/2σ²)（SPEC §1.3 公式原文） */
function gaussianScale(distPx, sigma, maxScale) {
  const s = Math.max(sigma, 1); // 防御：σ 不得为 0
  return 1 + (maxScale - 1) * Math.exp(-(distPx * distPx) / (2 * s * s));
}

/** 单图标目标 scale = 高斯波形 × 进入包络（influence 0~1）。 */
function iconScale(distPx, influence, p) {
  const wave = gaussianScale(Math.abs(distPx), p.falloffRadius, p.maxScale);
  return 1 + (wave - 1) * Math.min(1, Math.max(0, influence));
}

/* --------------------------------------------------------------------------
 * 主流程（浏览器环境执行；Node 单测环境无 document，自动跳过）
 * ------------------------------------------------------------------------ */

function main() {
  const dock = document.getElementById('dock');
  if (!dock) return;

  const buttons = Array.from(dock.querySelectorAll('.dock-icon'));
  const items = buttons.map((btn) => ({
    btn,
    tile: btn.querySelector('.dock-icon__tile'),
    cx: 0,        // 图标中心 x（视口坐标，实测缓存）
    press: 1,     // 当前按压系数（1 = 未按压）
    lastS: 1,     // 上一帧写入的 scale（变化阈值判据，避免无效样式写入）
    lastLift: 0,  // 上一帧写入的上浮量
  }));

  // 运行时状态集中一处；事件回调只写状态，rAF 帧内只读状态、只写 transform
  const state = {
    pointerX: 0,      // 指针视口 x
    inside: false,    // 指针是否在 Dock 内
    influence: 0,     // 当前进入包络 0~1（0 = 波浪完全收起）
    inflFrom: 0, inflTo: 0, inflStart: 0, inflDur: 0,
    pressed: -1,      // 被按下的图标下标（-1 = 无）
    activeIndex: -1,  // 当前激活（显示发光点）的图标下标
    raf: 0,
    lastT: 0,
  };

  // 降级检测（SPEC §5）：rAF 模块必须自行 matchMedia，且实时响应开关变化
  const REDUCED_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** 一次性布局实测（仅初始化 / resize / pointerenter 时执行，帧内禁止调用） */
  function measure() {
    for (const it of items) {
      const r = it.btn.getBoundingClientRect();
      it.cx = r.left + r.width / 2;
    }
  }

  function setWillChange(on) {
    // SPEC §3.5：只在动效即将发生前挂载，结束后移除
    for (const it of items) it.tile.style.willChange = on ? 'transform' : '';
  }

  /** 启动一段包络动画（从当前包络值续算，可中断可反向——SPEC §3.6） */
  function startInfluence(to, durMs) {
    state.inflFrom = state.influence;
    state.inflTo = to;
    state.inflStart = performance.now();
    state.inflDur = durMs;
  }

  function ensureLoop() {
    if (!state.raf) {
      state.lastT = 0;
      state.raf = requestAnimationFrame(frame);
    }
  }

  /** 逐帧主循环：只写 transform（translateY + scale），不读任何布局 */
  function frame(now) {
    state.raf = 0;
    const dt = Math.min(64, state.lastT ? now - state.lastT : 16);
    state.lastT = now;

    // 1) 进入 / 收敛包络（共用 --ml-ease-standard 同款贝塞尔）
    if (state.inflDur > 0) {
      const t = Math.min(1, (now - state.inflStart) / state.inflDur);
      state.influence = state.inflFrom + (state.inflTo - state.inflFrom) * cubicBezierAt(PARAMS.ease, t);
      if (t >= 1) { state.influence = state.inflTo; state.inflDur = 0; }
    } else {
      state.influence = state.inflTo;
    }

    // 2) 逐图标：按压平滑 → 合成 scale → 写 transform
    const EPS = 0.0005;
    let settled = state.inflDur === 0 && state.influence <= EPS && state.pressed < 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      // 按压系数指数平滑：从当前值续动，随时可被抬起打断
      const pressTarget = state.pressed === i ? PARAMS.pressScale : 1;
      if (Math.abs(it.press - pressTarget) > 0.0004) {
        it.press += (pressTarget - it.press) * (1 - Math.exp(-dt / PARAMS.pressTauMs));
        if (Math.abs(it.press - pressTarget) < 0.0004) it.press = pressTarget;
        settled = false;
      }

      // 波形 scale + 上浮量（未进入时恒等）
      let s = 1;
      let lift = 0;
      if (state.influence > EPS) {
        s = iconScale(state.pointerX - it.cx, state.influence, PARAMS) * it.press;
        lift = PARAMS.liftHeight * Math.min(1, (s - 1) / (PARAMS.maxScale - 1));
      } else if (it.press !== 1) {
        s = it.press; // 纯按压（触屏点按等）也保留物理反馈
      }
      if (Math.abs(s - 1) > EPS) settled = false;

      // 变化阈值：静止时不产生无效样式写入
      if (Math.abs(s - it.lastS) > EPS || Math.abs(lift - it.lastLift) > 0.05) {
        // translateY 写在 scale 之前：上浮量不随缩放被放大
        it.tile.style.transform = 'translateY(' + (-lift).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
        it.lastS = s;
        it.lastLift = lift;
      }
    }

    // 3) 完全收起：归位、摘 will-change、停表（SPEC §3.5）
    if (settled) {
      for (const it of items) {
        it.tile.style.transform = '';
        it.tile.style.willChange = '';
        it.press = 1; it.lastS = 1; it.lastLift = 0;
      }
      state.influence = 0;
      state.lastT = 0;
      return;
    }
    state.raf = requestAnimationFrame(frame);
  }

  /* ---------------------- 指针事件（回调只记数据） ---------------------- */

  dock.addEventListener('pointerenter', (e) => {
    state.pointerX = e.clientX;
    if (REDUCED_MQ.matches) return; // 降级：不启动波浪（SPEC §5）
    measure();                      // 一次性布局实测（非逐帧）
    state.inside = true;
    startInfluence(1, PARAMS.enterMs);
    setWillChange(true);
    ensureLoop();
  });

  dock.addEventListener('pointermove', (e) => {
    // 只记数据，计算留给 rAF（SPEC §3.3：事件回调里只记数据）
    state.pointerX = e.clientX;
  });

  dock.addEventListener('pointerleave', () => {
    state.inside = false;
    if (REDUCED_MQ.matches) return;
    // 离开 → settleMs 收敛回落（SPEC §1.3 / §2：200ms 级）
    startInfluence(0, PARAMS.settleMs);
    ensureLoop();
  });

  /* ---------------------- 按压反馈 + 点击切换激活态 ---------------------- */

  function clearPress() {
    state.pressed = -1;
    if (!REDUCED_MQ.matches) ensureLoop();
  }

  items.forEach((it, i) => {
    it.btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // 仅主键
      if (REDUCED_MQ.matches) return;                          // 降级：无按压动画
      state.pressed = i;
      ensureLoop();
    });

    // 点击图标切换激活态演示：再次点击已激活图标则取消
    it.btn.addEventListener('click', () => {
      const next = state.activeIndex === i ? -1 : i;
      if (state.activeIndex >= 0) {
        buttons[state.activeIndex].classList.remove('is-active');
        buttons[state.activeIndex].setAttribute('aria-pressed', 'false');
      }
      state.activeIndex = next;
      if (next >= 0) {
        buttons[next].classList.add('is-active');
        buttons[next].setAttribute('aria-pressed', 'true');
      }
    });
  });

  window.addEventListener('pointerup', clearPress);
  window.addEventListener('pointercancel', clearPress);

  /* ---------------------- resize：rAF 去抖后重新实测 ---------------------- */

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      measure(); // 中心 x 不随 scale 漂移，波浪进行中实测依然有效
    });
  });

  /* ---------------------- 降级开关实时响应（SPEC §5） ---------------------- */

  function applyReduced() {
    if (!REDUCED_MQ.matches) return;
    state.inside = false;
    state.pressed = -1;
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    for (const it of items) {
      it.tile.style.transform = '';
      it.tile.style.willChange = '';
      it.press = 1; it.lastS = 1; it.lastLift = 0;
    }
    state.influence = 0; state.inflTo = 0; state.inflDur = 0;
  }
  if (typeof REDUCED_MQ.addEventListener === 'function') {
    REDUCED_MQ.addEventListener('change', applyReduced);
  }

  /* ---------------------- 初始激活：访达 ---------------------- */

  buttons[0].classList.add('is-active');
  buttons[0].setAttribute('aria-pressed', 'true');
  state.activeIndex = 0;

  /* ---------------------- 深浅色切换（验证 ml-dark 一键切换，SPEC §6） ---- */

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const syncLabel = () => {
      const dark = root.classList.contains('ml-dark');
      themeBtn.textContent = dark ? '浅色' : '深色'; // 按钮文案 = 点击后进入的主题
      themeBtn.setAttribute('aria-pressed', String(dark));
    };
    if (prefersDark.matches) root.classList.add('ml-dark');
    syncLabel();
    themeBtn.addEventListener('click', () => {
      root.classList.toggle('ml-dark');
      syncLabel();
    });
  }

  measure();
}

/* 浏览器执行入口；Node 单测环境无 document，自动跳过 */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
}

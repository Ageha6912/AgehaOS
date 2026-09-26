/* ==========================================================================
 * motion-lab/window/window.js — 窗口开合 / Genie 最小化演示逻辑
 * --------------------------------------------------------------------------
 * 职责：窗口生命周期状态机（closed / open / minimized）+ 全部动效驱动。
 * 实现约定：
 * · 所有动效只用 transform / opacity，经 Web Animations API（WAAPI）在
 *   合成器上运行；没有 rAF 逐帧循环（本模块无指针连续跟随类动效），
 *   几何读取（getBoundingClientRect）只发生在手势触发的一瞬间，不逐帧读。
 * · 来源锚定（SPEC §1.1）：打开/关闭的 transform-origin 投影到该窗口对应
 *   的 Dock 图标；最小化/还原直接沿「窗口中心 → 图标中心」的位移路径飞行，
 *   还原 = 同一条动画 anim.reverse() 反向播放（时间镜像 → 路径严格对称）。
 * · 可中断（SPEC §3.6）：飞行中点反向操作走 anim.reverse() 从当前呈现值
 *   续动；交叉操作（如最小化途中直接关闭）先快进落定到当前目标终态再执行，
 *   任何时刻输入都不被锁。
 * · 降级（任务 #6 / SPEC §5）：prefers-reduced-motion: reduce 下所有状态
 *   变化瞬时直达终态，不启动任何动画；matchMedia 实时响应系统开关变化。
 *   降级形态选型：进出场类「瞬时切换」（任务明确要求，覆盖 SPEC 的
 *   「≤150ms 交叉淡化」选项）。
 * ========================================================================== */
'use strict';

/**
 * 模块动效参数——按性能表现微调时只改这里（全部中文注释）。
 * 时长档位与 shared/tokens.css 的 --ml-dur-* 同源（铁律 150~300ms）；
 * 贝塞尔控制点与 --ml-ease-* 令牌同值，改令牌时需同步此处。
 */
const PARAMS = {
  /* —— 时长（对应令牌档位）—— */
  openMs: 200,          // 打开时长 ms，--ml-dur-base 同值（任务：约 200ms）
  closeMs: 150,         // 关闭时长 ms，--ml-dur-fast 同值（退场降一档，恒短于打开，SPEC §1.4）
  flightMs: 300,        // genie 最小化/还原飞行时长 ms，--ml-dur-slow 同值（本模块最大位移取最高档）；还原反向共用此时长
  autoOpenDelayMs: 400, // 载入后自动演示打开「备忘录」的等待 ms（启动延迟，非过渡时长，不受 150~300 约束）

  /* —— 曲线（WAAPI 用控制点，与令牌同值）—— */
  openEase: [0.32, 0.72, 0, 1],       // 打开：--ml-ease-spring 同值（弹簧近似、无真过冲的冲劲）
  closeEase: [0.55, 0, 1, 0.45],      // 关闭：--ml-ease-in 同值（加速退场，消失比出现快）
  flightEaseLeg1: [0.55, 0, 1, 0.45], // genie 前段（离窗俯冲加速）：--ml-ease-in 同值
  flightEaseLeg2: [0.2, 0, 0, 1],     // genie 后段（缓收落进 Dock）：--ml-ease-standard 同值

  /* —— 缩放幅度 —— */
  openScaleFrom: 0.9,   // 打开起始缩放（任务指定 0.9，越小弹性感越强）
  closeScaleTo: 0.92,   // 关闭终态缩放（任务指定 0.92，路径与打开对称但行程略短）
  minScaleX: 0.08,      // 落入 Dock 时横向缩放（任务：约 0.08）
  minScaleY: 0.04,      // 落入 Dock 时纵向压扁 = 横向一半，genie 挤扁感
  midOffset: 0.55,      // genie 中段关键帧的时间位置（0~1）
  midTravelX: 0.45,     // 中段横向行程比例（<0.5）
  midTravelY: 0.6,      // 中段纵向行程比例（>横向 → 先坠后收，飞出弧线）
  midScaleX: 0.5,       // 中段横向缩放
  midScaleY: 0.32,      // 中段纵向缩放（压扁开始）
  midOpacity: 0.8,      // 中段透明度

  /* —— 来源锚定（transform-origin 投影限幅，防极端远的图标产生怪异支点）—— */
  originClampX: [-50, 150], // 横向投影限幅 %
  originClampY: [100, 140], // 纵向投影限幅 %（Dock 恒在窗口下方，投影 ≥100%）

  /* —— 可访问性 —— */
  reducedMotion: false, // 运行时由 matchMedia('(prefers-reduced-motion: reduce)') 检测覆写（SPEC §5），不许手填
};

/* ========================== 运行时环境检测 ================================ */
const REDUCED_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = REDUCED_MQ.matches; // 实时检测，不手填 PARAMS.reducedMotion
REDUCED_MQ.addEventListener('change', (e) => { reducedMotion = e.matches; });

/* ========================== 小工具 ======================================== */
const bezier = (p) => `cubic-bezier(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]})`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ========================== 状态机定义 ====================================
 * win.state = 静息状态（closed | open | minimized）；
 * win.animGoal = 飞行中的目标态（open | close | minimize | restore），
 * effState() 返回「有效状态」：飞行中视为目标态，用于按钮可用性与路由。
 */
const GOAL_STATE = { open: 'open', close: 'closed', minimize: 'minimized', restore: 'open' };
const REVERSE_PAIR = { open: 'close', close: 'open', minimize: 'restore', restore: 'minimize' };

const wins = [];             // 窗口记录表
let focused = null;          // 当前焦点窗口
let focusSeq = 0;            // 聚焦序号（兼作窗口层内 zIndex）
const minimizedStack = [];   // 最小化栈：最后最小化的最先还原

function effState(win) {
  return win.animGoal ? GOAL_STATE[win.animGoal] : win.state;
}

/* ========================== DOM 收集 ====================================== */
const stage = document.getElementById('stage');
const btnOpen = document.getElementById('btn-open');
const btnClose = document.getElementById('btn-close');
const btnMin = document.getElementById('btn-min');
const btnRestore = document.getElementById('btn-restore');
const focusHint = document.getElementById('focus-hint');
const themeToggle = document.getElementById('theme-toggle');

document.querySelectorAll('.win').forEach((el) => {
  const app = el.dataset.app;
  const icon = document.querySelector(`.dock-icon[data-app="${app}"]`);
  wins.push({
    app,
    title: el.querySelector('.win__title').textContent,
    el,
    icon,
    state: 'closed',
    anim: null,
    animGoal: null,
    focusSeq: 0,
  });
});

/* ========================== 终态落定 ======================================
 * 把窗口直接置为 animGoal 对应的终态（动画正常结束 / 中断快进 / 降级直达，
 * 三条路共用这一份落定逻辑）。顺序：先置类与内联终态 → 再取消动画，避免闪帧。
 */
function applyEndState(win) {
  const goal = win.animGoal;
  if (!goal) return;
  win.animGoal = null;

  switch (goal) {
    case 'open':
      win.state = 'open';
      win.el.classList.remove('is-closed', 'is-minimized');
      break;
    case 'close':
      win.state = 'closed';
      win.el.classList.remove('is-minimized');
      win.el.classList.add('is-closed');
      break;
    case 'minimize':
      win.state = 'minimized';
      win.el.classList.add('is-minimized');
      if (!minimizedStack.includes(win)) minimizedStack.push(win);
      break;
    case 'restore':
      win.state = 'open';
      win.el.classList.remove('is-minimized', 'is-closed');
      const i = minimizedStack.indexOf(win);
      if (i >= 0) minimizedStack.splice(i, 1);
      break;
  }

  /* 清内联位姿（restore 起飞前挂的 Dock 位姿等）——必须在 cancel 之前，
     此时动画仍持有终态/恒等位姿，视觉与清空后一致，无闪帧。 */
  win.el.style.transform = '';
  win.el.style.opacity = '';
  win.el.style.transformOrigin = '';
  if (win.anim) {
    win.anim.cancel();
    win.anim = null;
  }

  if (goal === 'open' || goal === 'restore') {
    focus(win);
  } else if (focused === win) {
    focusTopmost(); // 关闭/最小化后把焦点让给剩余最上层窗口
  }
  syncDots();
  syncControls();
}

/* ========================== 焦点管理 ====================================== */
function focus(win) {
  if (effState(win) !== 'open') return;
  focused = win;
  win.focusSeq = ++focusSeq;
  win.el.style.zIndex = String(win.focusSeq); // 层内互比，被 .win-layer 的 z 档约束住
  wins.forEach((w) => w.el.classList.toggle('is-focused', w === win));
  syncControls();
}

function focusTopmost() {
  const open = wins.filter((w) => effState(w) === 'open');
  if (!open.length) {
    focused = null;
    wins.forEach((w) => w.el.classList.remove('is-focused'));
    syncControls();
    return;
  }
  focus(open.reduce((a, b) => (b.focusSeq > a.focusSeq ? b : a)));
}

/* ========================== 几何读取（手势瞬间一次性） ==================== */
/* 窗口中心 → Dock 图标中心 的位移（要求窗口此刻无 transform 残留） */
function dockDelta(win, fromRect) {
  const r = fromRect || win.el.getBoundingClientRect();
  const ir = win.icon.getBoundingClientRect();
  return {
    dx: ir.left + ir.width / 2 - (r.left + r.width / 2),
    dy: ir.top + ir.height / 2 - (r.top + r.height / 2),
  };
}

/* 把 transform-origin 投影到 Dock 图标中心（SPEC §1.1 来源锚定），并限幅 */
function originTowardIcon(win) {
  const r = win.el.getBoundingClientRect();
  const ir = win.icon.getBoundingClientRect();
  const x = clamp(((ir.left + ir.width / 2 - r.left) / r.width) * 100, PARAMS.originClampX[0], PARAMS.originClampX[1]);
  const y = clamp(((ir.top + ir.height / 2 - r.top) / r.height) * 100, PARAMS.originClampY[0], PARAMS.originClampY[1]);
  return `${x.toFixed(1)}% ${y.toFixed(1)}%`;
}

/* ========================== 动效 ========================================== */
/* 打开：scale 0.9→1 + fade，origin 指向 Dock 图标（从触发源长出来） */
function playOpen(win) {
  const el = win.el;
  el.classList.remove('is-closed'); // 先回到布局流，才能测量
  el.style.transformOrigin = originTowardIcon(win);
  const anim = el.animate(
    [
      { transform: `scale(${PARAMS.openScaleFrom})`, opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: PARAMS.openMs, easing: bezier(PARAMS.openEase), fill: 'both' }
  );
  win.anim = anim;
  win.animGoal = 'open';
  anim.onfinish = () => applyEndState(win);
  focus(win);
  syncControls();
}

/* 关闭：同一条路径反向（origin 与打开一致），恒短于打开 */
function playClose(win) {
  const el = win.el;
  el.style.transformOrigin = originTowardIcon(win);
  const anim = el.animate(
    [
      { transform: 'scale(1)', opacity: 1 },
      { transform: `scale(${PARAMS.closeScaleTo})`, opacity: 0 },
    ],
    { duration: PARAMS.closeMs, easing: bezier(PARAMS.closeEase), fill: 'both' }
  );
  win.anim = anim;
  win.animGoal = 'close';
  anim.onfinish = () => applyEndState(win);
  syncControls();
}

/* genie 飞行：位移 + 横向缩到 0.08 + 纵向压扁 + 渐隐，落向 Dock 图标。
   toDock=true 最小化；false 还原 = 同一组关键帧建好后 anim.reverse()
   反向播放（时间镜像 → 路径/节奏严格对称，SPEC §1.1 镜像公式）。 */
function playDockFlight(win, toDock, delta) {
  const el = win.el;
  el.style.transformOrigin = '50% 50%'; // 位移按窗口中心计算，origin 归中
  const { dx, dy } = delta || dockDelta(win);
  const fx = (v) => `${v.toFixed(1)}px`;
  const anim = el.animate(
    [
      {
        transform: 'translate(0px, 0px) scale(1, 1)',
        opacity: 1,
        offset: 0,
        easing: bezier(PARAMS.flightEaseLeg1), // 前段：离窗俯冲加速
      },
      {
        transform: `translate(${fx(dx * PARAMS.midTravelX)}, ${fx(dy * PARAMS.midTravelY)})`
          + ` scale(${PARAMS.midScaleX}, ${PARAMS.midScaleY})`,
        opacity: PARAMS.midOpacity,
        offset: PARAMS.midOffset,
        easing: bezier(PARAMS.flightEaseLeg2), // 后段：缓收落进 Dock
      },
      {
        transform: `translate(${fx(dx)}, ${fx(dy)}) scale(${PARAMS.minScaleX}, ${PARAMS.minScaleY})`,
        opacity: 0,
        offset: 1,
      },
    ],
    { duration: PARAMS.flightMs, fill: 'both' }
  );
  win.anim = anim;
  win.animGoal = toDock ? 'minimize' : 'restore';
  anim.onfinish = () => applyEndState(win);
  if (!toDock) anim.reverse(); // 从 Dock 位姿反向播放回恒等位姿
  syncControls();
}

/* ========================== 生命周期操作 ==================================
 * 统一的中断处理：请求的目标若与当前飞行互为反向 → anim.reverse() 半途抓回；
 * 其余交叉中断 → 快进落定到当前目标终态（applyEndState）再继续。
 */
function toggleFlight(win, goal) {
  if (win.anim && win.animGoal === REVERSE_PAIR[goal]) {
    win.animGoal = goal;
    win.anim.reverse();
    syncControls();
    return true;
  }
  return false;
}

function openWindow(win) {
  if (reducedMotion) { win.animGoal = 'open'; applyEndState(win); return; }
  if (toggleFlight(win, 'open')) return;       // 关闭途中 → 反向变打开
  if (win.anim) applyEndState(win);            // 交叉中断：先落定再继续
  if (effState(win) === 'open') { focus(win); return; }
  if (effState(win) === 'minimized') { restoreWindow(win); return; }
  playOpen(win);
}

function closeWindow(win) {
  if (reducedMotion) { win.animGoal = 'close'; applyEndState(win); return; }
  if (toggleFlight(win, 'close')) return;      // 打开途中 → 反向变关闭
  if (win.anim) applyEndState(win);
  if (effState(win) !== 'open') return;        // 已关闭 / 最小化中不可关
  playClose(win);
}

function minimizeWindow(win) {
  if (reducedMotion) { win.animGoal = 'minimize'; applyEndState(win); return; }
  if (toggleFlight(win, 'minimize')) return;   // 还原途中 → 半途抓回 Dock
  if (win.anim) applyEndState(win);
  if (effState(win) !== 'open') return;
  playDockFlight(win, true);
}

function restoreWindow(win) {
  if (reducedMotion) { win.animGoal = 'restore'; applyEndState(win); return; }
  if (toggleFlight(win, 'restore')) return;    // 最小化途中 → 半途抓回桌面
  if (win.anim) applyEndState(win);
  if (effState(win) !== 'minimized') return;
  /* 测量要在挂内联位姿之前：is-minimized 用 visibility:hidden，布局盒仍可
     测量且此刻无 transform 残留（restore 的起点几何必须干净）。 */
  const r = win.el.getBoundingClientRect();
  const delta = dockDelta(win, r);
  win.el.style.transform =
    `translate(${delta.dx.toFixed(1)}px, ${delta.dy.toFixed(1)}px) scale(${PARAMS.minScaleX}, ${PARAMS.minScaleY})`;
  win.el.style.opacity = '0';
  win.el.classList.remove('is-minimized'); // 可见但仍在 Dock 位姿（内联 + fill:both 双保险）
  playDockFlight(win, false, delta);
}

/* ========================== 视图同步 ====================================== */
function syncDots() {
  wins.forEach((w) => {
    const s = effState(w);
    w.icon.classList.toggle('is-running', s === 'open');
    w.icon.classList.toggle('is-minimized', s === 'minimized');
    w.icon.setAttribute('aria-pressed', s !== 'closed' ? 'true' : 'false');
  });
}

function syncControls() {
  const f = focused ? effState(focused) : null;
  btnOpen.disabled = !wins.some((w) => effState(w) === 'closed');
  btnClose.disabled = f !== 'open';
  btnMin.disabled = f !== 'open';
  btnRestore.disabled = !wins.some((w) => effState(w) === 'minimized');
  focusHint.textContent = focused
    ? `焦点：${focused.title}${focused.animGoal ? '（过渡中）' : ''}`
    : '焦点：无（点击窗口聚焦）';
}

/* ========================== 事件绑定 ====================================== */
wins.forEach((win) => {
  /* 点击窗口任意处聚焦（pointerdown 反馈最即时） */
  win.el.addEventListener('pointerdown', () => {
    if (effState(win) === 'open') focus(win);
  });
  /* 红绿灯：关 / 最小化（原生 button，键盘可达） */
  win.el.querySelector('.traffic__btn--close').addEventListener('click', () => closeWindow(win));
  win.el.querySelector('.traffic__btn--min').addEventListener('click', () => minimizeWindow(win));
  /* Dock 图标：关→打开、最小化→还原、开着→聚焦（macOS 惯例） */
  win.icon.addEventListener('click', () => {
    const s = effState(win);
    if (s === 'closed') openWindow(win);
    else if (s === 'minimized') restoreWindow(win);
    else focus(win);
  });
});

btnOpen.addEventListener('click', () => {
  const target = wins.find((w) => effState(w) === 'closed');
  if (target) openWindow(target);
});
btnClose.addEventListener('click', () => { if (focused) closeWindow(focused); });
btnMin.addEventListener('click', () => { if (focused) minimizeWindow(focused); });
btnRestore.addEventListener('click', () => {
  const target = minimizedStack[minimizedStack.length - 1]; // 最后最小化的最先还原
  if (target) restoreWindow(target);
});

/* 深浅色一键切换（SPEC §6：ml-dark 不破相验收） */
themeToggle.addEventListener('click', () => {
  const dark = stage.classList.toggle('ml-dark');
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.textContent = dark ? '浅色' : '深色';
});

/* ========================== 初始化 ======================================== */
syncDots();
syncControls();
/* 载入后自动演示一次「打开」（窗口从 Dock 图标弹性长出）；reduced 下直达终态 */
setTimeout(() => {
  const first = wins.find((w) => w.app === 'notes');
  if (first) openWindow(first);
}, PARAMS.autoOpenDelayMs);

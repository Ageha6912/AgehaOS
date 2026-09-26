/* ==========================================================================
 * menu-toast.js — AgehaOS 动效实验室 · 菜单与通知模块
 * --------------------------------------------------------------------------
 * 架构约定（与 menu-toast.css 头注释互指）——双层分离：
 *   定位层（.ml-pop / .ml-toast-slot）：只承担 translate(x,y) 摆位，不挂过渡；
 *   动效层（.ml-pop-card / .ml-toast）：只过渡 opacity + transform。
 * 好处：右键换位时定位瞬时更新互不干扰；CSS transition 天然可中断
 * （SPEC §3.6），进出场半途反向时从当前呈现值续动，不锁输入。
 *
 * 计时器纪律（需求第 3 条「出现时清理计时器避免内存泄漏」）：
 *   所有 setTimeout 句柄集中保存（弹层 openTimer/closeTimer、通知
 *   dwellTimer/animTimer、连发 burstTimers），出现 / 关闭 / 换位重开前一律
 *   先 clearTimeout；pagehide 时统一清空兜底。
 *
 * 与 SPEC 的差异（需求优先，特此注明）：
 *   1) 菜单进场 150ms ease-out（SPEC §2 表格默认 200ms + --ml-ease-standard）；
 *   2) 顶部下拉沿用与右键菜单完全相同的「上浮 4px」同款动效
 *      （SPEC §2 建议下拉方向随展开向下浮入）；
 *   3) 通知驻留 3s（SPEC §1.4 建议 5s）；滑入改为右上角 translateX
 *      （SPEC §2 顶部横幅为 translateY），形态更贴近 macOS 通知横幅；
 *   4) hover 暂停驻留计时是 SPEC §1.4 的约定，予以保留。
 * ========================================================================== */
'use strict';

/**
 * 模块动效参数——按性能表现微调时只改这里（全部中文注释）。
 * 时长字段均为令牌档位的 JS 侧镜像（CSS 侧 transition 直接引用 var(--ml-dur-*)），
 * JS 只用它们计算「何时移除节点」的兜底等待，保证与 CSS 同源。
 */
const PARAMS = {
  /* —— 菜单（右键上下文菜单 / 顶部下拉共用同款动效） —— */
  menuInMs: 150,       // 进场时长 ms：淡入 + 上浮，对应 --ml-dur-fast（需求指定约 150ms ease-out）
  menuOutMs: 150,      // 退场时长 ms：快速淡出 + 反向微移，对应 --ml-dur-fast + --ml-ease-in（关闭恒不长于打开）
  menuShiftPx: 4,      // 菜单浮出位移 px：translateY 4px→0（需求指定值，写入 CSS 变量 --menu-shift）
  menuEdgeGapPx: 8,    // 菜单贴视口边缘时的最小留白 px（防溢出裁切）
  dropdownGapPx: 6,    // 下拉菜单与触发按钮下缘的间距 px

  /* —— 系统通知 —— */
  toastInMs: 250,      // 滑入时长 ms：translateX + fade，对应 --ml-dur-mid（SPEC §2 通知横幅进场档）
  toastOutMs: 200,     // 滑出时长 ms：translateX 回去 + fade，对应 --ml-dur-base + --ml-ease-in（退场比进场快）
  dwellMs: 3000,       // 驻留时长 ms：需求指定 3 秒（SPEC §1.4 建议 5s，按「需求优先」取 3s，特此注明）
  stackGapPx: 10,      // 多条通知堆叠间距 px（写入 --toast-gap）
  toastOverhangPx: 24, // 滑入/滑出超出通知自身宽度的余量 px（保证完全从屏幕外进出，写入 --toast-overhang）
  toastTopPx: 64,      // 通知容器距视口顶部 px（避让 52px 顶栏，写入 --toast-top）
  toastSidePx: 16,     // 通知容器距视口右侧 px（写入 --toast-side）
  toastWidthPx: 340,   // 通知卡片固定宽度 px（固定宽度 → 高度稳定 → 堆叠位移计算准确）
  burstCount: 3,       // 「连发三条」一次创建的通知条数（演示堆叠与腾位）
  burstGapMs: 350,     // 连发间隔 ms：大于进场时长，「下方腾位、依次就位」才看得清

  /* 运行时状态：prefers-reduced-motion 检测结果（SPEC §5 强制 JS 侧检测），由下方自动覆写，不许手填 */
  reducedMotion: false,
};

/* —— prefers-reduced-motion：JS 侧检测与监听（CSS 侧由令牌自动塌缩到 0.01ms） —— */
const REDUCED_MQ = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : null;
function syncReducedMotion() {
  PARAMS.reducedMotion = REDUCED_MQ ? REDUCED_MQ.matches : false;
}
syncReducedMotion();
if (REDUCED_MQ && typeof REDUCED_MQ.addEventListener === 'function') {
  REDUCED_MQ.addEventListener('change', syncReducedMotion);
}
/** JS 侧等待时长：降级时过渡瞬时完成，兜底等待随之归零（调用方再叠加固定缓冲） */
function jsDur(ms) {
  return PARAMS.reducedMotion ? 0 : ms;
}

/* —— PARAMS → CSS 自定义属性：布局量统一由 JS 下发，调参只动 PARAMS —— */
function applyParamsToCssVars() {
  const pairs = {
    '--menu-shift': PARAMS.menuShiftPx,
    '--toast-gap': PARAMS.stackGapPx,
    '--toast-overhang': PARAMS.toastOverhangPx,
    '--toast-top': PARAMS.toastTopPx,
    '--toast-side': PARAMS.toastSidePx,
    '--toast-width': PARAMS.toastWidthPx,
  };
  for (const [name, value] of Object.entries(pairs)) {
    document.documentElement.style.setProperty(name, value + 'px');
  }
}

const $ = (sel) => document.querySelector(sel);

/* ==========================================================================
 * 通知内容（全部为演示用静态常量，无用户输入；图标为内联 SVG 占位）
 * ========================================================================== */
const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.8-5.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4 7.5l8 6 8-6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 15H3z"/><path d="M12 10.5v3.5"/><path d="M12 16.8h.01"/></svg>',
};
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
const CONTENT = [
  { kind: 'success', title: '备份完成', body: '「文档」已同步至 AgehaOS 云端。' },
  { kind: 'info', title: '系统更新', body: 'AgehaOS 1.1 已就绪，包含菜单与通知动效增强。' },
  { kind: 'mail', title: '新邮件', body: '设计组：通知横幅动效评审通过，可以合入主线。' },
  { kind: 'warn', title: '存储空间', body: '系统盘剩余空间不足 10%，建议清理缓存。' },
];

/* ==========================================================================
 * 弹层控制器（右键上下文菜单与顶部下拉共用）
 * ========================================================================== */
class Popover {
  constructor(root) {
    this.root = root;                            // 定位层
    this.card = root.querySelector('.ml-pop-card'); // 动效层
    this.trigger = null;                         // 下拉菜单的触发按钮；右键菜单为 null
    this.opened = false;
    this.openTimer = 0;
    this.closeTimer = 0;
    // 方向键在菜单项间移动焦点（键盘焦点永不被动效吞掉，SPEC §5）
    this.card.addEventListener('keydown', (e) => this.onCardKeydown(e));
  }

  isOpen() {
    return this.opened;
  }

  /** 在指针位置打开（右键菜单） */
  openAt(px, py) {
    this.open(() => {
      const [x, y] = this.clampToViewport(px, py);
      this.root.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    });
  }

  /** 锚定触发按钮下缘打开（顶部下拉菜单） */
  openFor(trigger) {
    this.trigger = trigger;
    this.open(() => {
      const rect = trigger.getBoundingClientRect();
      const [x, y] = this.clampToViewport(rect.left, rect.bottom + PARAMS.dropdownGapPx);
      this.root.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    });
  }

  /**
   * 统一开层流程。place() 只负责定位层的瞬时摆位；
   * 动效层的进场交给 CSS transition（关闭态 → is-open）。
   */
  open(place) {
    clearTimeout(this.closeTimer);               // 若正在退场，先取消移除计划（可中断续动）
    this.closeTimer = 0;
    if (this.opened) this.snapClosed();          // 已开时换位重开：瞬时回初态，避免从旧位置斜穿
    place();
    this.root.style.visibility = 'visible';
    this.root.setAttribute('aria-hidden', 'false');
    if (this.trigger) this.trigger.setAttribute('aria-expanded', 'true');
    this.opened = true;
    // 动效层进场：淡入 + 上浮 4px→0（150ms ease-out，需求指定）
    this.card.classList.add('is-open');
    this.card.classList.add('is-anim');          // will-change 只在动效期间挂载（SPEC §3.5）
    clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => this.card.classList.remove('is-anim'), jsDur(PARAMS.menuInMs) + 80);
    const first = this.card.querySelector('[role="menuitem"]');
    if (first) first.focus({ preventScroll: true });
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    clearTimeout(this.openTimer);
    if (this.trigger) this.trigger.setAttribute('aria-expanded', 'false');
    // 焦点归还：菜单里还持有焦点时先交还触发按钮，不让焦点消失在隐藏层里
    if (this.card.contains(document.activeElement)) {
      if (this.trigger) this.trigger.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
    // 动效层退场：快速淡出 + 反向微移（150ms ease-in）；CSS transition 可被再次打开中断续动
    this.card.classList.remove('is-open');
    this.card.classList.add('is-anim');
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      this.root.style.visibility = 'hidden';
      this.root.setAttribute('aria-hidden', 'true');
      this.card.classList.remove('is-anim');
      this.closeTimer = 0;
    }, jsDur(PARAMS.menuOutMs) + 80);
  }

  /** 释放计时器（pagehide 兜底清理） */
  dispose() {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.opened = false;
  }

  /** 立即回到关闭初态（换位重开用）：不播动画、只闪一帧布局 */
  snapClosed() {
    clearTimeout(this.openTimer);
    this.card.classList.add('no-anim');
    this.card.classList.remove('is-open', 'is-anim');
    void this.card.offsetWidth;                  // 强制同步布局，让「无过渡初态」先生效
    this.card.classList.remove('no-anim');
  }

  /** 视口边缘收拢：防止菜单在屏幕右/下缘被裁切 */
  clampToViewport(px, py) {
    const width = this.card.offsetWidth;
    const height = this.card.offsetHeight;
    const gap = PARAMS.menuEdgeGapPx;
    const x = Math.min(Math.max(px, gap), window.innerWidth - width - gap);
    const y = Math.min(Math.max(py, gap), window.innerHeight - height - gap);
    return [Math.round(x), Math.round(y)];
  }

  onCardKeydown(e) {
    const items = Array.from(this.card.querySelectorAll('[role="menuitem"]'));
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      items[(index + 1) % items.length].focus({ preventScroll: true });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length].focus({ preventScroll: true });
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus({ preventScroll: true });
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus({ preventScroll: true });
    }
  }
}

/* ==========================================================================
 * 系统通知：右上角滑入 → 驻留（3s，hover 暂停）→ 滑出；多条向下堆叠
 * ========================================================================== */
const toasts = [];        // { slot, card, height, dwellTimer, animTimer, remainMs, stamp, closing }
let toastLayerEl = null;  // 堆叠容器（init 时赋值）
let notifyBtnEl = null;   // 「发一条通知」按钮（焦点归还目标）
let contentIndex = 0;     // 通知内容轮换游标

/** 创建一条通知：定位层入栈 → 批量重排 → 动效层滑入 → 驻留计时 */
function showToast() {
  if (!toastLayerEl) return;
  const data = CONTENT[contentIndex % CONTENT.length];
  contentIndex += 1;

  /* 组装 DOM：图标占位 + 标题/正文 + 关闭按钮 */
  const slot = document.createElement('div');
  slot.className = 'ml-toast-slot';
  const card = document.createElement('div');
  card.className = 'ml-toast';
  const icon = document.createElement('div');
  icon.className = 'ml-toast-icon';
  icon.innerHTML = ICONS[data.kind] || ICONS.info;
  const body = document.createElement('div');
  body.className = 'ml-toast-body';
  const title = document.createElement('div');
  title.className = 'ml-toast-title';
  title.textContent = data.title;
  const text = document.createElement('div');
  text.className = 'ml-toast-text';
  text.textContent = data.body;
  body.appendChild(title);
  body.appendChild(text);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ml-toast-close';
  closeBtn.setAttribute('aria-label', '关闭通知');
  closeBtn.innerHTML = ICON_X;
  card.appendChild(icon);
  card.appendChild(body);
  card.appendChild(closeBtn);
  slot.appendChild(card);
  toastLayerEl.appendChild(slot);

  const toast = {
    slot,
    card,
    height: card.offsetHeight,  // 固定宽度下高度稳定；只在这里读一次布局，之后位移计算全用缓存
    dwellTimer: 0,
    animTimer: 0,
    remainMs: PARAMS.dwellMs,
    stamp: 0,
    closing: false,
  };
  toasts.push(toast);

  /* 新条就位：同步写入堆叠位移（新插入元素的首帧样式不触发过渡，不会闪跳） */
  layoutToasts();
  /* 动效层滑入：translateX + fade（250ms；上方 offsetHeight 读取已强制布局，初态先生效） */
  card.classList.add('is-in', 'is-anim');
  clearTimeout(toast.animTimer);
  toast.animTimer = setTimeout(() => card.classList.remove('is-anim'), jsDur(PARAMS.toastInMs) + 80);

  armDwell(toast);  // 驻留计时（armDwell 内部会先清旧句柄）

  closeBtn.addEventListener('click', () => closeToast(toast));
  card.addEventListener('pointerenter', () => pauseDwell(toast));  // SPEC §1.4：hover 暂停驻留
  card.addEventListener('pointerleave', () => resumeDwell(toast));
}

/** 堆叠布局：先算后写（读缓存高度，一次批量写 transform，读写分离不抖布局） */
function layoutToasts() {
  let offsetY = 0;
  const moves = [];
  for (const t of toasts) {
    if (t.closing) continue;  // 正在滑出的不占位：下方通知即刻腾位上移（transform 过渡并行于滑出）
    moves.push([t, offsetY]);
    offsetY += t.height + PARAMS.stackGapPx;
  }
  for (const [t, y] of moves) t.slot.style.transform = 'translateY(' + y + 'px)';
}

/** 启动/重启驻留计时：每次都先清旧句柄（内存泄漏防线） */
function armDwell(t) {
  clearTimeout(t.dwellTimer);
  t.stamp = performance.now();
  t.dwellTimer = setTimeout(() => closeToast(t), t.remainMs);
}

function pauseDwell(t) {
  if (t.closing) return;
  clearTimeout(t.dwellTimer);
  t.remainMs = Math.max(0, t.remainMs - (performance.now() - t.stamp));
}

function resumeDwell(t) {
  if (t.closing) return;
  if (t.remainMs <= 0) {
    closeToast(t);
    return;
  }
  armDwell(t);
}

/** 关闭一条通知：清计时器 → 动效层滑出 → 立即腾位 → 到点移除节点 */
function closeToast(t) {
  if (t.closing) return;
  t.closing = true;
  clearTimeout(t.dwellTimer);  // 关闭即清理驻留计时器
  clearTimeout(t.animTimer);
  // 焦点归还：正在持有焦点的通知（如聚焦在关闭按钮）先把焦点交还主按钮
  if (t.card.contains(document.activeElement) && notifyBtnEl) {
    notifyBtnEl.focus({ preventScroll: true });
  }
  t.card.classList.remove('is-in');  // 动效层退场：translateX 回去 + fade（200ms ease-in）
  t.card.classList.add('is-anim');
  layoutToasts();                    // 立即腾位：下方通知 transform 过渡上移，与滑出并行
  clearTimeout(t.animTimer);
  t.animTimer = setTimeout(() => {
    t.slot.remove();
    const index = toasts.indexOf(t);
    if (index >= 0) toasts.splice(index, 1);
  }, jsDur(PARAMS.toastOutMs) + 80);
}

/** pagehide 兜底：清空全部通知计时器并移除节点 */
function disposeAllToasts() {
  for (const t of toasts) {
    clearTimeout(t.dwellTimer);
    clearTimeout(t.animTimer);
    t.slot.remove();
  }
  toasts.length = 0;
}

/* ==========================================================================
 * 页面装配
 * ========================================================================== */
function init() {
  applyParamsToCssVars();

  /* —— 弹层注册 —— */
  const popFile = new Popover($('#popFile'));
  const popHelp = new Popover($('#popHelp'));
  const popCtx = new Popover($('#popContext'));
  const popovers = [popFile, popHelp, popCtx];

  const bindDropdownTrigger = (btn, pop) => {
    btn.addEventListener('click', () => (pop.isOpen() ? pop.close() : pop.openFor(btn)));
  };
  bindDropdownTrigger($('#menuFileBtn'), popFile);
  bindDropdownTrigger($('#menuHelpBtn'), popHelp);

  /* —— 右键上下文菜单：桌面区域拦截默认菜单，弹到指针位置 —— */
  $('#desktop').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    popCtx.openAt(e.clientX, e.clientY);
  });

  /* —— 菜单项动作 → 状态行反馈（演示用） —— */
  const statusLine = $('#statusLine');
  for (const pop of popovers) {
    pop.card.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      statusLine.textContent = '最近动作：「' + item.dataset.action + '」（演示）';
      pop.close();
    });
  }

  /* —— 全局关闭：Esc / 点击外部（捕获）/ 视口变化后位置失效 —— */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    popovers.forEach((pop) => pop.close());
  });
  document.addEventListener('pointerdown', (e) => {
    for (const pop of popovers) {
      if (!pop.isOpen()) continue;
      const onTrigger = pop.trigger && (pop.trigger === e.target || pop.trigger.contains(e.target));
      if (!onTrigger && !pop.root.contains(e.target)) pop.close();
    }
  }, true);
  window.addEventListener('resize', () => popovers.forEach((pop) => pop.close()));

  /* —— 通知 —— */
  toastLayerEl = $('#toastLayer');
  notifyBtnEl = $('#notifyBtn');
  notifyBtnEl.addEventListener('click', () => showToast());

  const burstTimers = new Set();
  $('#burstBtn').addEventListener('click', () => {
    for (let i = 0; i < PARAMS.burstCount; i += 1) {
      const id = setTimeout(() => {
        burstTimers.delete(id);
        showToast();
      }, i * PARAMS.burstGapMs);
      burstTimers.add(id);
    }
  });

  /* —— 深浅主题一键切换（给 html 挂 ml-dark，令牌语义整体翻转） —— */
  const themeBtn = $('#themeBtn');
  themeBtn.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('ml-dark');
    themeBtn.textContent = dark ? '浅色模式' : '深色模式';
    themeBtn.setAttribute('aria-pressed', String(dark));
  });

  /* —— 卸载兜底：清空所有计时器 —— */
  window.addEventListener('pagehide', () => {
    popovers.forEach((pop) => pop.dispose());
    disposeAllToasts();
    burstTimers.forEach((id) => clearTimeout(id));
  });
}

/* 装配入口：幂等护栏保证 init 只跑一次（真实浏览器与测试环境时序不同均安全） */
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

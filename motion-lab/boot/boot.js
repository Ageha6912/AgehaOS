/*!
 * motion-lab/boot/boot.js — AgehaOS 开机启动动画（框架无关演示模块）
 * --------------------------------------------------------------------------
 * 对标 macOS 开机画面：纯黑启动层 + 品牌 Logo + 细长圆角进度条 + 退场露出登录界面。
 *
 * 【时长豁免说明（SPEC §2「开机动画」行）】开机总时长 PARAMS.BOOT_DURATION_MS
 * （默认 3800ms）与退场 PARAMS.exitDurationMs（默认 400ms，对应令牌
 * --ml-dur-boot）属开机动画唯一豁免档；其余一切过渡严格落在 150~300ms。
 *
 * 【性能铁律（SPEC §3）】全程只写 transform/opacity：进度条用 scaleX（非 width），
 * rAF 每帧至多一次写操作；退场 will-change 仅在动画期间挂载。
 *
 * 【文件名说明】boot.js / boot.css 为任务指定文件名（SPEC §4 默认
 * style.css / script.js，需求优先于规范，特此注明）。
 */
(function () {
  'use strict';

  /* ======================================================================
   * 缓动函数（纯数学，rAF 插值用；不触碰 DOM，便于单测）
   * ==================================================================== */
  const easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  const easeInOutSine = function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; };
  const easeInCubic = function (t) { return t * t * t; };
  const clamp01 = function (t) { return t < 0 ? 0 : t > 1 ? 1 : t; };

  /* ======================================================================
   * Logo 内联 SVG 兜底：所有候选图片都加载失败时使用（零网络依赖）。
   * 造型为 AgehaOS 几何燕尾蝶的极简近似，仅应急占位，正常情况下不会出现。
   * ==================================================================== */
  const FALLBACK_LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="AgehaOS">' +
    '<g fill="#82a3ff">' +
    '<path d="M31 31C22 12 5 9 4 20c-1 10 12 16 27 13z"/>' +
    '<path d="M33 31c9-19 26-22 27-11 1 10-12 16-27 13z"/>' +
    '<path d="M31 34c-8 10-18 24-11 27 6 2 12-10 13-24z"/>' +
    '<path d="M33 34c8 10 18 24 11 27-6 2-12-10-13-24z"/>' +
    '</g>' +
    '<ellipse cx="32" cy="31" rx="2.4" ry="12" fill="#cdd9f6"/>' +
    '</svg>';
  const FALLBACK_LOGO_DATA_URI = 'data:image/svg+xml;utf8,' + encodeURIComponent(FALLBACK_LOGO_SVG);

  /**
   * 模块动效参数 —— 按性能表现微调时只改这里（全中文注释）。
   * 时长字段与令牌档位对应：BOOT_DURATION_MS / exitDurationMs ↔ 开机豁免档
   * --ml-dur-boot；Logo 淡入 200ms ↔ --ml-dur-base、登录卡就位 250ms ↔
   * --ml-dur-mid（后者在 boot.css 中直接引用令牌，此处仅作文档互指）。
   */
  const PARAMS = {
    // Logo 图片地址（需求 §1 指定的默认值；支持 URL 查询参数 ?logo=<地址> 运行时覆盖）。
    // 注意：该路径自 motion-lab/boot/ 解析为 motion-lab/public/brand/...；
    // 仓库现有文件实际在根目录 public/brand/，故由下方 logoFallbacks 提供真实路径回退。
    logoSrc: '../public/brand/agehaos-logo-v2-full-512.png',

    // Logo 加载失败时的依次回退候选（末项为内联 SVG data URI，双击预览永不破图）。
    logoFallbacks: ['../../public/brand/agehaos-logo-v2-full-512.png', FALLBACK_LOGO_DATA_URI],

    // 开机总时长 ms（需求 §4：默认约 3.8s，允许 3000~5000，越界自动收敛）。
    // 豁免理由：进度推进是「内容本身的进度感」（SPEC §2 开机行），不受 300ms 铁律约束。
    BOOT_DURATION_MS: 3800,

    // 退场（淡出 + 放大）时长 ms；开机豁免档，对应共享令牌 --ml-dur-boot（400ms）。
    exitDurationMs: 400,

    // 退场放大上限（需求 §5：scale 1 → 1.05，macOS 开机同款轻微放大）。
    maxScale: 1.05,

    // 登录卡露出起始缩放（0.985 → 1；CSS 侧 250ms --ml-ease-spring，铁律内）。
    revealScaleFrom: 0.985,

    // Logo 显示宽度 px。
    logoSizePx: 96,

    // 进度条宽度 px。
    barWidthPx: 240,

    // 进度条高度 px（需求 §2：约 4px 细长圆角条）。
    barHeightPx: 4,

    // Logo 与进度条的垂直间距 px。
    logoBarGapPx: 44,

    // 分段变速节奏（需求 §3：快-慢-冲刺，禁止匀速线性）。
    // share：该段占总时长的时间占比（合计必须为 1）；to：该段结束时的进度（%）；
    // ease：段内缓动函数；note：这段节奏模拟的真实加载阶段。
    segments: [
      { to: 36, share: 0.16, ease: easeOutCubic, note: '快：固件自检一把推上' },
      { to: 62, share: 0.36, ease: easeInOutSine, note: '慢：内核与驱动加载，缓慢爬坡' },
      { to: 80, share: 0.26, ease: easeInOutSine, note: '慢：服务逐个就位，接近停滞的平台期' },
      { to: 100, share: 0.22, ease: easeInCubic, note: '冲刺：收尾加速冲线' },
    ],

    // prefers-reduced-motion 检测结果（SPEC §5：运行时由 matchMedia 覆写，不许手填）。
    reducedMotion: false,
  };

  /* ======================================================================
   * 联调/测试钩子：在加载本脚本之前设置 window.AgehaBootConfig 可覆写关键参数
   * （宿主真实接入时可用于对齐自身启动节奏；单测用它把总时长收敛到下限 3000ms）。
   * ==================================================================== */
  const OVERRIDES = (typeof window !== 'undefined' && window.AgehaBootConfig) || {};
  function applyOverride(value, fallback, min, max) {
    const n = Number(value);
    if (value === undefined || value === null || !Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  PARAMS.BOOT_DURATION_MS = applyOverride(OVERRIDES.BOOT_DURATION_MS, PARAMS.BOOT_DURATION_MS, 3000, 5000);
  PARAMS.exitDurationMs = applyOverride(OVERRIDES.exitDurationMs, PARAMS.exitDurationMs, 150, 5000);

  /**
   * 分段变速曲线：时间占比 t∈[0,1] → 进度 p∈[0,1]。
   * 逐段按各自缓动函数插值，全程严格单调不减——任何一点都不做匀速线性。
   */
  function bootCurve(t) {
    const segs = PARAMS.segments;
    let acc = 0;
    let from = 0;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (t <= acc + seg.share || i === segs.length - 1) {
        const local = clamp01((t - acc) / seg.share);
        return (from + (seg.to - from) * seg.ease(local)) / 100;
      }
      acc += seg.share;
      from = seg.to;
    }
    return 1;
  }

  /* 非浏览器环境（如纯 Node 侧单测）：只保留纯逻辑，不触碰 DOM。 */
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { PARAMS, bootCurve, clamp01 };
    }
    return;
  }

  /* ======================================================================
   * DOM 装配
   * ==================================================================== */
  const bootRoot = document.getElementById('bootScreen'); // 启动层根元素（data-boot 测试钩子挂这里）
  const logoImg = document.getElementById('bootLogo');
  const barEl = document.getElementById('bootBar');
  const fillEl = document.getElementById('bootFill');
  const stageEl = document.getElementById('loginStage'); // 下层登录舞台
  const replayBtn = document.getElementById('replayBtn'); // 演示辅助：重播按钮

  // 结构缺失时直接放弃（模块自带 index.html 保证结构存在，此处仅为防御）
  if (!bootRoot || !fillEl) return;

  // prefers-reduced-motion：JS 侧检测（SPEC §5；jsdom 等环境可能没有 matchMedia，做防御）
  const REDUCED =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  PARAMS.reducedMotion = REDUCED;

  // PARAMS → CSS 变量：尺寸/幅度/时长的唯一来源在 PARAMS，CSS 只消费（单一事实源）
  const pageStyle = document.documentElement.style;
  pageStyle.setProperty('--boot-logo-size', PARAMS.logoSizePx + 'px');
  pageStyle.setProperty('--boot-bar-width', PARAMS.barWidthPx + 'px');
  pageStyle.setProperty('--boot-bar-height', PARAMS.barHeightPx + 'px');
  pageStyle.setProperty('--boot-logo-bar-gap', PARAMS.logoBarGapPx + 'px');
  pageStyle.setProperty('--boot-max-scale', String(PARAMS.maxScale));
  pageStyle.setProperty('--boot-reveal-scale', String(PARAMS.revealScaleFrom));
  // reduced 下不注入退场时长：CSS 回落到 --ml-dur-boot（令牌层已塌缩成 0.01ms → 直接切换）
  if (!REDUCED) pageStyle.setProperty('--boot-exit-duration', PARAMS.exitDurationMs + 'ms');

  /* ======================================================================
   * 进度引擎（rAF 驱动）
   * ==================================================================== */
  const progressCbs = []; // 需求 §6：onBootProgress 订阅者
  const completeCbs = []; // 需求 §6：onBootComplete 订阅者
  let started = false;
  let done = false; // 完成守卫：complete 逻辑（含回调）只走一次
  let rafId = 0;
  let lastTs = null;
  let elapsed = 0;
  let lastPercent = -1;

  // 用户回调兜底：单个回调抛错不允许打断启动流程
  function safeCall(cb, value) {
    try {
      cb(value);
    } catch (err) {
      console.error('[AgehaBoot] 回调执行出错：', err);
    }
  }

  /**
   * 写入进度：transform 之外的 DOM 写仅发生在整数百分比变化时（aria 同步）。
   * @param {number} p01 进度 0~1
   * @returns {number} 0~100 整数
   */
  function setProgress(p01) {
    const clamped = clamp01(p01);
    // 每帧唯一一次样式写操作：进度条 scaleX（合成层），禁用 width（布局属性）
    fillEl.style.transform = 'scaleX(' + clamped.toFixed(4) + ')';
    const pct = Math.round(clamped * 100);
    if (pct !== lastPercent) {
      lastPercent = pct;
      if (barEl) barEl.setAttribute('aria-valuenow', String(pct));
      for (let i = 0; i < progressCbs.length; i++) safeCall(progressCbs[i], pct);
    }
    return pct;
  }

  function tick(now) {
    if (done) return; // 被 skip() 抢先后到达的旧帧直接丢弃
    // 后台标签页的 rAF 会暂停，这里只累计可见帧间隔（单帧封顶 100ms），回前台不跳变
    if (lastTs !== null) elapsed += Math.min(now - lastTs, 100);
    lastTs = now;
    const t = Math.min(elapsed / PARAMS.BOOT_DURATION_MS, 1);
    setProgress(bootCurve(t));
    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      finish();
    }
  }

  function start() {
    if (started || done) return;
    started = true;
    lastTs = null;
    elapsed = 0;
    rafId = requestAnimationFrame(tick);
  }

  /** 进度到 100：置测试钩子 → 触发完成回调（恰一次）→ 启动退场露出登录界面 */
  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(rafId);
    setProgress(1); // 确保进度精确到 100（会触发最后一次进度回调）
    // 需求 §7 测试钩子：进度到 100 时给启动层根元素打标记
    bootRoot.setAttribute('data-boot', 'complete');
    for (let i = 0; i < completeCbs.length; i++) safeCall(completeCbs[i]);
    startExit();
  }

  /** 退场：登录卡 0.985→1 就位（250ms）；启动层 opacity→0 + scale→1.05（400ms 豁免档） */
  function startExit() {
    if (stageEl) stageEl.classList.add('is-revealed');
    if (REDUCED) {
      // 需求 §8：reduced 下无缩放淡出动画，直接切换（进度条推进不受影响）
      bootRoot.hidden = true;
      return;
    }
    bootRoot.classList.add('is-exiting');
    const hide = function () {
      bootRoot.hidden = true;
    };
    // transitionend 为主、setTimeout 兜底（如退场中标签页失焦导致事件丢失）
    bootRoot.addEventListener('transitionend', hide, { once: true });
    window.setTimeout(hide, PARAMS.exitDurationMs + 150);
  }

  /* ======================================================================
   * Logo 解析（需求 §1：路径可配置 + ?logo= 覆盖 + 依次回退）
   * ==================================================================== */
  function applyLogo() {
    if (!logoImg) return;
    let queryLogo = null;
    try {
      queryLogo = new URL(window.location.href).searchParams.get('logo');
    } catch (err) {
      queryLogo = null; // location 异常时退回默认链
    }
    // 候选链（去重、跳过空值）：?logo= 自定义 → 系统默认 Logo → 逐级回退。
    // 注意系统默认 PARAMS.logoSrc 恒在链中：自定义 Logo 加载失败时回落到品牌默认，
    // 而不是直接跳到兜底候选。
    const candidates = [];
    function pushCandidate(src) {
      if (typeof src !== 'string' || src.length === 0 || candidates.indexOf(src) !== -1) return;
      candidates.push(src);
    }
    pushCandidate(queryLogo);
    pushCandidate(PARAMS.logoSrc);
    for (let i = 0; i < PARAMS.logoFallbacks.length; i++) pushCandidate(PARAMS.logoFallbacks[i]);
    let idx = 0;
    // 一次性淡入（200ms --ml-dur-base，非循环）；reduced 下由 CSS 令牌塌缩为直接呈现
    logoImg.onload = function () {
      logoImg.classList.add('is-loaded');
    };
    logoImg.onerror = function () {
      idx += 1;
      if (idx < candidates.length) {
        logoImg.src = candidates[idx];
      } else {
        logoImg.classList.add('is-missing'); // 全部失败：隐藏破图占位
      }
    };
    logoImg.src = candidates[0];
  }

  /* ======================================================================
   * 对外 API（需求 §6）+ 演示辅助 + 启动
   * ==================================================================== */
  window.AgehaBoot = {
    /** 订阅进度：每次推进以 0~100 整数回调（订阅瞬间不补发，只在推进时触发） */
    onBootProgress: function (cb) {
      if (typeof cb === 'function') progressCbs.push(cb);
    },
    /** 订阅完成：进度到 100 时触发一次；完成之后再订阅会立即补发一次 */
    onBootComplete: function (cb) {
      if (typeof cb !== 'function') return;
      if (done) safeCall(cb);
      else completeCbs.push(cb);
    },
    /** 立即跳到完成：进度置 100、触发完成回调并播退场（reduced 下直接切换）；幂等 */
    skip: function () {
      finish();
    },
    /** 只读参考：本模块全部可调参数（联调/测试用；勿在运行期改写 segments.ease） */
    PARAMS: PARAMS,
    /** 只读参考：分段变速曲线（t∈[0,1] → 进度 0~1），供联调与测试断言 */
    progressAt: bootCurve,
  };

  // 演示辅助：重播按钮 = 整页重载（production 接入时不携带此 DOM 即自动跳过）
  if (replayBtn) {
    replayBtn.addEventListener('click', function () {
      window.location.reload();
    });
  }

  applyLogo();
  start();
})();

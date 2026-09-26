/**
 * ============================================================================
 * AgehaOS 动效实验室 · 进阶炫技档
 * 效果 1/5 —— 壁纸视差景深（parallax.js）
 * ----------------------------------------------------------------------------
 * 设计动机：让壁纸成为「有纵深的空间」——指针移动时远山几乎不动、中景轻移、
 *   前景明显跟随，用三层位移差讲出空间层次（Big Sur 式景深）。
 * 实现三档差异：
 *   纯 CSS——只能靠 hover/scroll 等离散状态位移，无法 1:1 跟随自由指针，
 *     还原度最低（合成层性能最好但做不出本效果）；
 *   JS rAF + translate3d（本文件）——每帧最多 3 次合成层写操作，插值续动、
 *     可中断、收敛即停帧，性能与还原度平衡最佳，★推荐默认档；
 *   WebGL——需把三层烘焙成纹理并着色器偏移 UV，还原度相同，但初始化/
 *     内存/复杂度全面更高，对位图视差纯属浪费。
 * 推荐默认档：JS rAF（本文件实现）。
 * 性能说明：事件回调只记数据不写 DOM（SPEC §3.3 rAF 纪律）；每帧最多 3 次
 *   transform 写入；收敛后自动停帧；will-change 仅在启用期挂载、关闭期摘除；
 *   关闭效果时从当前呈现值缓退归零（drainMs），不产生跳变。
 * ============================================================================
 */
(function () {
  'use strict';

  /** 模块动效参数——按性能表现微调时只改这里（全部中文注释）。 */
  const PARAMS = {
    farPx: 10,            // 远景层最大水平位移 px（远山几乎不动 = 空间最远）
    midPx: 22,            // 中景层最大水平位移 px
    nearPx: 38,           // 前景层最大水平位移 px（近景位移最大 = 离观者最近）
    verticalRatio: 0.55,  // 垂直位移 = 水平位移 × 该系数（纵向弱化更接近镜头平移感）
    dir: -1,              // 视差方向：-1 = 场景朝指针反方向轻移（镜头转向指针）
    lerp: 0.085,          // 每帧向目标插值系数（0~1：越小越「重」越柔，越大越跟手）
    epsilon: 0.0012,      // 收敛阈值：与目标差小于它即停帧省电（归一化坐标）
    drainMs: 220,         // 关闭效果时从当前位移缓退归零的时长 ms（防跳变，非交互过渡）
    reducedMotion: false, // 运行时由 matchMedia 检测覆写（SPEC §4，不许手填）
  };
  PARAMS.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function initParallax(scene) {
    if (!scene) return null;
    const layers = [
      { el: scene.querySelector('.mlp-layer--far'), px: PARAMS.farPx },
      { el: scene.querySelector('.mlp-layer--mid'), px: PARAMS.midPx },
      { el: scene.querySelector('.mlp-layer--near'), px: PARAMS.nearPx },
    ].filter(function (l) { return l.el; });
    if (!layers.length) return null;

    const target = { x: 0, y: 0 }; // 归一化目标（-1~1），指针事件里只更新这里
    const cur = { x: 0, y: 0 };    // 当前呈现值，每帧从此续算（可中断，SPEC §3.6）
    const drainFrom = { x: 0, y: 0 };
    let rafId = 0;
    let enabled = false;
    let draining = false;
    let drainStart = 0;

    /** 把当前插值状态写到三层 transform（唯一写 DOM 的地方，每帧一次）。 */
    function apply() {
      const vx = cur.x * PARAMS.dir;
      const vy = cur.y * PARAMS.dir;
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.el.style.transform =
          'translate3d(' + (vx * l.px).toFixed(2) + 'px,' +
          (vy * l.px * PARAMS.verticalRatio).toFixed(2) + 'px,0)';
      }
    }

    /** will-change 纪律（SPEC §3.5）：仅启用期挂载，关闭后摘除。 */
    function setWillChange(on) {
      for (let i = 0; i < layers.length; i++) {
        layers[i].el.style.willChange = on ? 'transform' : '';
      }
    }

    function clearTransforms() {
      for (let i = 0; i < layers.length; i++) layers[i].el.style.transform = '';
    }

    function tick(now) {
      rafId = 0;
      if (document.hidden) return; // 页面隐藏时 rAF 本就暂停，兜底防多余写入
      if (draining) {
        // 关闭降档：从当前值时间驱动缓退归零（强减速，与 --ml-ease-standard 同族）
        const p = Math.min(1, (now - drainStart) / PARAMS.drainMs);
        const e = 1 - Math.pow(1 - p, 3);
        cur.x = drainFrom.x * (1 - e);
        cur.y = drainFrom.y * (1 - e);
        apply();
        if (p >= 1) {
          draining = false;
          setWillChange(false);
          clearTransforms();
          return;
        }
      } else {
        cur.x += (target.x - cur.x) * PARAMS.lerp;
        cur.y += (target.y - cur.y) * PARAMS.lerp;
        apply();
        if (
          Math.abs(target.x - cur.x) < PARAMS.epsilon &&
          Math.abs(target.y - cur.y) < PARAMS.epsilon
        ) {
          cur.x = target.x;
          cur.y = target.y;
          apply();
          return; // 收敛即停帧省电；指针再动会由事件重新唤醒
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    function ensureRunning() {
      if (!rafId && (enabled || draining)) rafId = requestAnimationFrame(tick);
    }

    function onPointerMove(e) {
      if (!enabled || draining) return;
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
      ensureRunning();
    }

    function onPointerLeave() {
      // 指针离开视口：目标归零，由主循环收敛后自动停帧
      if (!enabled) return;
      target.x = 0;
      target.y = 0;
      ensureRunning();
    }

    function setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (enabled) {
        // 降级选型（SPEC §5 跟随类）：减少动态偏好下整体关闭视差，
        // 保留静态三层构图——背景层不该在降级时仍随指针移动。
        if (PARAMS.reducedMotion) return;
        draining = false;
        setWillChange(true);
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        document.documentElement.addEventListener('pointerleave', onPointerLeave);
      } else {
        window.removeEventListener('pointermove', onPointerMove);
        document.documentElement.removeEventListener('pointerleave', onPointerLeave);
        if (PARAMS.reducedMotion) return;
        target.x = 0;
        target.y = 0;
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        // 缓退归零后再摘 will-change，避免位移瞬间跳变
        draining = true;
        drainStart = performance.now();
        drainFrom.x = cur.x;
        drainFrom.y = cur.y;
        rafId = requestAnimationFrame(tick);
      }
    }

    return { root: scene, setEnabled: setEnabled };
  }

  /* 自动初始化：本页面若存在 [data-ml-parallax] 根元素即接管；
   * data-ml-enabled="false" 表示初始关闭（组合演示页由控制器翻转开关）。 */
  window.MLAdvanced = window.MLAdvanced || {};
  const rootEl = document.querySelector('[data-ml-parallax]');
  const handle = initParallax(rootEl);
  window.MLAdvanced.parallax = handle;
  if (handle && rootEl.getAttribute('data-ml-enabled') !== 'false') {
    handle.setEnabled(true);
  }
})();

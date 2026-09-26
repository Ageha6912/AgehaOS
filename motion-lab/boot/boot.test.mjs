// @vitest-environment node
/**
 * motion-lab/boot/boot.test.mjs — 开机动画模块测试
 * --------------------------------------------------------------------------
 * motion-lab 为框架无关演示模块，产品根配置（vite.config.ts）的 include 只收
 * src/**，本模块刻意不并入主套件；用模块内独立配置运行：
 *   npx vitest run --config motion-lab/boot/vitest.config.mjs
 *
 * 策略：environment=node + 手工创建 JSDOM 实例（runScripts:'outside-only' +
 * pretendToBeVisual 提供 rAF），以经典脚本方式 eval boot.js（与浏览器
 * <script src> 等价），对纯逻辑与真实生命周期分别断言。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, it, expect, afterAll, vi } from 'vitest';

const BOOT_JS = readFileSync(fileURLToPath(new URL('./boot.js', import.meta.url)), 'utf8');
const INDEX_HTML = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8');

/** 已创建的 jsdom 实例，统一在 afterAll 关闭（停掉后台 rAF/定时器） */
const doms = [];

/**
 * 创建一个加载了 boot.js 的 jsdom 实例。
 * @param {object} [opts]
 * @param {string} [opts.url] 页面地址（可带查询参数以测 ?logo= 覆盖）
 * @param {object} [opts.config] window.AgehaBootConfig 联调钩子覆写（须在脚本执行前注入）
 * @param {boolean} [opts.reducedMotion] 在脚本执行前伪装 prefers-reduced-motion: reduce
 */
function bootDom({ url = 'file:///E:/AgehaOS/motion-lab/boot/index.html', config, reducedMotion = false } = {}) {
  const dom = new JSDOM(INDEX_HTML, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  if (reducedMotion) {
    window.matchMedia = (query) => ({
      matches: /prefers-reduced-motion:\s*reduce/.test(String(query)),
      media: String(query),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
  if (config) window.AgehaBootConfig = config;
  window.eval(BOOT_JS);
  doms.push(dom);
  return dom;
}

afterAll(() => {
  for (const dom of doms) dom.window.close();
});

/* ---------------------------------------------------------------------- */
/* PARAMS 默认值与约束                                                      */
/* ---------------------------------------------------------------------- */
describe('PARAMS 默认值与约束', () => {
  const boot = bootDom().window.AgehaBoot;

  it('logoSrc 默认值精确等于需求指定的相对路径（支持 ?logo= 覆盖的基础）', () => {
    expect(boot.PARAMS.logoSrc).toBe('../public/brand/agehaos-logo-256.png');
  });

  it('BOOT_DURATION_MS 默认 3800，并收敛到需求允许的 3000~5000 区间（含非法值防御）', () => {
    expect(boot.PARAMS.BOOT_DURATION_MS).toBe(3800);
    const hi = bootDom({ config: { BOOT_DURATION_MS: 99999 } });
    const lo = bootDom({ config: { BOOT_DURATION_MS: 100 } });
    const bad = bootDom({ config: { BOOT_DURATION_MS: 'abc' } });
    expect(hi.window.AgehaBoot.PARAMS.BOOT_DURATION_MS).toBe(5000);
    expect(lo.window.AgehaBoot.PARAMS.BOOT_DURATION_MS).toBe(3000);
    expect(bad.window.AgehaBoot.PARAMS.BOOT_DURATION_MS).toBe(3800);
  });

  it('退场为 400ms 豁免档（--ml-dur-boot），放大上限 1.05', () => {
    expect(boot.PARAMS.exitDurationMs).toBe(400);
    expect(boot.PARAMS.maxScale).toBe(1.05);
  });

  it('分段节奏：share 合计为 1，to 严格递增且收于 100，ease 均为函数', () => {
    const segs = boot.PARAMS.segments;
    expect(segs.length).toBeGreaterThanOrEqual(3); // 至少「快-慢-冲刺」三段
    const shareSum = segs.reduce((sum, seg) => sum + seg.share, 0);
    expect(Math.abs(shareSum - 1)).toBeLessThan(1e-9);
    for (let i = 0; i < segs.length; i++) {
      expect(typeof segs[i].ease).toBe('function');
      if (i > 0) expect(segs[i].to).toBeGreaterThan(segs[i - 1].to);
    }
    expect(segs[segs.length - 1].to).toBe(100);
  });
});

/* ---------------------------------------------------------------------- */
/* 分段变速曲线（需求 §3：禁止匀速线性）                                     */
/* ---------------------------------------------------------------------- */
describe('分段变速曲线 bootCurve', () => {
  const { progressAt } = bootDom().window.AgehaBoot;

  it('端点：f(0)=0，f(1)=1', () => {
    expect(progressAt(0)).toBe(0);
    expect(progressAt(1)).toBe(1);
  });

  it('全程单调不减，取值始终在 [0,1]', () => {
    let prev = 0;
    for (let i = 0; i <= 1000; i++) {
      const p = progressAt(i / 1000);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
  });

  it('显著偏离匀速线性（最大偏差 > 0.05，匀速则为 0）', () => {
    let maxDeviation = 0;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      maxDeviation = Math.max(maxDeviation, Math.abs(progressAt(t) - t));
    }
    expect(maxDeviation).toBeGreaterThan(0.05);
  });

  it('整数百分比映射单调不减且在 0~100', () => {
    let prev = 0;
    for (let i = 0; i <= 1000; i++) {
      const pct = Math.round(progressAt(i / 1000) * 100);
      expect(pct).toBeGreaterThanOrEqual(prev);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
      prev = pct;
    }
  });
});

/* ---------------------------------------------------------------------- */
/* 对外 API（需求 §6）                                                      */
/* ---------------------------------------------------------------------- */
describe('window.AgehaBoot API 契约', () => {
  it('暴露需求指定的三方法（附 PARAMS/progressAt 联调参考）', () => {
    const api = bootDom().window.AgehaBoot;
    expect(typeof api.onBootProgress).toBe('function');
    expect(typeof api.onBootComplete).toBe('function');
    expect(typeof api.skip).toBe('function');
    expect(api.PARAMS).toBeTypeOf('object');
    expect(typeof api.progressAt).toBe('function');
  });

  it('非函数订阅参数被安全忽略', () => {
    const boot = bootDom().window.AgehaBoot;
    expect(() => boot.onBootProgress(null)).not.toThrow();
    expect(() => boot.onBootComplete(undefined)).not.toThrow();
  });

  it('回调抛错不影响启动流程（safeCall 兜底）', () => {
    const boot = bootDom({ config: { BOOT_DURATION_MS: 3000 } }).window.AgehaBoot;
    const seen = [];
    boot.onBootProgress(() => {
      throw new Error('boom');
    });
    boot.onBootProgress((p) => seen.push(p));
    boot.onBootComplete(() => {
      throw new Error('boom');
    });
    boot.onBootComplete(() => seen.push('done'));
    expect(() => boot.skip()).not.toThrow();
    expect(seen).toContain(100);
    expect(seen).toContain('done');
  });
});

/* ---------------------------------------------------------------------- */
/* 生命周期（真实 rAF；总时长用联调钩子收敛到下限 3000ms）                    */
/* ---------------------------------------------------------------------- */
describe('开机生命周期（真实 rAF）', () => {
  it(
    '进度自然推进到 100：data-boot=complete、完成回调恰一次、进度单调、退场已启动',
    async () => {
      const dom = bootDom({ config: { BOOT_DURATION_MS: 3000 } });
      const { window } = dom;
      const boot = window.AgehaBoot;
      const percents = [];
      let completes = 0;
      boot.onBootProgress((p) => percents.push(p));
      boot.onBootComplete(() => {
        completes += 1;
      });

      const root = window.document.getElementById('bootScreen');
      await vi.waitFor(() => expect(root.getAttribute('data-boot')).toBe('complete'), {
        timeout: 10_000,
        interval: 50,
      });

      expect(completes).toBe(1); // 完成回调恰一次
      expect(percents.length).toBeGreaterThan(20); // 逐帧推进而非一步到位
      expect(percents[0]).toBeLessThanOrEqual(2); // 从 0 附近开始
      expect(percents[percents.length - 1]).toBe(100);
      for (let i = 1; i < percents.length; i++) {
        expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]); // 单调
      }
      for (const p of percents) {
        expect(Number.isInteger(p)).toBe(true); // 0~100 整数
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
      }
      expect(root.classList.contains('is-exiting')).toBe(true); // 退场动画已启动
      expect(window.document.getElementById('bootFill').style.transform).toMatch(/^scaleX\(/); // scaleX 合成层写法

      // 完成后再订阅 onBootComplete：立即补发一次（总次数变为 2，本订阅恰 1）
      let late = 0;
      boot.onBootComplete(() => {
        late += 1;
      });
      expect(late).toBe(1);
    },
    20_000
  );

  it(
    'skip() 立即跳到完成：data-boot=complete 同步生效、重复 skip 幂等、退场后隐藏',
    async () => {
      const dom = bootDom({ config: { BOOT_DURATION_MS: 3000 } });
      const boot = dom.window.AgehaBoot;
      const percents = [];
      let completes = 0;
      boot.onBootProgress((p) => percents.push(p));
      boot.onBootComplete(() => {
        completes += 1;
      });
      const root = dom.window.document.getElementById('bootScreen');

      boot.skip();
      expect(root.getAttribute('data-boot')).toBe('complete'); // 需求 §7 测试钩子
      expect(completes).toBe(1);
      expect(percents).toContain(100); // 进度被直接推到 100
      boot.skip(); // 幂等
      expect(completes).toBe(1);
      expect(root.classList.contains('is-exiting')).toBe(true);
      await vi.waitFor(() => expect(root.hidden).toBe(true), { timeout: 3_000, interval: 50 }); // 400ms 退场后移出
    },
    10_000
  );

  it(
    'prefers-reduced-motion：进度条仍推进到 100，但退场直接切换（无缩放淡出）',
    async () => {
      const dom = bootDom({ config: { BOOT_DURATION_MS: 3000 }, reducedMotion: true });
      const boot = dom.window.AgehaBoot;
      expect(boot.PARAMS.reducedMotion).toBe(true); // JS 侧 matchMedia 检测生效
      const percents = [];
      boot.onBootProgress((p) => percents.push(p));
      const root = dom.window.document.getElementById('bootScreen');

      await vi.waitFor(() => expect(root.getAttribute('data-boot')).toBe('complete'), {
        timeout: 10_000,
        interval: 50,
      });
      expect(percents[percents.length - 1]).toBe(100); // 进度照常推满
      expect(percents.length).toBeGreaterThan(20);
      expect(root.classList.contains('is-exiting')).toBe(false); // 不播淡出+放大
      expect(root.hidden).toBe(true); // 直接切换
    },
    20_000
  );
});

/* ---------------------------------------------------------------------- */
/* Logo 解析与回退链（需求 §1）                                             */
/* ---------------------------------------------------------------------- */
describe('Logo 解析与回退链', () => {
  it('默认加载需求指定路径，失败后依次回退到仓库根 public 与内联 SVG，全部失败不破图', () => {
    const dom = bootDom();
    const img = dom.window.document.getElementById('bootLogo');
    // 需求默认值：../public/brand/... 自 motion-lab/boot/ 解析
    expect(img.src.endsWith('/motion-lab/public/brand/agehaos-logo-256.png')).toBe(true);
    img.dispatchEvent(new dom.window.Event('error'));
    // 回退 1：仓库根 public/brand/（motion-lab/boot/ 出发的真实相对路径）
    expect(img.src).toBe('file:///E:/AgehaOS/public/brand/agehaos-logo-256.png');
    img.dispatchEvent(new dom.window.Event('error'));
    // 回退 2：内联 SVG data URI（零网络依赖）
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    img.dispatchEvent(new dom.window.Event('error'));
    expect(img.classList.contains('is-missing')).toBe(true);
  });

  it('?logo= 查询参数覆盖默认 Logo，覆盖失败后仍走默认回退链', () => {
    const dom = bootDom({
      url: 'file:///E:/AgehaOS/motion-lab/boot/index.html?logo=https%3A%2F%2Fexample.com%2Fcustom.png',
    });
    const img = dom.window.document.getElementById('bootLogo');
    expect(img.src).toBe('https://example.com/custom.png');
    img.dispatchEvent(new dom.window.Event('error'));
    expect(img.src.endsWith('/motion-lab/public/brand/agehaos-logo-256.png')).toBe(true);
  });
});

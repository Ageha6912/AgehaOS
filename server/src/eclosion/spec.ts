/**
 * 羽化 L1 基础软件规格表——服务端副本（AI-GENERATED-APPS-DESIGN §5.2）。
 *
 * 规格（hint、窗口、权限）**只在服务端**：客户端仅传 specId，恶意客户端无法
 * 把生成接口当通用 LLM 代理（ADR 27）。客户端的元数据表在
 * `src/core/eclosion/spec.ts`（appId/权限/窗口与本文一致，不含提示词）；
 * 一致性由 server/test/eclosion.test.ts 的字面量测试钉死（§6.2 做法）。
 *
 * permissions 使用客户端 Manifest 的 MVP 权限名（src/core/permissions），
 * 时钟按 hint 意图取 ['storage']（设计表格写 [] 与 hint 的「经 AgehaOS.storage
 * 记住」矛盾，按 hint 意图裁决，低危且有量化限额）。
 */

export interface EclosionBasicSpec {
  /** 客户端请求携带的短 id（kind=basic 必填）。 */
  specId: string
  /** 注册进 AppRegistry 的羽化应用 id。 */
  appId: string
  /** 规格版本：升级即全局缓存失效（缓存键组成部分）。 */
  specVersion: number
  /** Manifest 权限名（与客户端 builtin-manifests 同源）。 */
  permissions: string[]
  window: { width: number; height: number; resizable: boolean }
  /** 生成提示词分片（§5.2 规格 hint 要点），永不下发客户端。 */
  hint: string
}

export const BASIC_ECLOSION_SPEC_VERSION = 4  // v4：功能完备性契约 + L2/L3 storage 持久化——旧版全局 HTML 缓存整体失效  // v3：taste v5 设计系统（ax-*）+ 动效契约——旧版全局 HTML 缓存整体失效  // v2：视觉与动效契约升级（taste 优化）——旧版全局 HTML 缓存整体失效

export const BASIC_ECLOSION_SPECS: readonly EclosionBasicSpec[] = [
  {
    specId: 'calculator',
    appId: 'com.ageha.eclosion.calculator',
    specVersion: BASIC_ECLOSION_SPEC_VERSION,
    permissions: [],
    window: { width: 300, height: 440, resizable: false },
    hint: [
      '立即执行式四则运算（输入即算，无等号键累积式表达式）。',
      '百分号、正负号；连续按等号重复上一次运算。',
      '完整键盘输入支持（数字、运算符、退格、Esc 清零、Enter=等号）。',
      '除零显示「错误」，再次输入即恢复。',
      '千分位分组显示；结果位数变化时自适应字号。',
    ].join('\n'),
  },
  {
    specId: 'notes',
    appId: 'com.ageha.eclosion.notes',
    specVersion: BASIC_ECLOSION_SPEC_VERSION,
    permissions: ['filesystem.read', 'filesystem.write'],
    window: { width: 720, height: 480, resizable: true },
    hint: [
      '左侧笔记列表 + 右侧编辑区；新建时自动防重名（追加序号）。',
      '持久化只能用注入的 AgehaOS.files（宿主已把路径钳制在本应用目录 /Apps/com.ageha.eclosion.notes/）：',
      '列目录用 AgehaOS.files.list(\'\')（返回 [{name,type}]，type 为 \'file\'|\'directory\'），',
      '读 AgehaOS.files.read(<name>)、写 AgehaOS.files.write(<name>, <content>)，均返回 Promise。',
      '每篇笔记一个文件，文件名即标题。',
      '编辑防抖 800ms 自动保存；保存状态在界面可见。',
      '删除笔记需页内两步确认（先点删除变确认态，再点确认才执行 AgehaOS.files.remove）。',
    ].join('\n'),
  },
  {
    specId: 'clock',
    appId: 'com.ageha.eclosion.clock',
    specVersion: BASIC_ECLOSION_SPEC_VERSION,
    permissions: ['storage'],
    window: { width: 420, height: 560, resizable: true },
    hint: [
      '三个 tab：世界时钟 / 秒表 / 计时器。',
      '世界时钟：Intl.DateTimeFormat 按时区渲染，可增删城市，选择经 AgehaOS.storage.set(\'clocks\', <数组>) 记忆、AgehaOS.storage.get(\'clocks\') 恢复（Promise）。',
      '秒表：performance.now() 计时，支持计次（显示每次分段时间）。',
      '计时器：SVG 圆环倒计时 + WebAudio 合成提示音（结束时刻 autorun 前需用户先交互过页面即可），到点闪烁提示。',
    ].join('\n'),
  },
]

export function findBasicSpec(specId: string): EclosionBasicSpec | null {
  return BASIC_ECLOSION_SPECS.find((spec) => spec.specId === specId) ?? null
}

/** L1 全局缓存键（§9.2：(specId, specVersion, model)）——个人重新羽化不进全局缓存。 */
export function basicCacheKey(spec: EclosionBasicSpec, model: string): string {
  return `basic:${spec.specId}:v${spec.specVersion}:${model}`
}

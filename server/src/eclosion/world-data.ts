/**
 * 今日世界共享数据（AI-GENERATED-APPS-DESIGN §6.2）：校验白名单的单一来源，
 * world.ts（校验）与 prompts.ts（生成契约）共用；与客户端
 * src/core/eclosion/world.ts 的副本一致性由 server/test/eclosion-world.test.ts
 * 动态引入客户端模块比对钉死（照 spec 表读文件先例）。
 */

export const WORLD_CATEGORIES = ['games', 'tools', 'social', 'creative', 'news', 'life'] as const
export type WorldCategory = (typeof WORLD_CATEGORIES)[number]

/** 抽象调色板 id → 默认 accent（§6.2 accentHue 回落源；静态副本，测试钉与 PALETTES 一致）。 */
export const WORLD_PALETTES: Readonly<Record<string, string>> = {
  'midnight-ink': '#3f4a6b',
  'deep-ocean': '#41607a',
  'charcoal-mist': '#5a5e6b',
  'dusk-forest': '#47604f',
  'slate-night': '#4d5871',
  obsidian: '#444452',
  'aurora-borealis': '#2dd4a7',
  'nebula-violet': '#8b7cf0',
  'ember-sunset': '#f2657a',
  'tropical-night': '#22d3ee',
  'neon-tide': '#c084fc',
  'cosmos-burst': '#a78bfa',
  'morning-mist': '#8b93ad',
  'linen-sky': '#93a3bd',
  'pale-sand': '#a89a7c',
  'cloud-dawn': '#a294b8',
  seaglass: '#7fa89e',
  porcelain: '#98a0b3',
  'citrus-dawn': '#f59e0b',
  'coral-reef': '#f43f5e',
  'meadow-bloom': '#22c55e',
  'sunset-pop': '#fb7185',
  'lagoon-vivid': '#06b6d4',
  'blossom-festival': '#d946ef',
}

export function isWorldPaletteId(paletteId: string): boolean {
  return Object.prototype.hasOwnProperty.call(WORLD_PALETTES, paletteId)
}

/**
 * Phosphor 图标白名单（§6.2：沿用现有徽章体系、不做 AI 生图；2026-10-02
 * 裁决：icon 只做服务端数据卫生，客户端渲染走 AppIcon 确定性徽章）。
 */
export const WORLD_ICON_WHITELIST: readonly string[] = [
  'Airplane', 'Anchor', 'Atom', 'Barcode', 'Basketball', 'Bell', 'Bird', 'Book', 'BookOpen',
  'Brain', 'Briefcase', 'Calculator', 'Calendar', 'CalendarCheck', 'Camera', 'Cat', 'Chats',
  'ChatCircleText', 'ChefHat', 'Clock', 'Cloud', 'CloudLightning', 'CloudSun', 'Code',
  'Compass', 'Cpu', 'Crown', 'Cube', 'Database', 'Diamond', 'Dog', 'Drop', 'Egg', 'Eye',
  'Feather', 'FileText', 'FilmStrip', 'Fingerprint', 'Fire', 'Fish', 'Flag', 'Flashlight',
  'Flower', 'FlowerLotus', 'FlyingSaucer', 'Football', 'Funnel', 'GameController', 'Gauge',
  'Gavel', 'GearSix', 'Ghost', 'Gift', 'GlobeHemisphereWest', 'GraduationCap', 'GridFour',
  'Guitar', 'Hammer', 'Headphones', 'Heart', 'HighHeel', 'IceCream', 'Joystick', 'Key',
  'Lightbulb', 'Lightning', 'MagicWand', 'Magnet', 'Megaphone', 'Microphone', 'Moon',
  'Mountains', 'MusicNote', 'Newspaper', 'NotePencil', 'NuclearPlant', 'Package', 'PaintBrush',
  'Palette', 'PaperPlane', 'Parachute', 'PawPrint', 'PenNib', 'PianoKeys', 'Pill', 'Planet',
  'Plant', 'PokerChip', 'Presentation', 'PuzzlePiece', 'QrCode', 'Rabbit', 'Rainbow',
  'Rocket', 'Robot', 'SealCheck', 'ShieldCheck', 'ShoppingCart', 'Signpost', 'Skull',
  'Sparkle', 'Speedometer', 'Star', 'StarFour', 'Sun', 'Sunglasses', 'Sword', 'Telescope',
  'Tent', 'TestTube', 'Timer', 'Trophy', 'Truck', 'Umbrella', 'VideoCamera', 'Wallet',
  'Waves', 'Wrench', 'YinYang',
]

/** L0/L1 撞名防线（§6.2：name 不得与 L0/L1 应用重名；比较大小写不敏感）。 */
export const WORLD_NAME_BLOCKLIST: readonly string[] = [
  '计算器',
  '记事本',
  '时钟',
  '文件',
  '设置',
  '商店',
  '应用商店',
  '终端',
  '动态面板',
  '内容面板',
  '搜索',
  '通知中心',
  '贪吃蛇',
  '记忆',
  '扫雷',
  'calculator',
  'notes',
  'clock',
  'files',
  'settings',
  'store',
  'terminal',
  'search',
  'snake',
  'memory',
  'mines',
  '2048',
  'agehaos',
]

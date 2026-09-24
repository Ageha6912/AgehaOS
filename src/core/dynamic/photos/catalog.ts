import type { MessageKey } from '../../i18n'

/**
 * 照片壁纸目录（Phase A.6，用户裁决：「程序山水太同质，要真实风景照片」）。
 *
 * 图片经人工筛选后打包在 `public/wallpapers/landscapes/`（同源加载，零运行时网络请求），
 * 全部来自 Wikimedia Commons 的自由许可（CC0 / CC BY / CC BY-SA），署名信息随目录携带，
 * 汇总见 `public/wallpapers/landscapes/CREDITS.md`。
 *
 * mood = 主题适配（对应决策引擎 §2.1 主题过滤）：亮调照片配浅色主题，暗调配深色主题。
 * 照片计划不进程序化生成器（shapes 为空），渲染层直接以 <img> cover 呈现。
 */

export type PhotoMood = 'light' | 'dark'

export interface PhotoEntry {
  /** 计划寻址 id（WallpaperPlan.photoId）。 */
  id: string
  /** 同源 URL（public/ 下路径）。 */
  src: string
  /** 展示名 i18n 键（词典 wallpaper.photo.*）。 */
  nameKey: MessageKey
  /** 主题适配分组。 */
  mood: PhotoMood
  /** 许可署名（CC BY / CC BY-SA 为强制性署名条款）。 */
  credit: { author: string; license: string; sourceUrl: string }
}

/** 照片目录版本：目录内容变更时递增（写入 photo 计划的 generatorVersion）。 */
export const PHOTO_CATALOG_VERSION = 1

export const PHOTO_CATALOG: readonly PhotoEntry[] = [
  {
    id: 'yamzho-yumco',
    src: '/wallpapers/landscapes/yamzho-yumco.jpg',
    nameKey: 'wallpaper.photo.yamzhoYumco',
    mood: 'light',
    credit: {
      author: 'Haogang0325',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Yamzho_Yumco_-_Lake_of_Tibet.jpg',
    },
  },
  {
    id: 'yamdrok-winter',
    src: '/wallpapers/landscapes/yamdrok-winter.jpg',
    nameKey: 'wallpaper.photo.yamdrokWinter',
    mood: 'light',
    credit: {
      author: '陈博洋',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Yamdrok_Lake_in_February_2019.jpg',
    },
  },
  {
    id: 'namtso-bay',
    src: '/wallpapers/landscapes/namtso-bay.jpg',
    nameKey: 'wallpaper.photo.namtsoBay',
    mood: 'dark',
    credit: {
      author: 'yuen yan',
      license: 'CC BY-SA 2.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Namtso_Lake_P8058556.jpg',
    },
  },
  {
    id: 'morskie-oko-morning',
    src: '/wallpapers/landscapes/morskie-oko-morning.jpg',
    nameKey: 'wallpaper.photo.morskieOkoMorning',
    mood: 'light',
    credit: {
      author: 'Aneta Pawska',
      license: 'CC BY 3.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Morskie_Oko_o_poranku.jpg',
    },
  },
  {
    id: 'braies-dock',
    src: '/wallpapers/landscapes/braies-dock.jpg',
    nameKey: 'wallpaper.photo.braiesDock',
    mood: 'light',
    credit: {
      author: 'kallerna',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lago_di_Braies_South_Tyrol_7.jpg',
    },
  },
  {
    id: 'braies-peaks',
    src: '/wallpapers/landscapes/braies-peaks.jpg',
    nameKey: 'wallpaper.photo.braiesPeaks',
    mood: 'light',
    credit: {
      author: 'kallerna',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lago_di_Braies_South_Tyrol_3.jpg',
    },
  },
  {
    id: 'jiuzhaigou-long',
    src: '/wallpapers/landscapes/jiuzhaigou-long.jpg',
    nameKey: 'wallpaper.photo.jiuzhaigouLong',
    mood: 'light',
    credit: {
      author: 'Suicasmo',
      license: 'CC0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Long_Lake_(Jiuzhaigou)_20260511-1.jpg',
    },
  },
  {
    id: 'huangshan-cloudsea',
    src: '/wallpapers/landscapes/huangshan-cloudsea.jpg',
    nameKey: 'wallpaper.photo.huangshanCloudsea',
    mood: 'light',
    credit: {
      author: 'The Pocket',
      license: 'CC BY 2.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cloud_sea_-_huangshan.jpg',
    },
  },
  {
    id: 'huangshan-yunhai',
    src: '/wallpapers/landscapes/huangshan-yunhai.jpg',
    nameKey: 'wallpaper.photo.huangshanYunhai',
    mood: 'dark',
    credit: {
      author: '颐园新居',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Huangshan-%E4%BA%91%E6%B5%B7_20141109.JPG',
    },
  },
  {
    id: 'hallstatt-summer',
    src: '/wallpapers/landscapes/hallstatt-summer.jpg',
    nameKey: 'wallpaper.photo.hallstattSummer',
    mood: 'light',
    credit: {
      author: 'Julius_Silver',
      license: 'CC0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hallstatt_Austria_Bergsee_Lake_Alpine_Summer.jpg',
    },
  },
  {
    id: 'alpine-reflection',
    src: '/wallpapers/landscapes/alpine-reflection.jpg',
    nameKey: 'wallpaper.photo.alpineReflection',
    mood: 'light',
    credit: {
      author: 'Sabrina Schreiber',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Mountain_Reflection_on_Alpine_Lake.jpg',
    },
  },
  {
    id: 'tibet-grassland',
    src: '/wallpapers/landscapes/tibet-grassland.jpg',
    nameKey: 'wallpaper.photo.tibetGrassland',
    mood: 'light',
    credit: {
      author: 'Dan',
      license: 'CC BY 3.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:%E6%8B%B7%E8%B4%9D_(70097727).jpeg',
    },
  },
  {
    id: 'matterhorn-dawn',
    src: '/wallpapers/landscapes/matterhorn-dawn.jpg',
    nameKey: 'wallpaper.photo.matterhornDawn',
    mood: 'dark',
    credit: {
      author: 'Maksym Karmazin',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Matterhorn_by_the_dawn_of_the_night.jpg',
    },
  },
  {
    id: 'matterhorn-stars',
    src: '/wallpapers/landscapes/matterhorn-stars.jpg',
    nameKey: 'wallpaper.photo.matterhornStars',
    mood: 'dark',
    credit: {
      author: 'Giles Laurent',
      license: 'CC BY-SA 4.0',
      sourceUrl:
        'https://commons.wikimedia.org/wiki/File:050_Matterhorn_with_plane_flying_night_sky_Photo_by_Giles_Laurent.jpg',
    },
  },
  {
    id: 'brenta-dusk',
    src: '/wallpapers/landscapes/brenta-dusk.jpg',
    nameKey: 'wallpaper.photo.brentaDusk',
    mood: 'dark',
    credit: {
      author: 'Giulio.diener',
      license: 'CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tramonto_sul_Gruppo_di_Brenta.jpg',
    },
  },
  {
    id: 'san-cassiano-dusk',
    src: '/wallpapers/landscapes/san-cassiano-dusk.jpg',
    nameKey: 'wallpaper.photo.sanCassianoDusk',
    mood: 'dark',
    credit: {
      author: 'Adam Singer',
      license: 'CC BY 2.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Dusk_San_Cassiano_-_Flickr_-_adamnsinger.jpg',
    },
  },
]

export function photoById(id: string): PhotoEntry | undefined {
  return PHOTO_CATALOG.find((photo) => photo.id === id)
}

/** 主题适配池（§2.1 主题过滤的照片版）：亮调配浅色主题、暗调配深色主题。 */
export function photosForTheme(theme: 'light' | 'dark'): PhotoEntry[] {
  return PHOTO_CATALOG.filter((photo) => photo.mood === theme)
}

export const dictionaries = {
  'zh-CN': {
    'boot.booting': '正在启动 AgehaOS…',
    'boot.loading': '正在加载系统资源…',
    'boot.ready': '启动完成',

    'taskbar.start': '开始',

    'window.close': '关闭窗口',
    'window.minimize': '最小化窗口',
    'window.maximize': '最大化窗口',
    'window.restore': '还原窗口',

    'app.notes.title': '记事',
    'app.files.title': '文件',
    'app.settings.title': '设置',
    'app.placeholder.body': '该应用正在开发中，将在后续版本提供。',
    'app.missing.body': '未找到该应用，窗口即将关闭。',
  },
  en: {
    'boot.booting': 'Starting AgehaOS…',
    'boot.loading': 'Loading system resources…',
    'boot.ready': 'Ready',

    'taskbar.start': 'Start',

    'window.close': 'Close window',
    'window.minimize': 'Minimize window',
    'window.maximize': 'Maximize window',
    'window.restore': 'Restore window',

    'app.notes.title': 'Notes',
    'app.files.title': 'Files',
    'app.settings.title': 'Settings',
    'app.placeholder.body': 'This app is under construction and coming in a later release.',
    'app.missing.body': 'Application not found. This window will close.',
  },
} as const

export type Locale = keyof typeof dictionaries

export type MessageKey = keyof (typeof dictionaries)['zh-CN']

export type Dictionary = Record<MessageKey, string>

export const DEFAULT_LOCALE: Locale = 'zh-CN'

export function translate(locale: Locale, key: MessageKey): string {
  return dictionaries[locale][key]
}

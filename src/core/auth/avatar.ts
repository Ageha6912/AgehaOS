/**
 * 头像处理（PRD §12.1 修改头像，本地缩放切片）。
 *
 * 客户端用 canvas 把任意图片 cover-crop 成 128×128 JPEG data URL——体积上限
 * 因此与原图无关；存储走用户记录本身（localStorage / 后端 JSON / Postgres
 * TEXT），S3 对象存储留给云阶段。格式白名单与后端 PATCH 校验一致（§8.4：
 * svg 之类可携带脚本的格式绝不入库）。
 */

export const AVATAR_SIZE = 128
/** data URL 字符数上限（约 48KB 二进制）。 */
export const MAX_AVATAR_DATA_URL_LENGTH = 64 * 1024

const AVATAR_FORMAT = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

export type AvatarErrorCode = 'avatar-unsupported' | 'avatar-invalid' | 'avatar-too-large'

export class AvatarError extends Error {
  constructor(public code: AvatarErrorCode) {
    super(`avatar error: ${code}`)
    this.name = 'AvatarError'
  }
}

export function isValidAvatarDataUrl(value: string): boolean {
  return value.length <= MAX_AVATAR_DATA_URL_LENGTH && AVATAR_FORMAT.test(value)
}

/** 把图片文件处理成白名单内的 128×128 JPEG data URL；失败抛 AvatarError。 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (typeof createImageBitmap !== 'function') {
    throw new AvatarError('avatar-unsupported')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new AvatarError('avatar-invalid')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new AvatarError('avatar-unsupported')
    // cover-crop：居中裁满，不拉伸变形。
    const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    ctx.drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    if (!isValidAvatarDataUrl(dataUrl)) throw new AvatarError('avatar-too-large')
    return dataUrl
  } finally {
    bitmap.close()
  }
}

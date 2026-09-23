import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_SIZE, AvatarError, fileToAvatarDataUrl, isValidAvatarDataUrl } from './avatar'

const GOOD_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })
}

describe('fileToAvatarDataUrl', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('cover-crops into a whitelisted 128px JPEG data URL', async () => {
    const drawImage = vi.fn()
    const toDataURL = vi.fn(() => GOOD_JPEG)
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL,
    }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 400,
      height: 200,
      close: vi.fn(),
    })))

    const dataUrl = await fileToAvatarDataUrl(makeFile())

    expect(dataUrl).toBe(GOOD_JPEG)
    expect(canvas.width).toBe(AVATAR_SIZE)
    expect(canvas.height).toBe(AVATAR_SIZE)
    // cover-crop: 400×200 → 缩放后 256×128，垂直居中。
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), -64, 0, 256, 128)
  })

  it('rejects oversized output', async () => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => `data:image/jpeg;base64,${'A'.repeat(70_000)}`,
    } as unknown as HTMLCanvasElement)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })))

    const error = await fileToAvatarDataUrl(makeFile()).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AvatarError)
    expect((error as AvatarError).code).toBe('avatar-too-large')
  })

  it('rejects undecodable files and missing platform support', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('bad image')
    }))
    await expect(fileToAvatarDataUrl(makeFile())).rejects.toMatchObject({ code: 'avatar-invalid' })

    vi.stubGlobal('createImageBitmap', undefined)
    await expect(fileToAvatarDataUrl(makeFile())).rejects.toMatchObject({ code: 'avatar-unsupported' })
  })
})

describe('isValidAvatarDataUrl', () => {
  it('accepts only whitelisted raster formats within the size budget', () => {
    expect(isValidAvatarDataUrl('data:image/jpeg;base64,QUJD')).toBe(true)
    expect(isValidAvatarDataUrl('data:image/png;base64,QUJD')).toBe(true)
    expect(isValidAvatarDataUrl('data:image/webp;base64,QUJD')).toBe(true)
    expect(isValidAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isValidAvatarDataUrl('https://cdn.example.com/a.png')).toBe(false)
    expect(isValidAvatarDataUrl(`data:image/jpeg;base64,${'A'.repeat(70_000)}`)).toBe(false)
  })
})

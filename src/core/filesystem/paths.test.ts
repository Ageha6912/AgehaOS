import { describe, it, expect } from 'vitest'

import { normalizePath, splitPath, joinPath, basename, dirname, validateName } from './paths'
import { VfsError } from './types'

describe('normalizePath', () => {
  it('strips trailing slashes and collapses duplicates', () => {
    expect(normalizePath('/Documents/')).toBe('/Documents')
    expect(normalizePath('//a///b//')).toBe('/a/b')
    expect(normalizePath('/')).toBe('/')
  })

  it('rejects relative paths', () => {
    expect(() => normalizePath('Documents')).toThrow(VfsError)
  })
})

describe('splitPath', () => {
  it('splits into segments', () => {
    expect(splitPath('/')).toEqual([])
    expect(splitPath('/Documents/test.txt')).toEqual(['Documents', 'test.txt'])
  })
})

describe('joinPath / basename / dirname', () => {
  it('joins without double slashes', () => {
    expect(joinPath('/', 'Documents')).toBe('/Documents')
    expect(joinPath('/Documents', 'test.txt')).toBe('/Documents/test.txt')
  })

  it('extracts the leaf and the parent', () => {
    expect(basename('/Documents/test.txt')).toBe('test.txt')
    expect(dirname('/Documents/test.txt')).toBe('/Documents')
    expect(dirname('/test.txt')).toBe('/')
  })
})

describe('validateName', () => {
  it('accepts ordinary names', () => {
    expect(() => validateName('test.txt')).not.toThrow()
    expect(() => validateName('我的 文件')).not.toThrow()
  })

  it('rejects empty, slash-containing and dot names', () => {
    expect(() => validateName('')).toThrow(VfsError)
    expect(() => validateName('a/b')).toThrow(VfsError)
    expect(() => validateName('.')).toThrow(VfsError)
    expect(() => validateName('..')).toThrow(VfsError)
  })
})

describe('normalizePath / validateName 点段与字符收紧（B1 审查）', () => {
  it('normalizePath 拒绝点段', () => {
    expect(() => normalizePath('/Apps/x/../y')).toThrow(/must not contain/)
    expect(() => normalizePath('/a/./b')).toThrow(/must not contain/)
    expect(normalizePath('/a/b')).toBe('/a/b')
  })

  it('validateName 拒绝反斜杠与首尾空白', () => {
    expect(() => validateName('a\\b')).toThrow()
    expect(() => validateName(' name')).toThrow()
    expect(() => validateName('name ')).toThrow()
    expect(() => validateName('name')).not.toThrow()
  })
})

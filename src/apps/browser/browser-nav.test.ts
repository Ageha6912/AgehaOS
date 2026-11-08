import { describe, expect, it } from 'vitest'

import {
  BROWSE_ENDPOINT,
  browsePathFor,
  classifyAddressInput,
  displayForTarget,
  proxyUrlFor,
  resolveBrowseOrigin,
  searchUrlFor,
  targetForInput,
  targetFromBrowsePath,
  targetFromBrowseUrl,
  titleForTarget,
} from './browser-nav'

describe('browser-nav（地址栏解析）', () => {
  it('显式协议 → URL 原样', () => {
    expect(classifyAddressInput('https://example.com/a?b=1')).toEqual({
      kind: 'url',
      value: 'https://example.com/a?b=1',
    })
    expect(classifyAddressInput('http://example.com/')).toEqual({
      kind: 'url',
      value: 'http://example.com/',
    })
  })

  it('裸域名 → 补 https:// 的 URL（含端口与路径）', () => {
    expect(classifyAddressInput('example.com')).toEqual({
      kind: 'url',
      value: 'https://example.com',
    })
    expect(classifyAddressInput('news.ycombinator.com/item?id=1')).toEqual({
      kind: 'url',
      value: 'https://news.ycombinator.com/item?id=1',
    })
    expect(classifyAddressInput('example.com:8443/x')).toEqual({
      kind: 'url',
      value: 'https://example.com:8443/x',
    })
  })

  it('含空格/中文/无点词 → 搜索引擎查询', () => {
    expect(classifyAddressInput('hello world')).toEqual({ kind: 'search', value: 'hello world' })
    expect(classifyAddressInput('北京天气')).toEqual({ kind: 'search', value: '北京天气' })
    expect(classifyAddressInput('navigator')).toEqual({ kind: 'search', value: 'navigator' })
  })

  it('空串返回 null（不导航）', () => {
    expect(classifyAddressInput('   ')).toBeNull()
    expect(targetForInput('')).toBeNull()
  })

  it('targetForInput：url 直取、search 走搜索引擎端点', () => {
    expect(targetForInput('example.com')).toBe('https://example.com')
    expect(targetForInput('中文 查询')).toBe(searchUrlFor('中文 查询'))
    expect(searchUrlFor('a b')).toBe(
      `${'https://www.sogou.com/web'}?query=${encodeURIComponent('a b')}`,
    )
  })

  it('proxyUrlFor：与代理路由同字面量并整体编码', () => {
    expect(BROWSE_ENDPOINT).toBe('/api/browse')
    expect(proxyUrlFor('https://example.com/x?a=1&b=2')).toBe(
      `/api/browse?url=${encodeURIComponent('https://example.com/x?a=1&b=2')}`,
    )
  })

  it('browsePathFor：路径态编码（与 server path-codec 同构）；非法输入 null', () => {
    expect(browsePathFor('https://example.com/')).toBe('/https/example.com/')
    expect(browsePathFor('https://example.com/a?b=1&c=%20')).toBe('/https/example.com/a?b=1&c=%20')
    // http 目标也统一写 https 段（https 子域下 http 段会被混合内容拦死）。
    expect(browsePathFor('http://localhost:8787/x')).toBe('/https/localhost:8787/x')
    expect(browsePathFor('ftp://example.com/')).toBeNull()
    expect(browsePathFor('not a url')).toBeNull()
  })

  it('targetFromBrowsePath：路径态解码（与 server path-codec 同构）', () => {
    expect(targetFromBrowsePath('/https/example.com/', '')).toBe('https://example.com/')
    expect(targetFromBrowsePath('/https/example.com/a/b', '?c=1')).toBe(
      'https://example.com/a/b?c=1',
    )
    expect(targetFromBrowsePath('/http/example.com/x', '')).toBe('http://example.com/x')
    expect(targetFromBrowsePath('/ftp/example.com/', '')).toBeNull()
    expect(targetFromBrowsePath('/https/', '')).toBeNull()
  })

  it('targetFromBrowseUrl：query 代理 / 路径子域解码，站外 origin 拒绝（D1 审查）', () => {
    const pageOrigin = 'https://os.ageha.cn'
    const query = `${pageOrigin}/api/browse?url=${encodeURIComponent('https://example.com/a?b=1')}`
    expect(targetFromBrowseUrl(query, null, pageOrigin)).toBe('https://example.com/a?b=1')

    const path = 'https://browse.ageha.cn/https/example.com/x?y=2'
    expect(targetFromBrowseUrl(path, 'https://browse.ageha.cn', pageOrigin)).toBe(
      'https://example.com/x?y=2',
    )
    // 子域未启用时路径态不算数；站外 origin 一律拒绝。
    expect(targetFromBrowseUrl(path, null, pageOrigin)).toBeNull()
    expect(targetFromBrowseUrl('https://evil.example/https/example.com/', null, pageOrigin)).toBeNull()
    // 非代理路径同源文档不认。
    expect(targetFromBrowseUrl(`${pageOrigin}/apps/index.html`, null, pageOrigin)).toBeNull()
  })

  it('resolveBrowseOrigin：显式优先 > 远程认证缺省子域 > 空（禁用 v3）', () => {
    expect(resolveBrowseOrigin('http://browse.local', false)).toBe('http://browse.local')
    expect(resolveBrowseOrigin(undefined, true)).toBe('https://browse.ageha.cn')
    expect(resolveBrowseOrigin(undefined, false)).toBe('')
    expect(resolveBrowseOrigin('', true)).toBe('https://browse.ageha.cn')
  })

  it('displayForTarget/titleForTarget：去协议压缩显示、取 host 作标题', () => {
    expect(displayForTarget('https://example.com/')).toBe('example.com')
    expect(displayForTarget('https://example.com/a/b?c=1')).toBe('example.com/a/b?c=1')
    expect(titleForTarget('https://news.example.com/x')).toBe('news.example.com')
    expect(titleForTarget('not-a-url')).toBe('not-a-url')
  })
})

describe('hash 保留（D1 审查）', () => {
  it('query 代理：hash 移到代理地址自身 fragment（url= 只承载无 hash 目标）', () => {
    const proxied = proxyUrlFor('https://example.com/a#section')
    expect(proxied).toBe(`/api/browse?url=${encodeURIComponent('https://example.com/a')}#section`)
  })

  it('路径态：hash 附在 /https/… 地址尾部（服务端请求自然剥除）', () => {
    expect(browsePathFor('https://example.com/a#section')).toBe('/https/example.com/a#section')
  })

  it('地址栏显示保留 hash；无 hash 行为不变', () => {
    expect(displayForTarget('https://example.com/a#section')).toBe('example.com/a#section')
    expect(displayForTarget('https://example.com/a?b=1')).toBe('example.com/a?b=1')
    expect(proxyUrlFor('https://example.com/a')).toBe(`/api/browse?url=${encodeURIComponent('https://example.com/a')}`)
  })
})

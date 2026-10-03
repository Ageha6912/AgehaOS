import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createHtmlStreamSplitter, type EclosionStreamChunk } from './html-stream'

/** 与 runner 同款的增量挂载口径：片段经 <template> 解析后绝不能含 script 元素。 */
function scriptElementsOf(html: string): number {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content.querySelectorAll('script').length
}

function run(text: string): { chunks: EclosionStreamChunk[]; scripts: string[] } {
  const splitter = createHtmlStreamSplitter()
  const chunks = [...splitter.push(text), ...splitter.flush()]
  return { chunks, scripts: splitter.scripts() }
}

describe('html-stream：样式与骨架先行（设计 §4.2）', () => {
  it('emits the style element before the skeleton (one chunk per closed construct)', () => {
    const doc = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>.app{color:red}</style></head><body><div class="app"><button>1</button></div></body></html>'
    const { chunks } = run(doc)
    expect(chunks.map((c) => c.html)).toEqual([
      '<meta charset="utf-8">',
      '<style>.app{color:red}</style>',
      '<div class="app"><button>1</button></div>',
    ])
  })

  it('strips document structure tags (doctype/html/head/body) from every chunk', () => {
    const { chunks } = run('<!doctype html>\n<html lang="zh-CN"><head></head><body><p>hi</p></body></html>')
    const all = chunks.map((c) => c.html).join('')
    expect(all).not.toContain('<html')
    expect(all).not.toContain('</html')
    expect(all).not.toContain('<head')
    expect(all).not.toContain('</head')
    expect(all).not.toContain('<body')
    expect(all).not.toContain('</body')
    expect(all.toLowerCase()).not.toContain('doctype')
    expect(all).toBe('\n<p>hi</p>')
  })

  it('numbers chunks monotonically from zero', () => {
    const { chunks } = run('<p>a</p><p>b</p><p>c</p>')
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2])
  })
})

describe('html-stream：script 截留（安全关键）', () => {
  it('withholds script content and the script element itself from every chunk', () => {
    const doc = '<div class="app"><button id="b">点我</button></div><script>window.__clicked = 0\ndocument.getElementById("b").onclick = () => { window.__clicked++ }</script>'
    const { chunks, scripts } = run(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].html).toBe('<div class="app"><button id="b">点我</button></div>')
    expect(scripts).toEqual(['window.__clicked = 0\ndocument.getElementById("b").onclick = () => { window.__clicked++ }'])
    for (const chunk of chunks) expect(scriptElementsOf(chunk.html)).toBe(0)
  })

  it('withholds multiple scripts and preserves their order', () => {
    const { chunks, scripts } = run('<p>1</p><script>var a = 1</script><p>2</p><script>var b = 2</script>')
    expect(scripts).toEqual(['var a = 1', 'var b = 2'])
    expect(chunks.map((c) => c.html)).toEqual(['<p>1</p>', '<p>2</p>'])
  })

  it('withholds scripts with attributes, uppercase tags and leading whitespace before the close tag', () => {
    const { chunks, scripts } = run('<SCRIPT type="module">\n  var x = 1\n</SCRIPT >')
    expect(chunks).toHaveLength(0)
    expect(scripts).toEqual(['\n  var x = 1\n'])
  })

  it('keeps script-tag-looking text inside comments inert (comment survives, no script element)', () => {
    const { chunks } = run('<!-- <script>not real code</script> --><p>ok</p>')
    expect(chunks.map((c) => c.html)).toEqual(['<!-- <script>not real code</script> -->', '<p>ok</p>'])
    for (const chunk of chunks) expect(scriptElementsOf(chunk.html)).toBe(0)
  })

  it('does not treat CSS child selectors or quoted ">" as markup', () => {
    const { chunks } = run('<style>div > p { color: red }</style><div data-x="a>b"><p>hi</p></div>')
    expect(chunks.map((c) => c.html)).toEqual([
      '<style>div > p { color: red }</style>',
      '<div data-x="a>b"><p>hi</p></div>',
    ])
    for (const chunk of chunks) expect(scriptElementsOf(chunk.html)).toBe(0)
  })

  it('treats a stray "<" in text as text (a < b)', () => {
    const { chunks } = run('<p>1 < 2 且 3<4</p>')
    expect(chunks.map((c) => c.html)).toEqual(['<p>1 < 2 且 3<4</p>'])
  })
})

describe('html-stream：未闭合元素与残缺标签留在缓冲', () => {
  it('holds an open element until it closes', () => {
    const splitter = createHtmlStreamSplitter()
    expect(splitter.push('<div class="app">')).toEqual([])
    expect(splitter.push('<p>半')).toEqual([])
    expect(splitter.push('成品</p>')).toEqual([])
    const chunks = splitter.push('</div>')
    expect(chunks).toEqual([{ seq: 0, html: '<div class="app"><p>半成品</p></div>' }])
    expect(splitter.flush()).toEqual([])
  })

  it('holds a tag split across pushes at any byte boundary', () => {
    const splitter = createHtmlStreamSplitter()
    expect(splitter.push('<div cl')).toEqual([])
    expect(splitter.push('ass="a">x</div>')).toEqual([{ seq: 0, html: '<div class="a">x</div>' }])
  })

  it('holds a style element until its close tag (CSS ">" does not close anything)', () => {
    const splitter = createHtmlStreamSplitter()
    expect(splitter.push('<style>a > b { color: red }')).toEqual([])
    expect(splitter.push('</style><p>ok</p>')).toEqual([
      { seq: 0, html: '<style>a > b { color: red }</style>' },
      { seq: 1, html: '<p>ok</p>' },
    ])
  })

  it('emits void and self-closing elements immediately', () => {
    const { chunks } = run('<img src="x.png"><br/><hr>')
    expect(chunks.map((c) => c.html)).toEqual(['<img src="x.png">', '<br/>', '<hr>'])
  })

  it('flush emits leftovers and drops a trailing partial tag', () => {
    const splitter = createHtmlStreamSplitter()
    expect(splitter.push('<p>收尾</p><div cl')).toEqual([{ seq: 0, html: '<p>收尾</p>' }])
    expect(splitter.flush()).toEqual([]) // 残缺标签被丢弃
  })

  it('flush emits an unclosed element verbatim (browser auto-closes it)', () => {
    const splitter = createHtmlStreamSplitter()
    splitter.push('<div><p>未闭合')
    expect(splitter.flush()).toEqual([{ seq: 0, html: '<div><p>未闭合' }])
  })

  it('flush yields the withheld content of a truncated script for honest failure', () => {
    const splitter = createHtmlStreamSplitter()
    expect(splitter.push('<p>x</p><script>var half =')).toEqual([{ seq: 0, html: '<p>x</p>' }])
    expect(splitter.flush()).toEqual([]) // 完整片已在 push 时成片；残缺 script 无输出
    expect(splitter.scripts()).toEqual(['var half ='])
  })
})

describe('html-stream：逐字符流式等价性', () => {
  it('produces identical chunks when fed one character at a time', () => {
    const doc = '<!doctype html><html><head><style>.a{color:red}</style></head><body><div class="a"><p>深<span>嵌套</span></p></div><script>var x = "含>与<的字符串"</script><p>尾</p></body></html>'
    const oneShot = run(doc)
    const splitter = createHtmlStreamSplitter()
    const chunks: EclosionStreamChunk[] = []
    for (const ch of doc) chunks.push(...splitter.push(ch))
    chunks.push(...splitter.flush())
    expect(chunks).toEqual(oneShot.chunks)
    expect(splitter.scripts()).toEqual(oneShot.scripts)
  })
})

describe('html-stream：合成样本夹具（生成契约形状）', () => {
  const SAMPLES_DIR = join('src/core/eclosion/samples')
  const RECONSTRUCTION_SAMPLES = ['canvas-game.html', 'event-counter.html', 'css-animation.html']

  it('splits every sample with zero script leakage and a full-document reconstruction', () => {
    // tricky-markup 内含「注释里藏 <script> 文本」等难例，重建对照在下方单独手写黄金值。
    for (const file of RECONSTRUCTION_SAMPLES) {
      const doc = readFileSync(join(SAMPLES_DIR, file), 'utf8')
      const { chunks, scripts } = run(doc)
      expect(chunks.length, `${file} 应切出多片`).toBeGreaterThan(1)

      // 安全不变量：任何片经 <template> 解析不含 script 元素；script 源码绝不出现在片中。
      for (const chunk of chunks) {
        expect(scriptElementsOf(chunk.html), `${file} 的片 ${chunk.seq} 泄漏了 script`).toBe(0)
        for (const script of scripts) {
          const marker = script.slice(0, Math.min(script.length, 24))
          expect(chunk.html, `${file} 的片 ${chunk.seq} 含 script 源码片段`).not.toContain(marker)
        }
      }

      // 样式先行：meta/title 先落（结构标签间的空白随下一片前缀），样式片必须先于任何主体骨架片。
      expect(chunks[0].html.trim().startsWith('<meta'), `${file} 首片应先携带 meta`).toBe(true)
      const styleIdx = chunks.findIndex((c) => c.html.includes('<style'))
      const bodyIdx = chunks.findIndex((c) => /<(main|section|div|canvas|p|button|svg)\b/.test(c.html))
      expect(styleIdx, `${file} 应有样式片`).toBeGreaterThanOrEqual(0)
      expect(bodyIdx, `${file} 应有骨架片`).toBeGreaterThan(styleIdx)

      // 结构剥除 + script 全截留：重建 = 原文档 - 结构标签 - script 元素。
      const rebuilt = chunks.map((c) => c.html).join('')
      const oracle = doc
        .replace(/<!doctype[^>]*>/gi, '')
        .replace(/<\/?html[^>]*>/gi, '')
        .replace(/<\/?head>/gi, '')
        .replace(/<\/?body>/gi, '')
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
      expect(rebuilt).toBe(oracle)
    }
  })

  it('keeps tricky markup intact: quoted ">", CSS child selectors, commented script text, stray "<"', () => {
    const doc = readFileSync(join(SAMPLES_DIR, 'tricky-markup.html'), 'utf8')
    const { chunks, scripts } = run(doc)
    const rebuilt = chunks.map((c) => c.html).join('')

    // 注释整体保留且惰性（无 script 元素）；引用内 ">" 不截断标签；`1 < 2` 原样。
    expect(rebuilt).toContain('<!-- <script>这是注释里的假脚本标记</script> -->')
    expect(rebuilt).toContain('data-note="a>b"')
    expect(rebuilt).toContain('1 < 2')
    for (const chunk of chunks) expect(scriptElementsOf(chunk.html)).toBe(0)

    // 真脚本被截留。
    expect(scripts.join('\n')).toContain('__trickyBooted')

    // 黄金重建：结构标签剥除 + 唯一真 script 元素（带 type 属性，注释里的假标记不带）截留。
    const oracle = doc
      .replace(/<!doctype[^>]*>/i, '')
      .replace(/<\/?html[^>]*>/gi, '')
      .replace(/<\/?head>/gi, '')
      .replace(/<\/?body>/gi, '')
      .replace(/<script type="application\/javascript">[\s\S]*?<\/script\s*>/i, '')
    expect(rebuilt).toBe(oracle)
  })

  it('splits the canvas sample so the skeleton mounts before power-on', () => {
    const doc = readFileSync(join(SAMPLES_DIR, 'canvas-game.html'), 'utf8')
    const { chunks, scripts } = run(doc)
    const canvasChunk = chunks.find((c) => c.html.includes('<canvas'))
    expect(canvasChunk).toBeDefined()
    // 截留的脚本应包含游戏主循环（破茧后才执行）。
    expect(scripts.join('\n')).toContain('requestAnimationFrame')
    // 骨架片先于破茧存在：canvas 片不含任何脚本内容。
    expect(canvasChunk?.html).not.toContain('requestAnimationFrame')
  })
})

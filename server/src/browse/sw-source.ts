/**
 * 服务端下发的 Service Worker 源码（档 ③）。设计成**薄层**：
 * SW 只做两件事——把子域上的请求换算回「/raw + 路径态目标」，以及为页面内
 * 相对请求按「当前客户端文档的目标」解析基准；其余一切（SSRF 闸、头消毒、
 * Cookie 罐、HTML 重写、重定向跟随）都在服务端 TS 里（全套测试）。
 *
 * 递归防护：/raw、/sw.js、/__* 一律放行不拦截；SW 自己也只 fetch /raw，
 * 不会自我循环。
 *
 * fetch 事件覆盖：导航（地址栏/链接/表单/JS location）、XHR/fetch、动态
 * script/css/img 等——凡作用域内同源请求皆由此契约接管；跨域请求原样放行
 * （资产经 <base> 直连原站的设计不变）。
 */

export function browseSwSource(): string {
  return `/* AgehaOS browse proxy service worker (tier C-3). Serve from browse host root. */
'use strict'
var INFRA = /^\\/(?:raw\\/|sw\\.js$|__)/
var PATH_TARGET = /^\\/(https?)\\/([^/]+)(\\/.*)?$/

function pathTargetOf(pathname, search) {
  var m = PATH_TARGET.exec(pathname)
  if (!m) return null
  return m[1] + '://' + m[2] + (m[3] || '/') + (search || '')
}

self.addEventListener('install', function () {
  self.skipWaiting()
})
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', function (event) {
  var request = event.request
  var url
  try {
    url = new URL(request.url)
  } catch (e) {
    return
  }
  if (url.origin !== self.location.origin) return
  if (INFRA.test(url.pathname)) return

  event.respondWith(
    (async function () {
      var target = pathTargetOf(url.pathname, url.search)
      if (target === null) {
        var base = null
        try {
          var client = event.clientId ? await self.clients.get(event.clientId) : null
          if (client && client.url) {
            var cu = new URL(client.url)
            base = pathTargetOf(cu.pathname, cu.search)
          }
        } catch (e) {
          base = null
        }
        if (base === null) return fetch(request)
        try {
          target = new URL(url.pathname + url.search, base).toString()
        } catch (e) {
          return fetch(request)
        }
      }
      var rawPath
      try {
        var t = new URL(target)
        rawPath = '/raw/' + t.protocol.slice(0, -1) + '/' + t.host + t.pathname + t.search
      } catch (e) {
        return fetch(request)
      }
      var init = { method: request.method, redirect: 'follow', credentials: 'same-origin' }
      var contentType = request.headers.get('content-type')
      if (contentType) init.headers = { 'content-type': contentType }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = await request.arrayBuffer()
      }
      return fetch(rawPath, init)
    })()
  )
})
`
}

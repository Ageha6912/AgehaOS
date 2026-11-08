/*!
 * AgehaOS App SDK（Type C，PRD §8.1）— 客户端库。
 *
 * 在 iframe 沙箱（不透明 origin）内运行，通过 postMessage 与宿主通信：
 * 每个请求都由宿主按 Default Deny 权限门禁校验后执行（§10.3）。
 * 未授予的能力会以 rejected promise（permission-denied）回返，不会静默失败。
 *
 * 用法：
 *   <script src="/sdk/ageha-sdk.js"></script>
 *   const theme = await AgehaOS.theme.get();
 *   await AgehaOS.storage.set('note', { text: 'hi' });
 *   await AgehaOS.window.setTitle('便签 (1)');
 */
(function () {
  'use strict'

  var REQUEST_TYPE = 'agehaos:sdk'
  var RESULT_TYPE = 'agehaos:sdk-result'
  var REQUEST_TIMEOUT_MS = 5000

  var seq = 0
  var pending = new Map()

  function request(api, action, params) {
    return new Promise(function (resolve, reject) {
      seq += 1
      var reqId = 'r' + seq
      pending.set(reqId, { resolve: resolve, reject: reject })
      window.setTimeout(function () {
        if (pending.has(reqId)) {
          pending.delete(reqId)
          reject(new Error('sdk-timeout'))
        }
      }, REQUEST_TIMEOUT_MS)
      window.parent.postMessage({ type: REQUEST_TYPE, reqId: reqId, api: api, action: action, params: params || {} }, '*')
    })
  }

  window.addEventListener('message', function (event) {
    // 宿主回执只认父窗口（B2 审查）：应用内嵌第三方 iframe 可 parent.postMessage
    // 伪造 sdk-result，篡改 storage/files 结果；reqId 顺序可预测。
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || data.type !== RESULT_TYPE) return
    var entry = pending.get(data.reqId)
    if (!entry) return
    pending.delete(data.reqId)
    if (data.ok) entry.resolve(data.data)
    else entry.reject(new Error(data.error || 'sdk-error'))
  })

  window.AgehaOS = {
    /** storage 权限：按应用隔离的键值存储（值需可 JSON 序列化）。 */
    storage: {
      get: function (key) {
        return request('storage', 'get', { key: key }).then(function (data) {
          return data.value
        })
      },
      set: function (key, value) {
        return request('storage', 'set', { key: key, value: value }).then(function () {
          return true
        })
      },
      remove: function (key) {
        return request('storage', 'remove', { key: key }).then(function () {
          return true
        })
      },
      keys: function () {
        return request('storage', 'keys', {}).then(function (data) {
          return data.keys
        })
      },
    },
    /** window 权限：更新本应用窗口的标题。 */
    window: {
      setTitle: function (title) {
        return request('window', 'setTitle', { title: title }).then(function () {
          return true
        })
      },
    },
    /** 免许可：读取当前明暗主题（'light' | 'dark'）。 */
    theme: {
      get: function () {
        return request('theme', 'get', {}).then(function (data) {
          return data.theme
        })
      },
    },
    /** notification 权限：发送应用通知（进入宿主通知中心：toast + 历史）。 */
    notification: {
      show: function (options) {
        return request('notification', 'show', {
          title: (options && options.title) || '',
          body: (options && options.body) || '',
        }).then(function () {
          return true
        })
      },
    },
    /**
     * filesystem.read / filesystem.write 权限：应用主目录内的文件访问
     * （/Apps/<appId>/，路径一律相对主目录解析，越界一律 invalid-path）。
     */
    files: {
      read: function (path) {
        return request('files', 'read', { path: path }).then(function (data) {
          return data.content
        })
      },
      write: function (path, content) {
        return request('files', 'write', { path: path, content: content === undefined ? '' : content }).then(function () {
          return true
        })
      },
      list: function (path) {
        // 无参缺省根目录（B2 审查：桥拒绝空串，undefined 原样透传必然
        // invalid-path）；显式传 '' 仍按原样交给桥拒绝。
        return request('files', 'list', { path: path === undefined ? '/' : path }).then(function (data) {
          return data.entries
        })
      },
      mkdir: function (path) {
        return request('files', 'mkdir', { path: path }).then(function () {
          return true
        })
      },
      remove: function (path) {
        return request('files', 'remove', { path: path }).then(function () {
          return true
        })
      },
    },
    /** 免许可：当前登录用户的最小身份（username / displayName；无邮箱、头像、会话）。 */
    user: {
      get: function () {
        return request('user', 'get', {}).then(function (data) {
          return data.user
        })
      },
    },
    /** 免许可：本应用被授予的权限名清单。 */
    permissions: {
      all: function () {
        return request('permissions', 'all', {}).then(function (data) {
          return data.permissions
        })
      },
    },
    /** 免许可：系统环境事实（version / locale / tier）。 */
    system: {
      info: function () {
        return request('system', 'info', {}).then(function (data) {
          return data.info
        })
      },
    },
  }

  // 就绪握手：告诉宿主 SDK 已加载（配合宿主的 hello 消息亦可）。
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    if (event.data && event.data.type === 'agehaos:hello') {
      event.source.postMessage({ type: 'agehaos:ready' }, '*')
    }
  })
})()

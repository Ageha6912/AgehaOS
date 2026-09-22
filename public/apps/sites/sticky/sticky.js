// 便签（AgehaOS Type C 示例应用，PRD §8.1）。
// 通过 AgehaOS SDK 使用三个能力：storage（持久化便签）、window（标题同步数量）、
// theme（跟随明暗主题）。所有请求都经宿主 Default Deny 门禁校验。

var state = {
  notes: [],
}

var listEl = document.getElementById('notes')
var statusEl = document.getElementById('status')
var textEl = document.getElementById('text')

function setStatus(message, isError) {
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.classList.toggle('error', Boolean(isError))
}

function render() {
  if (!listEl) return
  listEl.innerHTML = ''
  if (state.notes.length === 0) {
    var empty = document.createElement('li')
    empty.className = 'empty'
    empty.textContent = '还没有便签'
    listEl.appendChild(empty)
  }
  state.notes.forEach(function (note, index) {
    var item = document.createElement('li')
    var span = document.createElement('span')
    span.textContent = note
    var remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '删除'
    remove.setAttribute('aria-label', '删除便签 ' + (index + 1))
    remove.addEventListener('click', function () {
      state.notes.splice(index, 1)
      save()
    })
    item.appendChild(span)
    item.appendChild(remove)
    listEl.appendChild(item)
  })
  // Window API：窗口标题随便签数量变化。
  window.AgehaOS.window
    .setTitle(state.notes.length > 0 ? '便签 (' + state.notes.length + ')' : '便签')
    .catch(function () {
      /* 未授予 window 权限时静默降级 */
    })
}

function save() {
  // Storage API：写入宿主按 appId 隔离的存储。
  window.AgehaOS.storage
    .set('notes', state.notes)
    .then(function () {
      setStatus('已通过 SDK 保存 · ' + new Date().toLocaleTimeString('zh-CN'))
      render()
    })
    .catch(function (error) {
      setStatus('保存失败：' + error.message, true)
    })
}

function load() {
  // Theme API：免许可读取当前主题。
  window.AgehaOS.theme
    .get()
    .then(function (data) {
      document.body.classList.toggle('theme-light', data.theme === 'light')
    })
    .catch(function () {
      /* 主题读取失败保持默认 */
    })

  window.AgehaOS.storage
    .get('notes')
    .then(function (value) {
      state.notes = Array.isArray(value) ? value.filter(function (n) {
        return typeof n === 'string'
      }) : []
      setStatus('SDK 已连接（storage + window + theme）')
      render()
    })
    .catch(function (error) {
      setStatus('SDK 未授权：' + error.message, true)
    })
}

function addFromInput() {
  if (!textEl) return
  var text = textEl.value.trim()
  if (text === '') return
  state.notes.push(text)
  textEl.value = ''
  save()
}

// 沙箱未授予 allow-forms：原生表单提交会被浏览器拦截，输入一律走 JS 事件。
document.getElementById('add')?.addEventListener('click', addFromInput)
textEl?.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addFromInput()
  }
})

load()

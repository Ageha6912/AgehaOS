// 云笔记示例（Type C SDK）：filesystem.read/write + notification 能力演示。
// 笔记正文经 AgehaOS.files 持久化到本应用专属目录（/Apps/<appId>/note.txt），
// 「发送通知」经 AgehaOS.notification.show 进入宿主通知中心。
(function () {
  'use strict'

  var NOTE_PATH = 'note.txt'

  var editor = document.getElementById('editor')
  var notifyButton = document.getElementById('notify')
  var status = document.getElementById('status')

  var saveTimer = null

  function setStatus(text) {
    status.textContent = text
  }

  function scheduleSave() {
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(function () {
      saveTimer = null
      var content = editor.value
      AgehaOS.files
        .write(NOTE_PATH, content)
        .then(function () {
          setStatus('已保存 · ' + new Date().toLocaleTimeString())
        })
        .catch(function (error) {
          setStatus('保存失败：' + error.message)
        })
    }, 400)
  }

  AgehaOS.files
    .read(NOTE_PATH)
    .then(function (content) {
      editor.value = content
      setStatus('已从应用空间载入')
    })
    .catch(function () {
      setStatus('新笔记')
    })

  editor.addEventListener('input', scheduleSave)

  notifyButton.addEventListener('click', function () {
    AgehaOS.notification
      .show({ title: '云笔记', body: '笔记已保存在本应用空间（共 ' + editor.value.length + ' 字）' })
      .then(function () {
        setStatus('通知已发送')
      })
      .catch(function (error) {
        setStatus('通知失败：' + error.message)
      })
  })

  // 主题适配（免许可）。
  function applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light')
  }
  AgehaOS.theme.get().then(applyTheme)
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'agehaos:theme' && event.data.theme) applyTheme(event.data.theme)
  })
})()

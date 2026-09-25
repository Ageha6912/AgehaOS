// 计数器（远程目录发布示例）：零权限，会话内计数（沙箱无法持久化）。
(function () {
  'use strict'

  var value = 0
  var valueEl = document.getElementById('value')

  function render() {
    valueEl.textContent = String(value)
  }

  document.getElementById('inc').addEventListener('click', function () {
    value += 1
    render()
  })
  document.getElementById('dec').addEventListener('click', function () {
    value -= 1
    render()
  })
  document.getElementById('reset').addEventListener('click', function () {
    value = 0
    render()
  })
  render()
})()

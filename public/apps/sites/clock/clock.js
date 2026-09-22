// 时钟与秒表（AgehaOS Type B 示例应用）。
// 运行在 iframe 不透明 origin 中：只使用自身 DOM，不访问任何宿主能力。

const clockEl = document.getElementById('clock')
const dateEl = document.getElementById('date')
const stopwatchEl = document.getElementById('stopwatch')

function renderClock() {
  const now = new Date()
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: false })
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    })
  }
}

let startedAt = null
let elapsedMs = 0

function renderStopwatch() {
  if (!stopwatchEl) return
  const total = elapsedMs + (startedAt === null ? 0 : Date.now() - startedAt)
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const tenths = Math.floor((total % 1000) / 100)
  stopwatchEl.textContent =
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
}

document.getElementById('start')?.addEventListener('click', () => {
  if (startedAt === null) startedAt = Date.now()
})
document.getElementById('stop')?.addEventListener('click', () => {
  if (startedAt !== null) {
    elapsedMs += Date.now() - startedAt
    startedAt = null
  }
})
document.getElementById('reset')?.addEventListener('click', () => {
  startedAt = null
  elapsedMs = 0
  renderStopwatch()
})

// 宿主握手（§30.3）：收到 hello 后回执 ready。
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'agehaos:hello') {
    event.source?.postMessage({ type: 'agehaos:ready' }, '*')
  }
})

renderClock()
renderStopwatch()
setInterval(renderClock, 1000)
setInterval(renderStopwatch, 100)

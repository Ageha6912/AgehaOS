// 涂鸦画板（AgehaOS Type B 示例应用）。
// 只用自身 <canvas> 与指针事件，不访问任何宿主能力。

const canvas = document.getElementById('canvas')
const colorInput = document.getElementById('color')
const widthInput = document.getElementById('width')

const ctx = canvas ? canvas.getContext('2d') : null

function resizeCanvas() {
  if (!canvas || !ctx) return
  const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.clientWidth
  canvas.height = canvas.clientHeight
  ctx.putImageData(snapshot, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

let drawing = false

function positionOf(event) {
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

canvas?.addEventListener('pointerdown', (event) => {
  drawing = true
  const { x, y } = positionOf(event)
  ctx?.beginPath()
  ctx?.moveTo(x, y)
  canvas.setPointerCapture(event.pointerId)
})

canvas?.addEventListener('pointermove', (event) => {
  if (!drawing || !ctx) return
  const { x, y } = positionOf(event)
  ctx.strokeStyle = colorInput ? colorInput.value : '#2dd4bf'
  ctx.lineWidth = widthInput ? Number(widthInput.value) : 4
  ctx.lineTo(x, y)
  ctx.stroke()
})

window.addEventListener('pointerup', () => {
  drawing = false
})

document.getElementById('clear')?.addEventListener('click', () => {
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
})

window.addEventListener('resize', resizeCanvas)
resizeCanvas()

// 宿主握手（§30.3）：收到 hello 后回执 ready。
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'agehaos:hello') {
    event.source?.postMessage({ type: 'agehaos:ready' }, '*')
  }
})

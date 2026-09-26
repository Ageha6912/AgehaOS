(() => {
  'use strict'

  const CELL = 17
  const GRID = 20
  const TICK_MS = 110

  const canvas = document.getElementById('board')
  const ctx = canvas.getContext('2d')
  const scoreEl = document.getElementById('score')
  const bestEl = document.getElementById('best')
  const startBtn = document.getElementById('start')

  let snake
  let dir
  let pendingDir
  let food
  let score
  let best = 0
  let timer = null
  let running = false

  function spawnFood() {
    while (true) {
      const x = Math.floor(Math.random() * GRID)
      const y = Math.floor(Math.random() * GRID)
      if (!snake.some((part) => part.x === x && part.y === y)) {
        food = { x, y }
        return
      }
    }
  }

  function reset() {
    snake = [
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 8, y: 10 },
    ]
    dir = { x: 1, y: 0 }
    pendingDir = dir
    score = 0
    scoreEl.textContent = '0'
    spawnFood()
    draw()
  }

  function step() {
    dir = pendingDir
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
    const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID
    const hitSelf = snake.some((part) => part.x === head.x && part.y === head.y)
    if (hitWall || hitSelf) return gameOver()

    snake.unshift(head)
    if (head.x === food.x && head.y === food.y) {
      score += 10
      scoreEl.textContent = String(score)
      if (score > best) {
        best = score
        bestEl.textContent = String(best)
      }
      spawnFood()
    } else {
      snake.pop()
    }
    draw()
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#e11d48'
    ctx.beginPath()
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2)
    ctx.fill()
    snake.forEach((part, index) => {
      ctx.fillStyle = index === 0 ? '#1d43b8' : '#3b6cf6'
      roundRect(part.x * CELL + 1, part.y * CELL + 1, CELL - 2, CELL - 2, 4)
      ctx.fill()
    })
  }

  function gameOver() {
    running = false
    clearInterval(timer)
    timer = null
    startBtn.textContent = '再来一局'
    ctx.fillStyle = 'rgba(24, 32, 44, 0.55)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.font = '16px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(`游戏结束 · ${score} 分`, canvas.width / 2, canvas.height / 2 - 6)
    ctx.font = '12px system-ui'
    ctx.fillText('点「再来一局」重新开始', canvas.width / 2, canvas.height / 2 + 16)
  }

  function start() {
    if (running) return
    reset()
    running = true
    startBtn.textContent = '进行中…'
    timer = setInterval(step, TICK_MS)
  }

  const KEYS = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
  }

  window.addEventListener('keydown', (event) => {
    const next = KEYS[event.key] ?? KEYS[event.key?.toLowerCase?.()]
    if (!next) return
    event.preventDefault()
    // 禁止 180° 掉头。
    if (next.x !== -dir.x || next.y !== -dir.y) pendingDir = next
  })

  startBtn.addEventListener('click', start)
  reset()
})()

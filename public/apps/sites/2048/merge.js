(() => {
  'use strict'

  const SIZE = 4
  // 数值 → 底色（冷色域渐进：越大越深）。
  const TILE_COLORS = {
    2: ['#dbe7fb', '#18202c'],
    4: ['#c3d7f8', '#18202c'],
    8: ['#8fb0f2', '#ffffff'],
    16: ['#5f8bec', '#ffffff'],
    32: ['#3b6cf6', '#ffffff'],
    64: ['#2a50c4', '#ffffff'],
    128: ['#6d75f8', '#ffffff'],
    256: ['#8b6cf2', '#ffffff'],
    512: ['#5a3ed0', '#ffffff'],
    1024: ['#1fb8a6', '#ffffff'],
    2048: ['#0f766e', '#ffffff'],
  }

  const gridEl = document.getElementById('grid')
  const scoreEl = document.getElementById('score')
  let board
  let score

  function emptyCells() {
    const cells = []
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        if (board[r][c] === 0) cells.push([r, c])
      }
    }
    return cells
  }

  function spawnTile() {
    const cells = emptyCells()
    if (cells.length === 0) return
    const [r, c] = cells[Math.floor(Math.random() * cells.length)]
    board[r][c] = Math.random() < 0.9 ? 2 : 4
  }

  function render() {
    gridEl.textContent = ''
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const value = board[r][c]
        const tile = document.createElement('div')
        tile.className = 'tile pop'
        if (value > 0) {
          const [bg, fg] = TILE_COLORS[value] ?? ['#0f172a', '#ffffff']
          tile.style.background = bg
          tile.style.color = fg
          tile.textContent = String(value)
        }
        gridEl.appendChild(tile)
      }
    }
    scoreEl.textContent = String(score)
  }

  /** 单行向左合并：先压缩再相邻合并再压缩，返回该行与是否发生变化。 */
  function mergeLine(line) {
    const values = line.filter((v) => v !== 0)
    const merged = []
    let gained = 0
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] === values[i + 1]) {
        merged.push(values[i] * 2)
        gained += values[i] * 2
        i += 1
      } else {
        merged.push(values[i])
      }
    }
    while (merged.length < SIZE) merged.push(0)
    const changed = merged.some((v, i) => v !== line[i])
    return { merged, changed, gained }
  }

  function move(direction) {
    let changed = false
    let gained = 0
    const rotate = (r, c) =>
      direction === 'left' ? [r, c]
      : direction === 'right' ? [r, SIZE - 1 - c]
      : direction === 'up' ? [c, r]
      : [SIZE - 1 - c, r]

    for (let i = 0; i < SIZE; i += 1) {
      const line = []
      for (let j = 0; j < SIZE; j += 1) {
        const [r, c] = rotate(i, j)
        line.push(board[r][c])
      }
      const result = mergeLine(line)
      gained += result.gained
      changed = changed || result.changed
      for (let j = 0; j < SIZE; j += 1) {
        const [r, c] = rotate(i, j)
        board[r][c] = result.merged[j]
      }
    }
    if (changed) {
      score += gained
      spawnTile()
      render()
      if (isDead()) {
        window.setTimeout(() => {
          window.alert(`没有可移动的方向了 · 最终得分 ${score}`)
        }, 120)
      }
    }
  }

  function isDead() {
    if (emptyCells().length > 0) return false
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const value = board[r][c]
        if (c + 1 < SIZE && board[r][c + 1] === value) return false
        if (r + 1 < SIZE && board[r + 1][c] === value) return false
      }
    }
    return true
  }

  function newGame() {
    board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 0))
    score = 0
    spawnTile()
    spawnTile()
    render()
  }

  const KEY_DIRS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down',
  }

  window.addEventListener('keydown', (event) => {
    const direction = KEY_DIRS[event.key] ?? KEY_DIRS[event.key?.toLowerCase?.()]
    if (!direction) return
    event.preventDefault()
    move(direction)
  })

  document.querySelectorAll('.pad button').forEach((button) => {
    button.addEventListener('click', () => move(button.dataset.dir))
  })
  document.getElementById('new').addEventListener('click', newGame)
  newGame()
})()

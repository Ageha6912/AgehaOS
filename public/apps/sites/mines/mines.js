(() => {
  'use strict'

  const SIZE = 9
  const MINE_COUNT = 10
  // 相邻雷数 → 数字颜色（1 蓝 2 青 3 紫以示区分）。
  const NUMBER_COLORS = ['#2f5fe8', '#0e7490', '#5a3ed0', '#0f766e', '#4338ca', '#0369a1', '#7e22ce', '#1d43b8']

  const gridEl = document.getElementById('grid')
  const minesEl = document.getElementById('mines')

  let cells
  let started
  let over

  /** cells: { mine, revealed, flagged, adjacent }，索引 = r * SIZE + c。 */
  function neighbors(index) {
    const r = Math.floor(index / SIZE)
    const c = index % SIZE
    const result = []
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const nr = r + dr
        const nc = c + dc
        if (nr >= 0 && nc >= 0 && nr < SIZE && nc < SIZE) result.push(nr * SIZE + nc)
      }
    }
    return result
  }

  function placeMines(safeIndex) {
    const forbidden = new Set([safeIndex, ...neighbors(safeIndex)])
    let placed = 0
    while (placed < MINE_COUNT) {
      const index = Math.floor(Math.random() * SIZE * SIZE)
      if (forbidden.has(index) || cells[index].mine) continue
      cells[index].mine = true
      placed += 1
    }
    cells.forEach((cell, index) => {
      cell.adjacent = neighbors(index).filter((n) => cells[n].mine).length
    })
  }

  function render() {
    gridEl.textContent = ''
    cells.forEach((cell, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cell'
      button.dataset.index = String(index)
      button.setAttribute(
        'aria-label',
        `第 ${Math.floor(index / SIZE) + 1} 行第 ${(index % SIZE) + 1} 列`,
      )
      if (cell.revealed) {
        button.classList.add('revealed')
        if (cell.mine) {
          button.classList.add('mine')
          button.textContent = '✱'
        } else if (cell.adjacent > 0) {
          button.textContent = String(cell.adjacent)
          button.style.color = NUMBER_COLORS[cell.adjacent - 1]
        }
      } else if (cell.flagged) {
        button.classList.add('flag')
        button.textContent = '⚑'
      }
      gridEl.appendChild(button)
    })
    const flags = cells.filter((cell) => cell.flagged).length
    minesEl.textContent = String(MINE_COUNT - flags)
  }

  function reveal(index) {
    const cell = cells[index]
    if (cell.revealed || cell.flagged) return
    cell.revealed = true
    if (cell.mine) return gameOver(false)
    if (cell.adjacent === 0) {
      neighbors(index)
        .filter((n) => !cells[n].mine)
        .forEach((n) => reveal(n))
    }
  }

  function gameOver(won) {
    over = true
    if (!won) {
      cells.forEach((cell) => {
        if (cell.mine) cell.revealed = true
      })
    }
    render()
    window.setTimeout(() => {
      window.alert(won ? '扫雷成功！' : '踩到雷了，再试一次。')
    }, 120)
  }

  function checkWin() {
    const revealedSafe = cells.filter((cell) => cell.revealed && !cell.mine).length
    if (revealedSafe === SIZE * SIZE - MINE_COUNT) gameOver(true)
  }

  function onReveal(event) {
    if (over) return
    const button = event.target.closest('.cell')
    if (!button) return
    const index = Number(button.dataset.index)
    if (!started) {
      started = true
      placeMines(index)
    }
    reveal(index)
    if (!over) {
      render()
      checkWin()
    }
  }

  function onFlag(event) {
    event.preventDefault()
    if (over) return
    const button = event.target.closest('.cell')
    if (!button) return
    const cell = cells[Number(button.dataset.index)]
    if (cell.revealed) return
    cell.flagged = !cell.flagged
    render()
  }

  function newGame() {
    cells = Array.from({ length: SIZE * SIZE }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
    }))
    started = false
    over = false
    render()
  }

  gridEl.addEventListener('click', onReveal)
  gridEl.addEventListener('contextmenu', onFlag)
  document.getElementById('new').addEventListener('click', newGame)
  newGame()
})()

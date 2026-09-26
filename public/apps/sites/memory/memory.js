(() => {
  'use strict'

  const PAIRS = 8
  // 8 对符号：数字 + 专属底色（冷色域）。
  const SYMBOLS = [
    { label: '1', color: '#2f5fe8' },
    { label: '2', color: '#0e7490' },
    { label: '3', color: '#5a3ed0' },
    { label: '4', color: '#0f766e' },
    { label: '5', color: '#4338ca' },
    { label: '6', color: '#0369a1' },
    { label: '7', color: '#7e22ce' },
    { label: '8', color: '#1d43b8' },
  ]

  const gridEl = document.getElementById('grid')
  const movesEl = document.getElementById('moves')
  const pairsEl = document.getElementById('pairs')

  let deck
  let openCards
  let matchedPairs
  let moves
  let lockBoard

  function shuffle(values) {
    const copy = [...values]
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  function render() {
    gridEl.textContent = ''
    deck.forEach((card, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'card'
      button.dataset.index = String(index)
      button.setAttribute('aria-label', `第 ${index + 1} 张卡牌`)
      if (card.state !== 'down') {
        button.classList.add(card.state === 'matched' ? 'done' : 'open')
        button.style.color = card.color
        button.textContent = card.label
      }
      gridEl.appendChild(button)
    })
    movesEl.textContent = String(moves)
    pairsEl.textContent = String(matchedPairs)
  }

  function onCardClick(event) {
    if (lockBoard) return
    const button = event.target.closest('.card')
    if (!button) return
    const index = Number(button.dataset.index)
    const card = deck[index]
    if (card.state !== 'down') return

    card.state = 'open'
    openCards.push(index)
    render()

    if (openCards.length < 2) return
    moves += 1
    const [a, b] = openCards
    const first = deck[a]
    const second = deck[b]
    if (first.label === second.label) {
      first.state = 'matched'
      second.state = 'matched'
      matchedPairs += 1
      openCards = []
      render()
      if (matchedPairs === PAIRS) {
        window.setTimeout(() => window.alert(`全部配对完成 · 共用 ${moves} 步`), 150)
      }
    } else {
      lockBoard = true
      window.setTimeout(() => {
        first.state = 'down'
        second.state = 'down'
        openCards = []
        lockBoard = false
        render()
      }, 750)
    }
  }

  function newGame() {
    deck = shuffle(
      SYMBOLS.flatMap((symbol) => [
        { label: symbol.label, color: symbol.color, state: 'down' },
        { label: symbol.label, color: symbol.color, state: 'down' },
      ]),
    )
    openCards = []
    matchedPairs = 0
    moves = 0
    lockBoard = false
    render()
  }

  gridEl.addEventListener('click', onCardClick)
  document.getElementById('new').addEventListener('click', newGame)
  newGame()
})()

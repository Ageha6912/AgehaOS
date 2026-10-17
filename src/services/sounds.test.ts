import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ATTACK_MS,
  NOISE_FLOOR_GAIN,
  RETRIGGER_COOLDOWN_MS,
  SOUND_SPECS,
  scheduleSound,
  systemSounds,
  type AudioGraph,
  type NoteSpec,
} from './sounds'
import { resetSoundPrefsStore, useSoundPrefsStore } from '@/store/sound-prefs-store'

/** 录制型 Fake 音频图：所有参数化调用按序落账，供包络断言。 */
interface Call {
  op: string
  args: unknown[]
}

function makeFakeGraph(): { graph: AudioGraph; calls: Call[]; stopAt: number[] } {
  const calls: Call[] = []
  const stopAt: number[] = []
  let nodeSeq = 0
  const graph: AudioGraph = {
    currentTime: 1.25,
    destination: { fake: 'destination' },
    createOscillator: () => {
      nodeSeq += 1
      const id = nodeSeq
      return {
        type: 'sine',
        frequency: {
          value: 0,
          setValueAtTime: (value, time) =>
            calls.push({ op: `osc${id}.freq.set`, args: [value, time] }),
          exponentialRampToValueAtTime: (value, time) =>
            calls.push({ op: `osc${id}.freq.expRamp`, args: [value, time] }),
        },
        connect: (target) => calls.push({ op: `osc${id}.connect`, args: [target] }),
        start: (time) => calls.push({ op: `osc${id}.start`, args: [time] }),
        stop: (time) => {
          stopAt.push(time)
          calls.push({ op: `osc${id}.stop`, args: [time] })
        },
      }
    },
    createGain: () => {
      nodeSeq += 1
      const id = nodeSeq
      return {
        connect: (target) => calls.push({ op: `gain${id}.connect`, args: [target] }),
        gain: {
          value: 1,
          setValueAtTime: (value, time) => calls.push({ op: `gain${id}.set`, args: [value, time] }),
          linearRampToValueAtTime: (value, time) =>
            calls.push({ op: `gain${id}.linRamp`, args: [value, time] }),
          exponentialRampToValueAtTime: (value, time) =>
            calls.push({ op: `gain${id}.expRamp`, args: [value, time] }),
        },
      }
    },
  }
  return { graph, calls, stopAt }
}

describe('SOUND_SPECS（音效谱纪律）', () => {
  const NAMES = ['boot', 'notify', 'snap', 'mission-in', 'mission-out'] as const

  it('每条音效至少一音、峰值 ≤0.16、总时长 ≤0.9s、偏移不越过时长', () => {
    for (const name of NAMES) {
      const spec = SOUND_SPECS[name]
      expect(spec.notes.length).toBeGreaterThan(0)
      for (const note of spec.notes) {
        expect(note.gain).toBeLessThanOrEqual(0.16)
        expect(note.gain).toBeGreaterThan(NOISE_FLOOR_GAIN) // 低于门限的音轨没有存在意义
        expect(note.duration).toBeGreaterThan(ATTACK_MS)
        expect(note.at).toBeLessThan(note.duration)
        expect(note.at + note.duration).toBeLessThanOrEqual(900)
        expect(note.freq).toBeGreaterThan(0)
        if (note.endFreq !== undefined) expect(note.endFreq).toBeLessThan(note.freq)
      }
    }
  })
})

describe('scheduleSound（包络调度内核）', () => {
  const NOTE: NoteSpec = { type: 'sine', freq: 659.25, at: 90, duration: 360, gain: 0.12 }

  it('防爆音包络：0 起振 → 5ms 线性爬峰 → 指数衰减 → 归零截停', () => {
    const { graph, calls } = makeFakeGraph()
    expect(scheduleSound({ notes: [NOTE] }, graph)).toBe(1)

    const t0 = 1.25 + 0.09
    const tEnd = t0 + 0.36
    const gainOps = calls.filter((call) => /^gain2\.(set|linRamp|expRamp)/.test(call.op))
    expect(gainOps).toEqual([
      { op: 'gain2.set', args: [0, t0] },
      { op: 'gain2.linRamp', args: [0.12, t0 + ATTACK_MS / 1000] },
      { op: 'gain2.expRamp', args: [0.0001, tEnd] },
      { op: 'gain2.set', args: [0, tEnd] },
    ])
  })

  it('endFreq 扫频与 osc 生命周期（start/stop 在包络端点）', () => {
    const { graph, calls, stopAt } = makeFakeGraph()
    scheduleSound(
      { notes: [{ type: 'triangle', freq: 220, endFreq: 110, at: 0, duration: 110, gain: 0.16 }] },
      graph,
    )
    expect(calls[0]).toEqual({ op: 'osc1.freq.set', args: [220, 1.25] })
    expect(calls[1]).toEqual({ op: 'osc1.freq.expRamp', args: [110, 1.25 + 0.11] })
    expect(stopAt).toEqual([1.25 + 0.11])
  })

  it('低于 8% 底噪门限的音轨整条裁掉', () => {
    const { graph, calls } = makeFakeGraph()
    const scheduled = scheduleSound(
      { notes: [NOTE, { ...NOTE, gain: NOISE_FLOOR_GAIN - 0.001 }] },
      graph,
    )
    expect(scheduled).toBe(1)
    // 只调度了一组 osc（osc1）：被裁的音不创建任何节点。
    expect(calls.some((call) => call.op.startsWith('osc3'))).toBe(false)
  })
})

describe('systemSounds（门控单例）', () => {
  let created = 0
  let suspended = false
  const graphs: Array<{ state: string; resume: () => Promise<void> }> = []

  function makeContextCtor() {
    return class FakeAudioContext {
      state: string
      currentTime = 0
      destination = {}
      resume = vi.fn(async () => {
        this.state = 'running'
      })
      constructor() {
        created += 1
        this.state = suspended ? 'suspended' : 'running'
        graphs.push(this as never)
      }
      createOscillator() {
        return makeFakeGraph().graph.createOscillator()
      }
      createGain() {
        return makeFakeGraph().graph.createGain()
      }
    }
  }

  beforeEach(() => {
    resetSoundPrefsStore()
    systemSounds.reset()
    systemSounds.contextFactory = null
    created = 0
    suspended = false
    graphs.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('偏好关闭：完全不触碰音频环境', () => {
    useSoundPrefsStore.getState().setEnabled(false)
    const spy = vi.fn()
    systemSounds.contextFactory = () => {
      spy()
      return null
    }
    systemSounds.play('notify')
    expect(spy).not.toHaveBeenCalled()
  })

  it('无 AudioContext（jsdom/老浏览器）：静默 no-op 不抛错', () => {
    expect(() => systemSounds.play('snap')).not.toThrow()
    expect(created).toBe(0)
  })

  it('同名音效 60ms 冷却：连发只响第一声，冷却过后恢复', () => {
    vi.useFakeTimers()
    systemSounds.contextFactory = () => new (makeContextCtor())()
    systemSounds.play('notify')
    systemSounds.play('notify')
    expect(created).toBe(1) // 第二声被冷却吞掉（惰性上下文也只建一次）

    vi.advanceTimersByTime(RETRIGGER_COOLDOWN_MS + 1)
    systemSounds.play('notify')
    expect(created).toBe(1)
    vi.useRealTimers()
  })

  it('suspended 上下文（自动播放策略）：只 resume 不调度积压', () => {
    suspended = true
    systemSounds.contextFactory = () => new (makeContextCtor())()
    systemSounds.play('boot')
    expect(created).toBe(1)
    expect(graphs[0]?.resume).toHaveBeenCalled()
  })

  it('不同音效互不冷却：boot 与 notify 背靠背都响', () => {
    systemSounds.contextFactory = () => new (makeContextCtor())()
    systemSounds.play('boot')
    systemSounds.play('notify')
    expect(created).toBe(1)
    expect(graphs[0]?.state).toBe('running')
  })
})

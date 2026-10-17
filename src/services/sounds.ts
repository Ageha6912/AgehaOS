import { useSoundPrefsStore } from '@/store/sound-prefs-store'

/**
 * 系统音效（open-claude-ui 的「Web Audio 振荡器合成 + 8% 底噪门限」算法在
 * AgehaOS 的落地）：零音频资产——全部现场合成，短 sine/triangle 音 + 防爆
 * 音包络（从 0 起振、指数衰减到 -80dB 再归零截停）。
 *
 * 纪律：
 * - 峰值增益 ≤0.16、总时长 ≤0.9s——存在感但不打扰（「清新多巴胺」的听觉档）；
 * - **8% 底噪门限**：峰值低于它的音轨整条裁掉——意图不明的小音量只会被
 *   听成底噪；
 * - 同名音效 60ms 冷却：通知连发不得叠成噪声；
 * - 无 AudioContext（jsdom / 老浏览器）一律静默 no-op，绝不抛错阻塞调用方
 *   （AI 铁律同款：任何环节失败不阻塞桌面）；
 * - AudioContext 惰性创建 + suspended 即 resume（浏览器自动播放策略：首次
 *   触发点都在用户手势路径上）。
 */

export type SystemSound = 'boot' | 'notify' | 'snap' | 'mission-in' | 'mission-out'

/** 8% 底噪门限：峰值增益低于此值的音轨不渲染。 */
export const NOISE_FLOOR_GAIN = 0.08

/** 同名音效最小重触发间隔（ms）。 */
export const RETRIGGER_COOLDOWN_MS = 60

/** 起振爬升时长（ms）：5ms 内从 0 线性到峰值，消除「啪」的起振爆音。 */
export const ATTACK_MS = 5

/** 衰减尾目标（≈-80dB）：exponentialRamp 不允许到 0，用近零值 + 终点归零。 */
const DECAY_TAIL_GAIN = 0.0001

export interface NoteSpec {
  type: 'sine' | 'triangle'
  /** 起始频率 Hz（endFreq 给出时线性段后扫频到它——snap 的「叩击」感）。 */
  freq: number
  endFreq?: number
  /** 相对音效起点的偏移 ms。 */
  at: number
  /** 本音时长 ms（含 5ms 起振与衰减尾）。 */
  duration: number
  /** 峰值增益 0-1。 */
  gain: number
}

export interface SoundSpec {
  notes: NoteSpec[]
}

/**
 * 音效谱（听感设计：明亮柔和的大调短句，贴合「清新多巴胺」视觉档）。
 * boot=A 大调三音上行（苏醒）; notify=E5→A5 双音（清脆 ding）;
 * snap=低频下扫（软叩击）; mission=纯四度上行/下行（空间开合）。
 */
export const SOUND_SPECS: Record<SystemSound, SoundSpec> = {
  boot: {
    notes: [
      { type: 'sine', freq: 440, at: 0, duration: 520, gain: 0.1 },
      { type: 'sine', freq: 554.37, at: 120, duration: 520, gain: 0.11 },
      { type: 'sine', freq: 659.25, at: 240, duration: 640, gain: 0.12 },
    ],
  },
  notify: {
    notes: [
      { type: 'sine', freq: 659.25, at: 0, duration: 360, gain: 0.12 },
      { type: 'sine', freq: 880, at: 90, duration: 420, gain: 0.1 },
    ],
  },
  snap: {
    notes: [{ type: 'triangle', freq: 220, endFreq: 110, at: 0, duration: 110, gain: 0.16 }],
  },
  'mission-in': {
    notes: [
      { type: 'sine', freq: 392, at: 0, duration: 340, gain: 0.1 },
      { type: 'sine', freq: 523.25, at: 100, duration: 460, gain: 0.12 },
    ],
  },
  'mission-out': {
    notes: [
      { type: 'sine', freq: 523.25, at: 0, duration: 340, gain: 0.1 },
      { type: 'sine', freq: 392, at: 100, duration: 460, gain: 0.1 },
    ],
  },
}

/** 最小音频图接口：浏览器用 AudioContext，测试注入 FakeAudioGraph。 */
export interface AudioGraph {
  readonly currentTime: number
  readonly destination: unknown
  createOscillator(): {
    type: OscillatorType
    frequency: {
      value: number
      setValueAtTime(value: number, time: number): unknown
      exponentialRampToValueAtTime(value: number, time: number): unknown
    }
    connect(target: unknown): unknown
    start(time: number): unknown
    stop(time: number): unknown
  }
  createGain(): {
    connect(target: unknown): unknown
    gain: {
      value: number
      setValueAtTime(value: number, time: number): unknown
      linearRampToValueAtTime(value: number, time: number): unknown
      exponentialRampToValueAtTime(value: number, time: number): unknown
    }
  }
}

/**
 * 把一条音效谱调度到音频图上（纯调度，不碰全局状态——测试直接断言包络）。
 * 底噪门限过滤发生在音符级：整条 gain < NOISE_FLOOR_GAIN 的音跳过。
 */
export function scheduleSound(spec: SoundSpec, graph: AudioGraph): number {
  let scheduled = 0
  for (const note of spec.notes) {
    if (note.gain < NOISE_FLOOR_GAIN) continue
    const t0 = graph.currentTime + note.at / 1000
    const tEnd = t0 + note.duration / 1000
    const tAttack = t0 + ATTACK_MS / 1000

    const osc = graph.createOscillator()
    osc.type = note.type
    osc.frequency.setValueAtTime(note.freq, t0)
    if (note.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(note.endFreq, tEnd)
    }

    const amp = graph.createGain()
    // 防爆音三段包络：0 起振 → 5ms 线性爬到峰值 → 指数衰减到 -80dB → 归零截停。
    amp.gain.setValueAtTime(0, t0)
    amp.gain.linearRampToValueAtTime(note.gain, tAttack)
    amp.gain.exponentialRampToValueAtTime(DECAY_TAIL_GAIN, tEnd)
    amp.gain.setValueAtTime(0, tEnd)

    osc.connect(amp)
    amp.connect(graph.destination)
    osc.start(t0)
    osc.stop(tEnd)
    scheduled += 1
  }
  return scheduled
}

function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return ctor ?? null
}

class SystemSounds {
  private context: AudioGraph | null = null
  private readonly lastPlayedAt = new Map<SystemSound, number>()

  /** 测试注入出口：替换音频图工厂（缺省用真实 AudioContext）。 */
  contextFactory: (() => AudioGraph | null) | null = null

  play(name: SystemSound): void {
    try {
      this.playInner(name)
    } catch {
      /* 音频环境异常（未授权/驱动故障）：静默——音效永不阻塞桌面 */
    }
  }

  private playInner(name: SystemSound): void {
    if (!useSoundPrefsStore.getState().enabled) return
    const now = Date.now()
    const last = this.lastPlayedAt.get(name)
    if (last !== undefined && now - last < RETRIGGER_COOLDOWN_MS) return
    this.lastPlayedAt.set(name, now)

    const context = this.ensureContext()
    if (context === null) return
    if (this.isSuspended(context)) {
      void this.resume(context)
      return // 等下一声再试：suspended 图上调度的事件会积压到 resume 后齐响
    }
    scheduleSound(SOUND_SPECS[name], context)
  }

  private ensureContext(): AudioGraph | null {
    if (this.context !== null) return this.context
    if (this.contextFactory !== null) {
      this.context = this.contextFactory()
    } else {
      // class 构造器必须 new 调用（直调抛 TypeError——会被 play 静默吞掉，
      // 表现为「音效永不发声」，测试钉扎过这个坑）。
      const ctor = resolveAudioContextCtor()
      this.context = ctor !== null ? new ctor() : null
    }
    return this.context
  }

  private isSuspended(context: AudioGraph): boolean {
    return (context as { state?: string }).state === 'suspended'
  }

  private resume(context: AudioGraph): Promise<void> {
    const resume = (context as { resume?: () => Promise<void> }).resume
    return resume?.call(context) ?? Promise.resolve()
  }

  /** 测试隔离出口。 */
  reset(): void {
    this.context = null
    this.lastPlayedAt.clear()
  }
}

export const systemSounds = new SystemSounds()

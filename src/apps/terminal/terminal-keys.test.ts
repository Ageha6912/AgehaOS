import { describe, expect, it } from 'vitest'

import { TERMINAL_COMMANDS } from '@/core/terminal/shell'

import { completeCommandLine, sequenceAction, TERMINAL_KEY_ROW, TERMINAL_KEY_SEQUENCES } from './terminal-keys'

describe('TERMINAL_KEY_SEQUENCES（M4-4 键 → 控制序列 wire 契约）', () => {
  it('Esc/Tab/Ctrl+C/↑/↓ → ESC / HT / ETX / CSI A / CSI B', () => {
    expect(TERMINAL_KEY_SEQUENCES.esc).toBe('\x1b')
    expect(TERMINAL_KEY_SEQUENCES.tab).toBe('\t')
    expect(TERMINAL_KEY_SEQUENCES['ctrl-c']).toBe('\x03')
    expect(TERMINAL_KEY_SEQUENCES['arrow-up']).toBe('\x1b[A')
    expect(TERMINAL_KEY_SEQUENCES['arrow-down']).toBe('\x1b[B')
  })

  it('码位钉扎：0x1B / 0x09 / 0x03 / CSI A / CSI B（防不可见字符被顺手改错）', () => {
    expect(TERMINAL_KEY_SEQUENCES.esc).toHaveLength(1)
    expect(TERMINAL_KEY_SEQUENCES.esc.codePointAt(0)).toBe(0x1b)
    expect(TERMINAL_KEY_SEQUENCES.tab).toHaveLength(1)
    expect(TERMINAL_KEY_SEQUENCES.tab.codePointAt(0)).toBe(0x09)
    expect(TERMINAL_KEY_SEQUENCES['ctrl-c']).toHaveLength(1)
    expect(TERMINAL_KEY_SEQUENCES['ctrl-c'].codePointAt(0)).toBe(0x03)
    expect([...TERMINAL_KEY_SEQUENCES['arrow-up']]).toEqual(['\x1b', '[', 'A'])
    expect([...TERMINAL_KEY_SEQUENCES['arrow-down']]).toEqual(['\x1b', '[', 'B'])
  })

  it('键帽行排列序 = Esc / Tab / Ctrl+C / ↑ / ↓，且每个键都有非空序列', () => {
    expect(TERMINAL_KEY_ROW.map((key) => key.id)).toEqual([
      'esc',
      'tab',
      'ctrl-c',
      'arrow-up',
      'arrow-down',
    ])
    for (const key of TERMINAL_KEY_ROW) {
      expect(TERMINAL_KEY_SEQUENCES[key.id].length).toBeGreaterThan(0)
      expect(key.cap.length).toBeGreaterThan(0)
    }
  })
})

describe('sequenceAction（序列 → 会话动作解码）', () => {
  it('与编码映射互逆：每个键的序列解码回原键', () => {
    for (const [key, sequence] of Object.entries(TERMINAL_KEY_SEQUENCES)) {
      expect(sequenceAction(sequence)).toBe(key)
    }
  })

  it('未知序列回 null 绝不抛错', () => {
    expect(sequenceAction('')).toBeNull()
    expect(sequenceAction('x')).toBeNull()
    expect(sequenceAction('\x1b[Z')).toBeNull()
  })
})

describe('completeCommandLine（Tab 命令名补全）', () => {
  it('唯一前缀命中 → 命令名 + 尾随空格', () => {
    expect(completeCommandLine('ec', TERMINAL_COMMANDS)).toBe('echo ')
    expect(completeCommandLine('cl', TERMINAL_COMMANDS)).toBe('clear ')
    expect(completeCommandLine('ca', TERMINAL_COMMANDS)).toBe('cat ')
  })

  it('已完整输入唯一命中 → 仍补尾随空格（bash 同款，补完即可接参数）', () => {
    expect(completeCommandLine('echo', TERMINAL_COMMANDS)).toBe('echo ')
  })

  it('多命中补到公共前缀；无进展（不长于现输入）回 null', () => {
    // cd / cat / clear 公共前缀就是「c」——无进展。
    expect(completeCommandLine('c', TERMINAL_COMMANDS)).toBeNull()
    expect(completeCommandLine('a', ['abc', 'abd'])).toBe('ab')
    expect(completeCommandLine('ab', ['abc', 'abd'])).toBeNull()
  })

  it('无命中 / 带参数（路径不猜）/ 空输入 → null', () => {
    expect(completeCommandLine('zz', TERMINAL_COMMANDS)).toBeNull()
    expect(completeCommandLine('ec foo', TERMINAL_COMMANDS)).toBeNull()
    expect(completeCommandLine('', TERMINAL_COMMANDS)).toBeNull()
  })
})

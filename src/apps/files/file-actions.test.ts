import { describe, expect, it } from 'vitest'

import { fileRowActions } from './file-actions'

/** 行操作单动作分发契约（M3-6）：动作子集 = 桌面 Files 逐行真实可用操作。 */
describe('fileRowActions', () => {
  it('浏览视图：普通条目 = 打开 / 重命名 / 删除', () => {
    expect(fileRowActions('browse', { parentId: 'parent' })).toEqual(['open', 'rename', 'delete'])
  })

  it('浏览视图：根级条目（parentId null）不摆删除——根级系统目录受保护', () => {
    expect(fileRowActions('browse', { parentId: null })).toEqual(['open', 'rename'])
  })

  it('回收站视图：只有还原 / 彻底删除（打开在回收站不可用）', () => {
    expect(fileRowActions('trash', { parentId: 'parent' })).toEqual(['restore', 'purge'])
    expect(fileRowActions('trash', { parentId: null })).toEqual(['restore', 'purge'])
  })
})

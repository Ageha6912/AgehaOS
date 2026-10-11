import type { VfsNode } from '@/core/filesystem'

/**
 * Files 行操作单的动作分发纯函数（M3-6 Files 长按操作单，HANDOFF §4.0-7
 * 「Files 右键操作等价入口」）：桌面 Files 没有逐行右键菜单（全仓唯一
 * ContextMenu 是桌面画布的 壁纸/商店/设置，src/desktop/ContextMenu.tsx），
 * 逐行的真实可用操作 = 桌面 Files 既有交互面——单击选中后工具栏的
 * 重命名/删除（回收站视图：还原/彻底删除）+ 双击打开。本函数把「该行在
 * 当前视图下摆哪些动作」钉成纯函数（可单测），组件侧零内联判定；动作的
 * 执行全部走 Files 既有逻辑（FileManager 的 openEntry/PromptDialog 重命名/
 * 删除/还原/彻底删除），不新增业务。
 */

/** 文件条目（自 FileManager 上收共享：node + 展示用完整路径）。 */
export interface FileEntry {
  node: VfsNode
  path: string
}

export type FileRowAction = 'open' | 'rename' | 'delete' | 'restore' | 'purge'

/** 浏览视图（正常目录/搜索）或回收站视图。 */
export type FileBrowseMode = 'browse' | 'trash'

/**
 * 某行在当前视图下的动作子集（呈现序即此序）：
 * - 回收站：还原 / 彻底删除（工具栏同款；打开在回收站不可用——
 *   FileManager.openEntry 对 trashMode 直接返回）。
 * - 浏览：打开 / 重命名 / 删除；**根级条目不摆删除**（parentId === null 的
 *   根级系统目录受保护——vfs root-protected，工具栏删除钮对它同样禁用）。
 */
export function fileRowActions(mode: FileBrowseMode, node: Pick<VfsNode, 'parentId'>): FileRowAction[] {
  if (mode === 'trash') return ['restore', 'purge']
  const actions: FileRowAction[] = ['open', 'rename']
  if (node.parentId !== null) actions.push('delete')
  return actions
}

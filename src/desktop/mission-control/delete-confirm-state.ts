/**
 * MC 迁移删除确认弹层的开启态镜像（W7 复核 low 备忘的落点）：弹层开关
 * （deleteCandidateId）是 MissionControl 组件 useState，而 use-global-shortcuts
 * 的 MC Esc 条目要在组件树外实时读「确认弹层未开启」让位——由 MissionControl
 * 的 effect 依 useState 同步本镜像，卸载/关闭路径一律复位 false。
 * （独立模块：react-refresh/only-export-components 禁止组件文件混出函数。）
 */

let deleteConfirmOpen = false

/** 确认弹层是否开启（registry MC Esc 条目的 when 消费；组件外可读）。 */
export function isDeleteConfirmOpen(): boolean {
  return deleteConfirmOpen
}

export function setDeleteConfirmOpen(open: boolean): void {
  deleteConfirmOpen = open
}

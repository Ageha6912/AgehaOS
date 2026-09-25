import type { SdkFilePort } from '@/core/apps/sdk-bridge'
import { systemVfs } from './vfs'

/**
 * SDK File API 端口（PRD §17）：把 systemVfs 的 Promise 接口适配成 sdk-bridge
 * 的注入式 `SdkFilePort`。路径钳制已在桥内完成——这里只做无假设的直通转发；
 * VfsError 原样上抛（code 由桥映射成 sdk 错误字符串）。
 */
export const sdkFilePort: SdkFilePort = {
  async readFile(path) {
    return systemVfs.readFile(path)
  },

  async writeFile(path, content) {
    await systemVfs.writeFile(path, content)
  },

  async listDir(path) {
    const children = await systemVfs.list(path)
    return children.map((node) => ({ name: node.name, type: node.type }))
  },

  async createDirectory(path) {
    await systemVfs.createDirectory(path)
  },

  async remove(path) {
    // 与宿主文件管理器一致的回收站语义：SDK 删除可恢复，路径即刻释放。
    const trashed = await systemVfs.remove(path)
    void trashed
  },
}

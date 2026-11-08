import type { FastifyInstance } from 'fastify'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface OriginCheckOptions {
  allowedOrigins?: readonly string[]
  /** allowlist 项无法解析为 origin 时回调（宿主可打 warn 日志）。 */
  onInvalidOrigin?: (item: string) => void
}

/**
 * CSRF defense in depth (PRD §30.4): browsers always send `Origin` on
 * mutating requests, so any present-but-foreign origin is rejected. Requests
 * without an Origin header (curl, server-to-server) pass — the cookie's
 * SameSite=Lax remains the primary guard. Same-host origins and the
 * configured allowlist are accepted.
 *
 * 路由级豁免（config.skipOriginCheck）：浏览器代理的沙箱 iframe（不透明
 * origin）提交表单时 Origin 序列化为 `null`——无法解析会被本钩子判为敌意。
 * 豁免只对显式声明的路由生效；这些路由仍受会话门 + SameSite=Lax 双保（跨站
 * POST 不带会话 cookie，拿不到放行资格）。
 */
export async function originCheck(
  app: FastifyInstance,
  options: OriginCheckOptions = {},
): Promise<void> {
  // 配置归一化（A1 审查轻微项）：`https://os.ageha.cn/`（尾斜杠）、
  // `HTTPS://OS.AGEHA.CN`（大小写）这类人写的配置逐字节比对会让合法请求
  // 403。加载时统一折叠成 `new URL(item).origin`；非法项跳过（fail-closed）
  // 并可观测（宿主传入 logger 时打 warn）。
  const allowed = new Set<string>()
  for (const item of options.allowedOrigins ?? []) {
    try {
      allowed.add(new URL(item).origin)
    } catch {
      options.onInvalidOrigin?.(item)
    }
  }
  app.addHook('onRequest', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return
    const config = (request.routeOptions?.config ?? {}) as { skipOriginCheck?: boolean }
    if (config.skipOriginCheck === true) return
    const origin = request.headers.origin
    if (!origin) return
    const host = request.headers.host
    let originHost: string | null
    try {
      originHost = new URL(origin).host
    } catch {
      // Malformed Origin header: treat as foreign.
      return await reply.code(403).send({ error: 'forbidden' })
    }
    let originNormalized: string
    try {
      originNormalized = new URL(origin).origin
    } catch {
      return await reply.code(403).send({ error: 'forbidden' })
    }
    if ((host !== undefined && originHost === host) || allowed.has(originNormalized)) return
    await reply.code(403).send({ error: 'forbidden' })
  })
}

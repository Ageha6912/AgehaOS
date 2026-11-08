import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../src/app'
import { RedisRateLimitStore } from '../src/rate-limit-redis'
import type { RedisLike } from '../src/rate-limit-redis'

/**
 * Redis 限流（多实例共享计数）：注入同一 fake Redis 的两个 app 实例必须
 * 共享限流窗口——实例 A 耗尽额度后，实例 B 也要 429。这正是「多实例部署
 * 内存版限流形同虚设」的修复验证（HANDOFF §6 环境欠账）。
 */

/** Map 版 fake Redis：INCR / EXPIRE / TTL 语义齐全（测试内确定性）。 */
function fakeRedis(): RedisLike & { store: Map<string, { value: number; expireAt: number }> } {
  const store = new Map<string, { value: number; expireAt: number }>()
  return {
    store,
    async incr(key: string) {
      const now = Date.now()
      const entry = store.get(key)
      if (!entry || entry.expireAt <= now) {
        store.set(key, { value: 1, expireAt: now + 60_000 })
        return 1
      }
      entry.value += 1
      return entry.value
    },
    async expire(key: string, seconds: number) {
      const entry = store.get(key)
      if (entry) entry.expireAt = Date.now() + seconds * 1000
      return entry ? 1 : 0
    },
    async ttl(key: string) {
      const entry = store.get(key)
      if (!entry) return -2
      return Math.max(0, Math.ceil((entry.expireAt - Date.now()) / 1000))
    },
  }
}

let redis: ReturnType<typeof fakeRedis>
let appA: FastifyInstance
let appB: FastifyInstance

async function buildWithSharedRedis(): Promise<FastifyInstance> {
  const app = await buildApp({
    redis,
    config: { store: 'memory', rateLimit: { loginMax: 3, registerMax: 20, windowMs: 60_000 } },
  })
  await app.ready()
  return app
}

const login = (app: FastifyInstance) =>
  app
    .inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ghost', password: 'wrong-pass' } })
    .then((res) => res.statusCode)

beforeEach(async () => {
  redis = fakeRedis()
  appA = await buildWithSharedRedis()
  appB = await buildWithSharedRedis()
})

afterAll(async () => {
  await Promise.allSettled([appA.close(), appB.close()])
})

describe('Redis 共享限流（多实例，ADR 21 附注）', () => {
  it('counts attempts across both instances and 429s the 4th anywhere', async () => {
    const statuses: number[] = []
    statuses.push(await login(appA))
    statuses.push(await login(appB))
    statuses.push(await login(appA))
    statuses.push(await login(appB))

    expect(statuses.slice(0, 3)).toEqual([401, 401, 401])
    expect(statuses[3]).toBe(429)
    // 计数落在共享 Redis 里且带 ageha 前缀
    const keys = [...redis.store.keys()]
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => key.startsWith('ageha:rl:'))).toBe(true)
  })

  it('keeps different routes in separate buckets', async () => {
    expect(await login(appA)).toBe(401)
    expect(await login(appB)).toBe(401)
    expect(await login(appA)).toBe(401)
    expect(await login(appB)).toBe(429)

    // 注册是另一路由桶：不受登录桶打满影响
    const register = await appA.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'rl-user', password: 'secret123' },
    })
    expect(register.statusCode).not.toBe(429)
  })

  it('fails open when Redis errors (可用性优先)', async () => {
    const broken: RedisLike = {
      incr: async () => {
        throw new Error('redis down')
      },
      expire: async () => 0,
      ttl: async () => -2,
    }
    const app = await buildApp({
      redis: broken,
      config: { store: 'memory', rateLimit: { loginMax: 1, registerMax: 20, windowMs: 60_000 } },
    })
    await app.ready()

    // Redis 挂了：放行（401 = 到达认证逻辑），而不是 500/429
    const status = await app
      .inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ghost', password: 'wrong-pass' } })
      .then((res) => res.statusCode)
    expect(status).toBe(401)
    await app.close()
  })

  it('注入的 Redis 客户端在 app.close() 后不被 quit（A1 审查轻微项）', async () => {
    const quit = vi.fn(async () => undefined)
    const owned: RedisLike & { quit: () => Promise<void> } = { ...fakeRedis(), quit }
    const app = await buildApp({
      redis: owned,
      config: { store: 'memory', rateLimit: { loginMax: 3, registerMax: 20, windowMs: 60_000 } },
    })
    await app.ready()
    await app.close()
    // 注入的客户端归调用方管理（本文件多个 app 共用一个 fake）。
    expect(quit).not.toHaveBeenCalled()
  })

  it('repairs a lost TTL instead of leaving a permanently blocked counter', async () => {
    const expireCalls: Array<{ key: string; seconds: number }> = []
    const lostTtlRedis: RedisLike = {
      // 非首次 INCR（current !== 1），且 TTL 已丢失（ttl = -1）。
      incr: async () => 4,
      expire: async (key, seconds) => {
        expireCalls.push({ key, seconds })
        return 1
      },
      ttl: async () => -1,
    }
    const store = new RedisRateLimitStore(lostTtlRedis, {} as never)
    const result = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr('route-ip', (error, value) => (error ? reject(error) : resolve(value!)), 60_000)
    })

    expect(result).toEqual({ current: 4, ttl: 60 })
    // EXPIRE 必须补回，否则该 route-ip 组合会永久 429。
    expect(expireCalls).toEqual([{ key: 'ageha:rl:route-ip', seconds: 60 }])
  })
})

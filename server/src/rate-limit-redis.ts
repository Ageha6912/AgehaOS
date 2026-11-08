import type { FastifyRateLimitOptions, FastifyRateLimitStore } from '@fastify/rate-limit'

/**
 * Redis 限流 store（ADR 21 附注；多实例部署的共享计数，2026-09-28）。
 *
 * `@fastify/rate-limit` 默认是实例内存版——多实例部署时各数各的，限流形同虚设。
 * 本 store 用 INCR + EXPIRE 实现固定窗口共享计数：setAgehaRedisUrl 生效时由
 * app.ts 接管，未设置时保持内存版（零依赖，动态 import ioredis）。
 *
 * 失败语义：Redis 不可达时 **fail-open**（放行 + 记错误）——限流的目的是保护
 * 而非拒绝服务，存储故障不应打挂登录。窗口 = 固定窗口（首个 INCR 设 EXPIRE）。
 */

/** 最小 Redis 命令面（ioredis 兼容子集），便于测试注入。 */
export interface RedisLike {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  ttl(key: string): Promise<number>
}

const KEY_PREFIX = 'ageha:rl:'

export class RedisRateLimitStore implements FastifyRateLimitStore {
  private readonly prefix: string
  /** fail-open 观测口（测试/运维用）。 */
  public lastError: Error | null = null

  constructor(
    private readonly redis: RedisLike,
    options: FastifyRateLimitOptions,
    prefix = KEY_PREFIX,
  ) {
    this.prefix = prefix
    void options
  }

  child(routeOptions: { path: string; prefix: string }): FastifyRateLimitStore {
    // 插件传入的 key 已含路由维度（routeId-ip），共享计数即可；child 返回自身。
    void routeOptions
    return this
  }

  incr(
    key: string,
    callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    timeWindow: number,
  ): void {
    const windowSeconds = Math.max(1, Math.ceil(timeWindow / 1000))
    const namespaced = `${this.prefix}${key}`
    void (async () => {
      try {
        const current = await this.redis.incr(namespaced)
        if (current === 1) {
          await this.redis.expire(namespaced, windowSeconds)
        }
        let ttl = await this.redis.ttl(namespaced)
        if (ttl < 0) {
          // EXPIRE 丢失 / 进程在 INCR 与 EXPIRE 之间中断：立即补 TTL。
          // 否则计数键无过期时间，越过 max 后该 route-ip 组合会被永久限流。
          await this.redis.expire(namespaced, windowSeconds)
          ttl = windowSeconds
        }
        this.lastError = null
        callback(null, { current, ttl })
      } catch (error) {
        // fail-open：存储故障放行（按未限流的第一次计），错误留观
        this.lastError = error instanceof Error ? error : new Error(String(error))
        callback(null, { current: 1, ttl: windowSeconds })
      }
    })()
  }
}

/** 工厂：返回插件要求的构造器形态（new Ctor(options)）。 */
export function redisRateLimitStoreCtor(redis: RedisLike, prefix = KEY_PREFIX) {
  return class extends RedisRateLimitStore {
    constructor(options: FastifyRateLimitOptions) {
      super(redis, options, prefix)
    }
  }
}

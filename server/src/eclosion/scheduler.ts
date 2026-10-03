import type { EclosionConfig } from '../config'
import type { DataStore } from '../store/types'
import { utcDayKey } from './quota'
import type { TrendingService } from './trending'
import { ensureWorldForDay, worldGlobalKey, parseStoredWorld } from './world'

/**
 * 今日世界定时生成（AI-GENERATED-APPS-DESIGN §9.2 触发表第一行）：服务启动
 * 检查一次；之后每 interval（默认 10 分钟，AGEHA_ECLOSION_WORLD_SCHEDULER_
 * INTERVAL_MS）查 UTC 日，跨日即生成新一日世界。当日缺失由首个 GET /world
 * 懒触发兜底——两条路径共用 ensureWorldForDay 的 DataStore 单飞锁，多实例
 * 部署不会重复生成。
 *
 * 定时器 unref（不阻塞进程退出）；app.ts 在 onClose 里 stop()。服务端首个
 * 进程内定时器先例：配置可关（AGEHA_ECLOSION_WORLD_SCHEDULER=0）。
 */

export interface SchedulerLogger {
  info(fields: object, message?: string): void
  warn(fields: object, message?: string): void
}

export interface WorldSchedulerHandle {
  /** 立即执行一次跨日检查（启动检查/测试入口）。 */
  checkNow(): Promise<void>
  /** 停止定时器（app onClose）。 */
  stop(): void
}

export function startWorldScheduler(params: {
  store: DataStore
  eclosion: EclosionConfig
  trending: TrendingService
  fetcher?: typeof fetch
  logger: SchedulerLogger
  intervalMs: number
  pollMs?: number
  now?: () => Date
}): WorldSchedulerHandle {
  const { store, eclosion, trending, logger } = params
  const fetcher = params.fetcher ?? fetch
  const now = params.now ?? ((): Date => new Date())

  const checkNow = async (): Promise<void> => {
    // 未配置 Key：无事可做（懒触发路径会回 503，L1 走原生）。
    if (!eclosion.apiKey) return
    const day = utcDayKey(now())
    const cached = await store.getEclosionCache(worldGlobalKey(day))
    if (cached !== null && parseStoredWorld(cached, day) !== null) return
    const result = await ensureWorldForDay({
      store,
      eclosion,
      trending,
      fetcher,
      day,
      pollMs: params.pollMs,
      now,
    })
    if (result.outcome === 'failed') {
      logger.warn(
        { audit: 'eclosion.world', day, code: result.code },
        'world scheduler generation failed',
      )
      return
    }
    logger.info(
      {
        audit: 'eclosion.world',
        day,
        outcome: result.outcome,
        ...(result.outcome === 'generated' ? { tokens: result.tokens } : {}),
      },
      'world scheduler ensured daily world',
    )
  }

  // 启动检查一次（不阻塞启动：失败只记日志）。
  void checkNow().catch((cause: unknown) => {
    logger.warn(
      { audit: 'eclosion.world', detail: cause instanceof Error ? cause.message : String(cause) },
      'world scheduler boot check crashed',
    )
  })

  const timer = setInterval(() => {
    void checkNow().catch((cause: unknown) => {
      logger.warn(
        { audit: 'eclosion.world', detail: cause instanceof Error ? cause.message : String(cause) },
        'world scheduler tick crashed',
      )
    })
  }, params.intervalMs)
  timer.unref?.()

  return {
    checkNow,
    stop(): void {
      clearInterval(timer)
    },
  }
}

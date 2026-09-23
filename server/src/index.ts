import { buildApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()

async function main(): Promise<void> {
  const app = await buildApp({ config, logger: { level: config.logLevel } })
  await app.listen({ port: config.port, host: config.host })
  app.log.info(
    { store: config.store, ttlMs: config.sessionTtlMs },
    `AgehaOS auth API listening on http://${config.host}:${config.port}`,
  )

  const stop = (): void => {
    void app.close().then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((error) => {
  console.error('[agehaos-server] failed to start', error)
  process.exit(1)
})

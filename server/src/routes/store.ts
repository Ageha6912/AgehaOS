import type { FastifyInstance } from 'fastify'

import { canonicalJson, REMOTE_CATALOG_APPS, validateCatalogApps } from '../remote-catalog'
import type { RemoteCatalogApp, RemoteCatalogPayload } from '../remote-catalog'
import { signPayload } from '../store-keys'
import type { CatalogSigningKey } from '../store-keys'
import type { DataStore } from '../store/types'
import { requireAdmin } from './require-admin'

export interface StoreRoutesOptions {
  signingKey: CatalogSigningKey
  store: DataStore
  /** 测试/部署覆盖目录内容；缺省为内置远程样例。 */
  apps?: readonly RemoteCatalogApp[]
}

const CATALOG_BODY_SCHEMA = {
  type: 'object',
  required: ['apps'],
  additionalProperties: false,
  properties: {
    apps: { type: 'array', maxItems: 50, items: { type: 'object' } },
  },
}

/**
 * 远端应用目录（PRD §47 前置切片 + ADR 20 管理员发布）：
 * - `GET /store/catalog`（公开）：返回 Ed25519 签名目录；管理员发布过的目录
 *   优先，否则回落内置样例。
 * - `GET/PUT /store/admin/catalog`（仅 role=admin）：查看/发布目录。发布经
 *   白名单深度校验（entry 必须落在 /apps/sites/ 同源 allowlist 内）。
 */
export async function storeRoutes(app: FastifyInstance, options: StoreRoutesOptions): Promise<void> {
  const { signingKey, store } = options
  const builtinApps = options.apps ?? REMOTE_CATALOG_APPS

  const effectiveApps = async (): Promise<readonly RemoteCatalogApp[]> => {
    const stored = await store.getAppCatalog()
    if (!stored) return builtinApps
    try {
      const parsed = JSON.parse(stored) as RemoteCatalogApp[]
      return Array.isArray(parsed) ? parsed : builtinApps
    } catch {
      return builtinApps
    }
  }

  app.get('/store/catalog', async () => {
    const payload: RemoteCatalogPayload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      apps: await effectiveApps(),
    }
    const signature = signPayload(signingKey.privateKey, canonicalJson(payload))
    return {
      keyId: signingKey.keyId,
      algorithm: 'ed25519',
      publicKey: signingKey.publicKeyBase64,
      payload,
      signature,
    }
  })

  app.get('/store/admin/catalog', async (request, reply) => {
    if (!(await requireAdmin(store, request, reply))) return reply
    return reply.code(200).send({ apps: await effectiveApps() })
  })

  app.put(
    '/store/admin/catalog',
    { schema: { body: CATALOG_BODY_SCHEMA } },
    async (request, reply) => {
      if (!(await requireAdmin(store, request, reply))) return reply
      const { apps } = request.body as { apps: unknown }
      const validated = validateCatalogApps(apps)
      if (!validated) {
        return reply.code(400).send({ error: 'invalid-catalog' })
      }
      await store.putAppCatalog(JSON.stringify(validated))
      app.log.info(
        { audit: 'store.catalog.publish', count: validated.length },
        'remote catalog published',
      )
      return reply.code(200).send({ ok: true, apps: validated })
    },
  )
}

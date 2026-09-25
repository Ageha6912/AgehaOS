import type { FastifyInstance } from 'fastify'

import { canonicalJson, REMOTE_CATALOG_APPS } from '../remote-catalog'
import type { RemoteCatalogApp, RemoteCatalogPayload } from '../remote-catalog'
import { signPayload } from '../store-keys'
import type { CatalogSigningKey } from '../store-keys'

export interface StoreRoutesOptions {
  signingKey: CatalogSigningKey
  /** 测试/部署覆盖目录内容；缺省为内置远程样例。 */
  apps?: readonly RemoteCatalogApp[]
}

/**
 * 远端应用目录（PRD §47 前置切片，ADR 18）：公开只读。响应携带 Ed25519 公钥、
 * keyId 与对规范化载荷的签名；客户端用钉扎公钥（生产）或下发公钥（开发）验签。
 */
export async function storeRoutes(app: FastifyInstance, options: StoreRoutesOptions): Promise<void> {
  const { signingKey } = options
  const apps = options.apps ?? REMOTE_CATALOG_APPS

  app.get('/store/catalog', async () => {
    const payload: RemoteCatalogPayload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      apps,
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
}

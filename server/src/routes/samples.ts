import { randomUUID } from 'node:crypto'

import type { FastifyInstance } from 'fastify'

import { classifyContentText } from '../classifier'
import type { ContentSampleRecord, DataStore } from '../store/types'
import { requireAdmin } from './require-admin'

export const SAMPLE_TEXT_MAX_LENGTH = 512
/** 羽化举报附带的生成内容摘要上限（HTML 前 2KB，§10）。 */
export const SAMPLE_DETAIL_MAX_LENGTH = 2048
/** 复审清单分页（D2 审查）：默认一页 50，单页上限 200。 */
export const SAMPLE_LIST_DEFAULT_LIMIT = 50
export const SAMPLE_LIST_MAX_LIMIT = 200

const SAMPLE_LIST_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: SAMPLE_LIST_MAX_LIMIT,
      default: SAMPLE_LIST_DEFAULT_LIMIT,
    },
    offset: { type: 'integer', minimum: 0, default: 0 },
  },
} as const

const SAMPLE_BODY_SCHEMA = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 1, maxLength: SAMPLE_TEXT_MAX_LENGTH },
    // 举报来源（P4 治理）：缺省 = 动态面板入口；仅羽化应用举报携带。
    source: { type: 'string', enum: ['eclosion'] },
    detail: { type: 'string', minLength: 1, maxLength: SAMPLE_DETAIL_MAX_LENGTH },
  },
}

export interface SampleRoutesOptions {
  store: DataStore
  /** Rate-limit window for the anonymous upload route; defaults to 60s. */
  rateLimitWindowMs?: number
}

/**
 * 举报样本上传与处置（DDS §8.6 收尾 + Phase B「分类器服务端化」）：
 * - `POST /dynamic/samples`（匿名，无需登录——举报者身份永不出本地，§8.5
 *   上行最小化；滥用由共享限流 + 512 字符上限 + 服务端分类器把关）：内容先过
 *   服务端分类器，`violation` 直接 422 且不落库（违规内容本体不入任何存储），
 *   其余分类落库供复审。P4（§10）羽化应用举报携带 `source:'eclosion'` 与
 *   `detail`（HTML 前 2KB 摘要）——分类只跑 `text`，detail 为生成产物原文
 *   不再过分类器（HTML 会误伤关键词），仅供复审面呈现。
 * - `GET /dynamic/samples`（仅 role=admin）：复审清单，新样本在前。
 * - `DELETE /dynamic/samples/:id`（仅 role=admin）：复审处置——删除已复核样本。
 */
export async function sampleRoutes(app: FastifyInstance, options: SampleRoutesOptions): Promise<void> {
  const { store } = options

  app.post(
    '/dynamic/samples',
    {
      config: {
        rateLimit: { max: 10, timeWindow: options.rateLimitWindowMs ?? 60_000 },
      },
      schema: { body: SAMPLE_BODY_SCHEMA },
    },
    async (request, reply) => {
      const body = request.body as { text: string; source?: 'eclosion'; detail?: string }
      const { classification, text } = classifyContentText(body.text)
      if (text.length === 0) {
        return reply.code(400).send({ error: 'invalid-body' })
      }
      if (classification === 'violation') {
        return reply.code(422).send({ error: 'content-rejected' })
      }
      const sample: ContentSampleRecord = {
        id: randomUUID(),
        text,
        classification,
        createdAt: new Date().toISOString(),
        ...(body.source === 'eclosion' ? { source: 'eclosion' } : {}),
        ...(typeof body.detail === 'string' && body.detail !== '' ? { detail: body.detail } : {}),
      }
      await store.createContentSample(sample)
      return reply.code(201).send({ status: 'accepted', id: sample.id, classification })
    },
  )

  app.get(
    '/dynamic/samples',
    { schema: { querystring: SAMPLE_LIST_QUERY_SCHEMA } },
    async (request, reply) => {
      if (!(await requireAdmin(store, request, reply))) return reply
      const { limit, offset } = request.query as { limit: number; offset: number }
      // 多取一条判断是否还有下一页，避免额外 COUNT 查询。
      const page = await store.listContentSamples(limit + 1, offset)
      return { samples: page.slice(0, limit), hasMore: page.length > limit }
    },
  )

  app.delete('/dynamic/samples/:id', async (request, reply) => {
    if (!(await requireAdmin(store, request, reply))) return reply
    const { id } = request.params as { id: string }
    const deleted = await store.deleteContentSample(id)
    if (!deleted) return reply.code(404).send({ error: 'not-found' })
    app.log.info({ audit: 'content.sample_deleted', sampleId: id }, 'reported sample deleted after review')
    return { deleted: true }
  })
}

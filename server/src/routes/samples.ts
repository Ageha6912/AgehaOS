import { randomUUID } from 'node:crypto'

import type { FastifyInstance } from 'fastify'

import { classifyContentText } from '../classifier'
import type { ContentSampleRecord, DataStore } from '../store/types'
import { requireAdmin } from './require-admin'

export const SAMPLE_TEXT_MAX_LENGTH = 512

const SAMPLE_BODY_SCHEMA = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 1, maxLength: SAMPLE_TEXT_MAX_LENGTH },
  },
}

export interface SampleRoutesOptions {
  store: DataStore
  /** Rate-limit window for the anonymous upload route; defaults to 60s. */
  rateLimitWindowMs?: number
}

/**
 * 举报样本上传（DDS §8.6 收尾 + Phase B「分类器服务端化」）：
 * - `POST /dynamic/samples`（匿名，无需登录——举报者身份永不出本地，§8.5
 *   上行最小化；滥用由共享限流 + 512 字符上限 + 服务端分类器把关）：内容先过
 *   服务端分类器，`violation` 直接 422 且不落库（违规内容本体不入任何存储），
 *   其余分类落库供复审。
 * - `GET /dynamic/samples`（仅 role=admin）：复审清单，新样本在前。
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
      const { classification, text } = classifyContentText(
        (request.body as { text: string }).text,
      )
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
      }
      await store.createContentSample(sample)
      return reply.code(201).send({ status: 'accepted', id: sample.id, classification })
    },
  )

  app.get('/dynamic/samples', async (request, reply) => {
    if (!(await requireAdmin(store, request, reply))) return reply
    return { samples: await store.listContentSamples() }
  })
}

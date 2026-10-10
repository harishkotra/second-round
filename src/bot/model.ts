/**
 * The model call.
 *
 * One OpenAI-compatible endpoint serves every bot; the model is configurable per
 * bot, which is how two builders get compared head to head on the same spec.
 *
 * Cost is estimated from configured rates and is labelled an estimate wherever
 * it is shown, because it is not a billed figure.
 */

import { estimateCostUsd } from './budget.js'

export const DEFAULT_MODEL = 'deepseek-v4.1-flash'
export const DEFAULT_BASE_URL = 'https://api.particle.ai/v1'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ModelResult = {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export type CallModelOptions = {
  persona: string
  messages: ChatMessage[]
  model?: string
  temperature?: number
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function readCompletion(
  payload: unknown,
  requestedModel: string,
  env: NodeJS.ProcessEnv = process.env,
): ModelResult {
  const root = asRecord(payload)
  if (root === null) throw new Error('model response was not an object')

  const choices = root['choices']
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('model response contained no choices')
  }

  const first = asRecord(choices[0])
  const message = first === null ? null : asRecord(first['message'])
  const text = message === null ? undefined : message['content']
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('model response contained no text content')
  }

  const usage = asRecord(root['usage']) ?? {}
  const inputTokens = numberOr(usage['prompt_tokens'], 0)
  const outputTokens = numberOr(usage['completion_tokens'], 0)

  return {
    text,
    model: typeof root['model'] === 'string' ? root['model'] : requestedModel,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(inputTokens, outputTokens, env),
  }
}

export async function callModel(options: CallModelOptions): Promise<ModelResult> {
  const env = options.env ?? process.env
  const apiKey = env['PARTICLE_API_KEY']
  if (apiKey === undefined || apiKey === '') {
    throw new Error('PARTICLE_API_KEY is not set')
  }

  const baseUrl = (env['PARTICLE_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = options.model ?? env['BOT_MODEL'] ?? DEFAULT_MODEL
  const doFetch = options.fetchImpl ?? fetch

  const response = await doFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.2,
      messages: [{ role: 'system', content: options.persona }, ...options.messages],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`model request failed: HTTP ${response.status} ${body.slice(0, 300)}`)
  }

  return readCompletion(await response.json(), model, env)
}
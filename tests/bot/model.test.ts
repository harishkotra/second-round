import { describe, expect, test } from 'vitest'
import { callModel, readCompletion } from '../../src/bot/model.js'

const payload = {
  model: 'deepseek-v4.1-flash',
  choices: [{ message: { content: 'hello' } }],
  usage: { prompt_tokens: 1000, completion_tokens: 500 },
}

describe('readCompletion', () => {
  test('extracts text, usage and an estimated cost', () => {
    const result = readCompletion(payload, 'fallback', {
      MODEL_PRICE_IN_PER_MTOK: '1',
      MODEL_PRICE_OUT_PER_MTOK: '2',
    })
    expect(result.text).toBe('hello')
    expect(result.model).toBe('deepseek-v4.1-flash')
    expect(result.inputTokens).toBe(1000)
    expect(result.outputTokens).toBe(500)
    expect(result.costUsd).toBeCloseTo(0.002, 6)
  })

  test('falls back to the requested model name', () => {
    const result = readCompletion({ choices: [{ message: { content: 'x' } }] }, 'my-model')
    expect(result.model).toBe('my-model')
  })

  test('tolerates missing usage rather than producing NaN', () => {
    const result = readCompletion({ choices: [{ message: { content: 'x' } }] }, 'm')
    expect(result.inputTokens).toBe(0)
    expect(result.costUsd).toBe(0)
  })

  test('throws when there are no choices', () => {
    expect(() => readCompletion({ choices: [] }, 'm')).toThrow(/no choices/)
  })

  test('throws when the content is blank', () => {
    expect(() => readCompletion({ choices: [{ message: { content: '   ' } }] }, 'm')).toThrow(
      /no text/,
    )
  })

  test('throws when the payload is not an object', () => {
    expect(() => readCompletion('nope', 'm')).toThrow(/not an object/)
  })
})

describe('callModel', () => {
  const env = { PARTICLE_API_KEY: 'k', PARTICLE_BASE_URL: 'https://example.test/v1/' }

  test('posts to the chat completions endpoint, trailing slash and all', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const fakeFetch: typeof fetch = async (url, init) => {
      seenUrl = String(url)
      const headers = init?.headers as Record<string, string>
      seenAuth = String(headers['authorization'])
      return new Response(JSON.stringify(payload), { status: 200 })
    }

    const result = await callModel({
      persona: 'be terse',
      messages: [{ role: 'user', content: 'hi' }],
      env,
      fetchImpl: fakeFetch,
    })

    expect(seenUrl).toBe('https://example.test/v1/chat/completions')
    expect(seenAuth).toBe('Bearer k')
    expect(result.text).toBe('hello')
  })

  test('throws when the api key is missing', async () => {
    await expect(callModel({ persona: 'p', messages: [], env: {} })).rejects.toThrow(
      /PARTICLE_API_KEY/,
    )
  })

  test('surfaces the status when the request fails', async () => {
    const fakeFetch: typeof fetch = async () => new Response('bad key', { status: 401 })
    await expect(
      callModel({ persona: 'p', messages: [], env, fetchImpl: fakeFetch }),
    ).rejects.toThrow(/HTTP 401/)
  })
})
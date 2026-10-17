import { describe, expect, test } from 'vitest'
import { issueNumberFromEnv } from '../../src/bots/mason.js'
import { pullNumberFromEnv as sentryPullNumber } from '../../src/bots/sentry.js'
import { pullNumberFromEnv as turnstilePullNumber } from '../../src/bots/turnstile.js'

describe('issueNumberFromEnv', () => {
  test('reads a positive integer', () => {
    expect(issueNumberFromEnv({ ISSUE_NUMBER: '42' })).toBe(42)
  })

  test('null when unset, which means take the next ready issue', () => {
    expect(issueNumberFromEnv({})).toBeNull()
    expect(issueNumberFromEnv({ ISSUE_NUMBER: '   ' })).toBeNull()
  })

  test('throws on a non-integer rather than quietly picking its own work', () => {
    expect(() => issueNumberFromEnv({ ISSUE_NUMBER: 'abc' })).toThrow(/positive integer/)
  })

  test('throws on zero', () => {
    expect(() => issueNumberFromEnv({ ISSUE_NUMBER: '0' })).toThrow(/positive integer/)
  })
})

describe('sentry pullNumberFromEnv', () => {
  test('reads a positive integer', async () => {
    expect(await sentryPullNumber({ PR_NUMBER: '7' })).toBe(7)
  })

  test('throws when unset, because a reviewer has no target without one', async () => {
    await expect(sentryPullNumber({})).rejects.toThrow(/PR_NUMBER is not set/)
  })

  test('throws on a negative value', async () => {
    await expect(sentryPullNumber({ PR_NUMBER: '-3' })).rejects.toThrow(/positive integer/)
  })
})

describe('turnstile pullNumberFromEnv', () => {
  test('reads a positive integer', () => {
    expect(turnstilePullNumber({ PR_NUMBER: '7' })).toBe(7)
  })

  test('null when unset, which means sweep rather than an error', () => {
    expect(turnstilePullNumber({})).toBeNull()
    expect(turnstilePullNumber({ PR_NUMBER: '  ' })).toBeNull()
  })

  test('still refuses nonsense rather than quietly sweeping', () => {
    expect(() => turnstilePullNumber({ PR_NUMBER: '-3' })).toThrow(/positive integer/)
  })
})
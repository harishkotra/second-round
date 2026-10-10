import { describe, expect, test } from 'vitest'
import { issueNumberFromEnv } from '../../src/bots/mason.js'
import { pullNumberFromEnv as sentryPullNumber } from '../../src/bots/sentry.js'
import { pullNumberFromEnv as turnstilePullNumber } from '../../src/bots/turnstile.js'

describe('issueNumberFromEnv', () => {
  test('reads a positive integer', async () => {
    expect(await issueNumberFromEnv({ ISSUE_NUMBER: '42' })).toBe(42)
  })

  test('throws when unset rather than guessing', async () => {
    await expect(issueNumberFromEnv({})).rejects.toThrow(/ISSUE_NUMBER is not set/)
  })

  test('throws on a blank value', async () => {
    await expect(issueNumberFromEnv({ ISSUE_NUMBER: '   ' })).rejects.toThrow(/is not set/)
  })

  test('throws on a non-integer', async () => {
    await expect(issueNumberFromEnv({ ISSUE_NUMBER: 'abc' })).rejects.toThrow(/positive integer/)
  })

  test('throws on zero', async () => {
    await expect(issueNumberFromEnv({ ISSUE_NUMBER: '0' })).rejects.toThrow(/positive integer/)
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
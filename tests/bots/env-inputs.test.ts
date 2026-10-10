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

describe('pullNumberFromEnv', () => {
  const parsers: [string, (env: NodeJS.ProcessEnv) => Promise<number>][] = [
    ['sentry', sentryPullNumber],
    ['turnstile', turnstilePullNumber],
  ]

  for (const [name, parse] of parsers) {
    test(`${name} reads a positive integer`, async () => {
      expect(await parse({ PR_NUMBER: '7' })).toBe(7)
    })

    test(`${name} throws when unset`, async () => {
      await expect(parse({})).rejects.toThrow(/PR_NUMBER is not set/)
    })

    test(`${name} throws on a negative value`, async () => {
      await expect(parse({ PR_NUMBER: '-3' })).rejects.toThrow(/positive integer/)
    })
  }
})
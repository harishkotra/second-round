import { describe, expect, test } from 'vitest'
import {
  envFlag,
  isBotSlug,
  isEntry,
  makeOctokit,
  repoFromEnv,
  tokenFromEnv,
} from '../../src/bot/github.js'

describe('repoFromEnv', () => {
  test('splits owner and repo', () => {
    expect(repoFromEnv({ GITHUB_REPOSITORY: 'harishkotra/second-round' })).toEqual({
      owner: 'harishkotra',
      repo: 'second-round',
    })
  })

  test('throws when unset', () => {
    expect(() => repoFromEnv({})).toThrow(/GITHUB_REPOSITORY/)
  })

  test('throws on a malformed value', () => {
    expect(() => repoFromEnv({ GITHUB_REPOSITORY: 'nope' })).toThrow(/GITHUB_REPOSITORY/)
  })

  test('throws on a trailing slash rather than producing an empty repo', () => {
    expect(() => repoFromEnv({ GITHUB_REPOSITORY: 'owner/' })).toThrow(/GITHUB_REPOSITORY/)
  })
})

describe('tokenFromEnv', () => {
  test('null when absent, so a dry run can work unauthenticated', () => {
    expect(tokenFromEnv({})).toBeNull()
    expect(tokenFromEnv({ GH_TOKEN: '' })).toBeNull()
  })

  test('returns the token when present', () => {
    expect(tokenFromEnv({ GH_TOKEN: 'x' })).toBe('x')
  })
})

describe('makeOctokit', () => {
  test('constructs with and without auth', () => {
    expect(typeof makeOctokit(null).request).toBe('function')
    expect(typeof makeOctokit('token').request).toBe('function')
  })
})

describe('isBotSlug', () => {
  test('accepts the phase 0 bots', () => {
    expect(isBotSlug('sr-foreman')).toBe(true)
    expect(isBotSlug('sr-mason')).toBe(true)
  })

  test('rejects anything else', () => {
    expect(isBotSlug('sr-nobody')).toBe(false)
  })
})

describe('envFlag', () => {
  test('accepts 1 and true, and nothing else', () => {
    expect(envFlag('DRY_RUN', { DRY_RUN: '1' })).toBe(true)
    expect(envFlag('DRY_RUN', { DRY_RUN: 'true' })).toBe(true)
    expect(envFlag('DRY_RUN', { DRY_RUN: '0' })).toBe(false)
    expect(envFlag('DRY_RUN', {})).toBe(false)
  })
})

describe('isEntry', () => {
  test('matches both the ts and js forms', () => {
    expect(isEntry('/a/b/foreman.ts', 'foreman')).toBe(true)
    expect(isEntry('/a/b/foreman.js', 'foreman')).toBe(true)
  })

  test('does not match a test runner', () => {
    expect(isEntry('/usr/local/bin/vitest', 'foreman')).toBe(false)
  })
})
import { describe, expect, test } from 'vitest'
import type { CheckRun } from '../../src/bot/repo.js'
import {
  canMerge,
  humanApproved,
  isBotLogin,
  latestCheckPerName,
  latestReviewPerAuthor,
} from '../../src/bots/turnstile.js'
import { cancelled, green, state } from '../helpers/turnstile-fixtures.js'

describe('canMerge', () => {
  test('merges when every gate is satisfied', () => {
    expect(canMerge(state())).toEqual({ ok: true })
  })

  test('refuses when a required check is missing', () => {
    const decision = canMerge(state({ checks: green.slice(1) }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('missing-check')
  })

  test('refuses when a required check is not green', () => {
    const checks: CheckRun[] = [
      ...green.slice(1),
      {
        name: 'lint',
        conclusion: 'failure',
        status: 'completed',
        startedAt: '2026-01-01T00:00:20Z',
      },
    ]
    const decision = canMerge(state({ checks }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('check-not-green:lint')
  })

  test('a cancelled earlier attempt does not override a later success', () => {
    // This is the exact shape that broke PR #32: the API returned the cancelled
    // runs last, and keying by name alone let them win.
    expect(canMerge(state({ checks: [...green, ...cancelled] })).ok).toBe(true)
    expect(canMerge(state({ checks: [...cancelled, ...green] })).ok).toBe(true)
  })

  test('the newest run wins even when the newest run is the bad one', () => {
    const relapsed: CheckRun[] = [
      {
        name: 'lint',
        conclusion: 'cancelled',
        status: 'completed',
        startedAt: '2026-01-01T00:00:30Z',
      },
    ]
    const decision = canMerge(state({ checks: [...green, ...relapsed] }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('check-not-green:lint')
  })

  test('refuses without any approval', () => {
    const decision = canMerge(state({ reviews: [] }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe('no-approval')
  })

  test('refuses when changes were requested', () => {
    const decision = canMerge(
      state({ reviews: [{ login: 'sr-sentry[bot]', state: 'CHANGES_REQUESTED' }] }),
    )
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('changes-requested-by')
  })

  test('a later approval supersedes an earlier rejection', () => {
    const reviews = [
      { login: 'sr-sentry[bot]', state: 'CHANGES_REQUESTED' },
      { login: 'sr-sentry[bot]', state: 'APPROVED' },
    ]
    expect(canMerge(state({ reviews })).ok).toBe(true)
  })

  test('a spec change needs a recorded human approval', () => {
    const decision = canMerge(state({ touchesSpec: true }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe('spec-change-needs-human')
  })

  test('a spec change with a human approval may merge', () => {
    expect(canMerge(state({ touchesSpec: true, humanApproved: true })).ok).toBe(true)
  })
})

describe('latestCheckPerName', () => {
  test('keeps the newest run of each name', () => {
    const map = latestCheckPerName([
      {
        name: 'lint',
        conclusion: 'cancelled',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00Z',
      },
      {
        name: 'lint',
        conclusion: 'success',
        status: 'completed',
        startedAt: '2026-01-01T00:00:05Z',
      },
      {
        name: 'test',
        conclusion: 'success',
        status: 'completed',
        startedAt: '2026-01-01T00:00:05Z',
      },
    ])
    expect(map.get('lint')?.conclusion).toBe('success')
    expect(map.size).toBe(2)
  })
})

describe('isBotLogin', () => {
  test('recognises an app identity', () => {
    expect(isBotLogin('sr-sentry[bot]')).toBe(true)
    expect(isBotLogin('harishkotra')).toBe(false)
  })
})

describe('latestReviewPerAuthor', () => {
  test('keeps only the last non-comment review per author', () => {
    const latest = latestReviewPerAuthor([
      { login: 'a', state: 'CHANGES_REQUESTED' },
      { login: 'a', state: 'COMMENTED' },
      { login: 'a', state: 'APPROVED' },
      { login: 'b', state: 'APPROVED' },
    ])
    expect(latest.map((review) => `${review.login}:${review.state}`).sort()).toEqual([
      'a:APPROVED',
      'b:APPROVED',
    ])
  })
})

describe('humanApproved', () => {
  test('ignores bot approvals', () => {
    expect(humanApproved([{ login: 'sr-sentry[bot]', state: 'APPROVED' }])).toBe(false)
  })

  test('counts a human approval', () => {
    expect(humanApproved([{ login: 'harishkotra', state: 'APPROVED' }])).toBe(true)
  })
})
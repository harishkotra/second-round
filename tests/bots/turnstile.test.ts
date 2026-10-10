import { describe, expect, test } from 'vitest'
import {
  canMerge,
  handler,
  humanApproved,
  isBotLogin,
  latestReviewPerAuthor,
  REQUIRED_CHECKS,
  SLUG,
  type MergeState,
} from '../../src/bots/turnstile.js'
import { asOctokit, fakeOctokit, type RouteHandler } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}'
const GET_FILES = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files'
const GET_CHECKS = 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs'
const GET_REVIEWS = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews'
const MERGE = 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'

const green = REQUIRED_CHECKS.map((name) => ({ name, conclusion: 'success', status: 'completed' }))
const sentryApproved = [{ login: 'sr-sentry[bot]', state: 'APPROVED' }]

function state(overrides: Partial<MergeState> = {}): MergeState {
  return { checks: green, reviews: sentryApproved, touchesSpec: false, humanApproved: false, ...overrides }
}

const runBase = {
  slug: SLUG,
  repo: ctx,
  persona: '# a persona',
  dryRun: false,
  history: [],
  log: () => undefined,
}

function routes(): Record<string, RouteHandler> {
  return {
    [GET_PR]: () => ({
      number: 12,
      title: 'x',
      body: 'Closes R-001',
      head: { sha: 'sha' },
      base: { ref: 'main' },
    }),
    [GET_FILES]: () => [{ filename: 'src/app/x.ts', patch: '+1' }],
    [GET_CHECKS]: () => ({ check_runs: green }),
    [GET_REVIEWS]: () => [{ user: { login: 'sr-sentry[bot]' }, state: 'APPROVED' }],
    [MERGE]: () => ({ sha: 'merged-sha' }),
  }
}

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
    const checks = [...green.slice(1), { name: 'lint', conclusion: 'failure', status: 'completed' }]
    const decision = canMerge(state({ checks }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toContain('check-not-green:lint')
  })

  test('refuses without any approval', () => {
    const decision = canMerge(state({ reviews: [] }))
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe('no-approval')
  })

  test('refuses when changes were requested', () => {
    const decision = canMerge(state({ reviews: [{ login: 'sr-sentry[bot]', state: 'CHANGES_REQUESTED' }] }))
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

describe('handler', () => {
  test('merges when the gates pass and records it', async () => {
    const fake = fakeOctokit(routes())
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, { pullNumber: 12 })
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('pr.merged')
    expect(events[0]?.req).toBe('R-001')
    expect(events[0]?.artifact).toBe('12')
    expect(fake.calls.some((call) => call.route === MERGE)).toBe(true)
  })

  test('refuses, records the reason, and does not merge', async () => {
    const fake = fakeOctokit({ ...routes(), [GET_REVIEWS]: () => [] })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, { pullNumber: 12 })
    expect(events[0]?.verdict).toBe('blocked')
    expect(events[0]?.reason).toBe('no-approval')
    expect(fake.calls.some((call) => call.route === MERGE)).toBe(false)
  })

  test('a dry run merges nothing', async () => {
    const fake = fakeOctokit(routes())
    const events = await handler({ ...runBase, octokit: asOctokit(fake), dryRun: true }, { pullNumber: 12 })
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === MERGE)).toBe(false)
  })
})
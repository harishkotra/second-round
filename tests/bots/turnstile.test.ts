import { describe, expect, test } from 'vitest'
import type { CheckRun } from '../../src/bot/repo.js'
import {
  canMerge,
  handler,
  humanApproved,
  isBotLogin,
  latestCheckPerName,
  latestReviewPerAuthor,
  REQUIRED_CHECKS,
  SLUG,
  sweepTargets,
  type MergeState,
} from '../../src/bots/turnstile.js'
import { makeEvent } from '../../src/ledger/schema.js'
import { asOctokit, fakeOctokit, type RouteHandler } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}'
const GET_PULLS = 'GET /repos/{owner}/{repo}/pulls'
const GET_FILES = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files'
const GET_CHECKS = 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs'
const GET_REVIEWS = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews'
const MERGE = 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'

const green: CheckRun[] = REQUIRED_CHECKS.map((name) => ({
  name,
  conclusion: 'success',
  status: 'completed',
  startedAt: '2026-01-01T00:00:10Z',
}))

/** The same names, cancelled, and started before the successful attempt. */
const cancelled: CheckRun[] = REQUIRED_CHECKS.map((name) => ({
  name,
  conclusion: 'cancelled',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00Z',
}))
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
    const checks: CheckRun[] = [
      ...green.slice(1),
      { name: 'lint', conclusion: 'failure', status: 'completed', startedAt: '2026-01-01T00:00:20Z' },
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
      { name: 'lint', conclusion: 'cancelled', status: 'completed', startedAt: '2026-01-01T00:00:30Z' },
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

describe('latestCheckPerName', () => {
  test('keeps the newest run of each name', () => {
    const map = latestCheckPerName([
      { name: 'lint', conclusion: 'cancelled', status: 'completed', startedAt: '2026-01-01T00:00:00Z' },
      { name: 'lint', conclusion: 'success', status: 'completed', startedAt: '2026-01-01T00:00:05Z' },
      { name: 'test', conclusion: 'success', status: 'completed', startedAt: '2026-01-01T00:00:05Z' },
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

  test('a named pull request never sweeps', async () => {
    const fake = fakeOctokit(routes())
    await handler({ ...runBase, octokit: asOctokit(fake) }, { pullNumber: 12 })
    expect(fake.calls.some((call) => call.route === GET_PULLS)).toBe(false)
  })

  test('with no number named it sweeps, merges the ready one, and passes over the rest', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [GET_PULLS]: () => [
        { number: 12, head: { ref: 'bot/R-001/thing' } },
        { number: 13, head: { ref: 'bot/R-002/other' } },
        { number: 14, head: { ref: 'feature/human-work' } },
      ],
      [GET_REVIEWS]: (params) =>
        params['pull_number'] === 13
          ? []
          : [{ user: { login: 'sr-sentry[bot]' }, state: 'APPROVED' }],
    })

    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {})

    expect(events.map((event) => event.artifact)).toEqual(['12'])
    expect(fake.calls.some((call) => call.route === MERGE && call.params['pull_number'] === 12)).toBe(
      true,
    )
    // #13 is not ready and #14 is not the crew's. Neither is merged, and a sweep
    // does not record a refusal for either: it would repeat every half hour.
    expect(fake.calls.some((call) => call.route === MERGE && call.params['pull_number'] === 13)).toBe(
      false,
    )
    expect(fake.calls.some((call) => call.params['pull_number'] === 14)).toBe(false)
  })

  test('a sweep records a pull request it cannot read, and carries on to the rest', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [GET_PULLS]: () => [
        { number: 13, head: { ref: 'bot/R-002/other' } },
        { number: 12, head: { ref: 'bot/R-001/thing' } },
      ],
      [GET_PR]: (params) => {
        if (params['pull_number'] === 13) throw new Error('HTTP 500')
        return {
          number: 12,
          title: 'x',
          body: 'Closes R-001',
          head: { sha: 'sha' },
          base: { ref: 'main' },
        }
      },
    })

    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {})
    expect(events.map((event) => event.artifact)).toEqual(['13', '12'])
    expect(events[0]?.verdict).toBe('blocked')
    expect(events[0]?.reason).toContain('unreadable')
    expect(events[1]?.action).toBe('pr.merged')
  })

  test('a merge that fails is recorded, not swallowed', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [MERGE]: () => {
        throw Object.assign(new Error('HTTP 403'), { status: 403 })
      },
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, { pullNumber: 12 })
    expect(events).toHaveLength(1)
    expect(events[0]?.verdict).toBe('blocked')
    expect(events[0]?.reason).toContain('merge-failed')
    expect(events[0]?.reason).toContain('HTTP 403')
  })

  test('a sweep does not repeat a failure it has already recorded', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [GET_PULLS]: () => [{ number: 12, head: { ref: 'bot/R-001/thing' } }],
      [MERGE]: () => {
        throw Object.assign(new Error('HTTP 403'), { status: 403 })
      },
    })
    const history = [
      makeEvent({
        bot: SLUG,
        action: 'pr.reviewed',
        artifact: '12',
        verdict: 'blocked',
        reason: 'merge-failed: HTTP 403',
      }),
    ]
    const events = await handler({ ...runBase, octokit: asOctokit(fake), history }, {})
    expect(events).toEqual([])
  })

  test('but a different failure is news and is recorded', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [GET_PULLS]: () => [{ number: 12, head: { ref: 'bot/R-001/thing' } }],
      [MERGE]: () => {
        throw Object.assign(new Error('HTTP 405'), { status: 405 })
      },
    })
    const history = [
      makeEvent({
        bot: SLUG,
        action: 'pr.reviewed',
        artifact: '12',
        verdict: 'blocked',
        reason: 'merge-failed: HTTP 403',
      }),
    ]
    const events = await handler({ ...runBase, octokit: asOctokit(fake), history }, {})
    expect(events[0]?.reason).toContain('HTTP 405')
  })

  test('nothing to merge is not an error', async () => {
    const fake = fakeOctokit({ ...routes(), [GET_PULLS]: () => [] })
    expect(await handler({ ...runBase, octokit: asOctokit(fake) }, {})).toEqual([])
  })
})

describe('sweepTargets', () => {
  test('only considers branches the crew opened', async () => {
    const fake = fakeOctokit({
      [GET_PULLS]: () => [
        { number: 1, head: { ref: 'bot/R-001/a' } },
        { number: 2, head: { ref: 'human-work' } },
        { number: 3, head: { ref: 'bot/R-002/b' } },
      ],
    })
    expect(await sweepTargets(asOctokit(fake), ctx)).toEqual([1, 3])
  })
})
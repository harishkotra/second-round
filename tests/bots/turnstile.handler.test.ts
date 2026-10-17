/**
 * Turnstile's handler: deciding on a named pull request, or sweeping every open
 * crew pull request and merging whatever is ready.
 *
 * Separated from the pure gate tests because this is the integration path, and
 * it needs the routes, the ledger and the compare endpoint.
 */

import { describe, expect, test } from 'vitest'
import { handler, sweepTargets, SLUG } from '../../src/bots/turnstile.js'
import { makeEvent } from '../../src/ledger/schema.js'
import { asOctokit, encoded, fakeOctokit } from '../helpers/fake-octokit.js'
import {
  ctx,
  GET_COMPARE,
  GET_CONTENTS,
  GET_PR,
  GET_PULLS,
  GET_REVIEWS,
  MERGE,
  PATCH_ISSUE,
  COMMENT,
  routes,
  runBase,
  UPDATE_BRANCH,
} from '../helpers/turnstile-fixtures.js'

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
    const events = await handler(
      { ...runBase, octokit: asOctokit(fake), dryRun: true },
      { pullNumber: 12 },
    )
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
        params['pull_number'] === 13 ? [] : [{ user: { login: 'sr-sentry[bot]' }, state: 'APPROVED' }],
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

  test('a pull request that is behind its base is brought up to date, not merged', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [GET_COMPARE]: () => ({ behind_by: 3 }),
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, { pullNumber: 12 })
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('pr.updated')
    expect(events[0]?.reason).toBe('branch-behind:3')
    expect(fake.calls.some((call) => call.route === UPDATE_BRANCH)).toBe(true)
    expect(fake.calls.some((call) => call.route === MERGE)).toBe(false)
  })

  test('a dry run leaves the branch alone', async () => {
    const fake = fakeOctokit({
      ...routes(),
      [GET_COMPARE]: () => ({ behind_by: 3 }),
    })
    const events = await handler(
      { ...runBase, octokit: asOctokit(fake), dryRun: true },
      { pullNumber: 12 },
    )
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === UPDATE_BRANCH)).toBe(false)
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

  test('closes the issue the builder claimed, so the queue matches what shipped', async () => {
    const masonLedger =
      JSON.stringify({
        ts: '2026-10-10T06:27:47.279Z',
        bot: 'sr-mason',
        action: 'issue.claimed',
        req: 'R-001',
        artifact: '1',
        costUsd: 0,
        verdict: null,
        reason: null,
      }) + '\n'
    const fake = fakeOctokit({
      ...routes(),
      [GET_CONTENTS]: () => ({ content: encoded(masonLedger), sha: 'sha' }),
    })

    await handler({ ...runBase, octokit: asOctokit(fake) }, { pullNumber: 12 })

    const patched = fake.calls.find((call) => call.route === PATCH_ISSUE)
    expect(patched?.params['issue_number']).toBe(1)
    expect(patched?.params['state']).toBe('closed')
    const comment = fake.calls.find((call) => call.route === COMMENT)
    expect(String(comment?.params['body'])).toContain('#12')
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
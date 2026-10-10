import { describe, expect, test } from 'vitest'
import { withBot, type RunDeps } from '../../src/bot/run.js'
import { makeEvent } from '../../src/ledger/schema.js'
import { asOctokit, decoded, fakeOctokit, httpError } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET = 'GET /repos/{owner}/{repo}/contents/{path}'
const PUT = 'PUT /repos/{owner}/{repo}/contents/{path}'
const GET_BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}'
const GET_REPO = 'GET /repos/{owner}/{repo}'
const GET_REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}'
const CREATE_REF = 'POST /repos/{owner}/{repo}/git/refs'

const base: Omit<RunDeps, 'octokit' | 'history'> = {
  repo: ctx,
  persona: '# a persona',
  dryRun: false,
  capUsd: 1,
  now: new Date('2026-10-10T12:00:00Z'),
}

/** A first-ever run: no ledger file, no ledger branch. */
function firstRunOctokit(): ReturnType<typeof fakeOctokit> {
  return fakeOctokit({
    [GET]: () => {
      throw httpError(404)
    },
    [GET_BRANCH]: () => {
      throw httpError(404)
    },
    [GET_REPO]: () => ({ default_branch: 'main' }),
    [GET_REF]: () => ({ object: { sha: 'head' } }),
    [CREATE_REF]: () => ({}),
    [PUT]: () => ({}),
  })
}

describe('withBot', () => {
  test('records what the handler did', async () => {
    const fake = firstRunOctokit()
    const code = await withBot(
      'sr-mason',
      async () => [makeEvent({ bot: 'sr-mason', action: 'pr.opened' })],
      { ...base, octokit: asOctokit(fake), history: [] },
    )
    expect(code).toBe(0)
    expect(fake.calls.some((call) => call.route === PUT)).toBe(true)
  })

  test('pauses instead of failing when the budget is gone', async () => {
    const fake = firstRunOctokit()
    let handlerRan = false
    const code = await withBot(
      'sr-mason',
      async () => {
        handlerRan = true
        return []
      },
      {
        ...base,
        octokit: asOctokit(fake),
        history: [
          makeEvent({
            ts: '2026-10-10T01:00:00Z',
            bot: 'sr-mason',
            action: 'pr.opened',
            costUsd: 5,
          }),
        ],
      },
    )
    expect(code).toBe(0)
    expect(handlerRan).toBe(false)
    const put = fake.calls.find((call) => call.route === PUT)
    expect(decoded(put?.params['content'])).toContain('budget.exceeded')
  })

  test('a dry run writes nothing to the ledger', async () => {
    const fake = fakeOctokit({})
    const code = await withBot(
      'sr-mason',
      async () => [makeEvent({ bot: 'sr-mason', action: 'pr.opened' })],
      { ...base, dryRun: true, octokit: asOctokit(fake), history: [] },
    )
    expect(code).toBe(0)
    expect(fake.calls).toHaveLength(0)
  })

  test('a handler that finds nothing to do is not an error', async () => {
    const fake = fakeOctokit({})
    const code = await withBot('sr-mason', async () => [], {
      ...base,
      octokit: asOctokit(fake),
      history: [],
    })
    expect(code).toBe(0)
    expect(fake.calls).toHaveLength(0)
  })
})
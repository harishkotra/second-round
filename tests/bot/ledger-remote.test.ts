import { describe, expect, test } from 'vitest'
import {
  appendRemoteLedger,
  branchExists,
  ensureLedgerBranch,
  ledgerPath,
  readRemoteLedger,
} from '../../src/bot/ledger-remote.js'
import { makeEvent, type LedgerEvent } from '../../src/ledger/schema.js'
import { asOctokit, decoded, encoded, fakeOctokit, httpError } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET = 'GET /repos/{owner}/{repo}/contents/{path}'
const PUT = 'PUT /repos/{owner}/{repo}/contents/{path}'
const GET_BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}'
const GET_REPO = 'GET /repos/{owner}/{repo}'
const GET_REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}'
const CREATE_REF = 'POST /repos/{owner}/{repo}/git/refs'

function stored(events: LedgerEvent[]): { content: string; sha: string } {
  return {
    content: encoded(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`),
    sha: 'sha-1',
  }
}

/** Routes for a first-ever run: no branch, no file. */
function firstRunRoutes(): Record<string, () => unknown> {
  return {
    [GET]: () => {
      throw httpError(404)
    },
    [GET_BRANCH]: () => {
      throw httpError(404)
    },
    [GET_REPO]: () => ({ default_branch: 'main' }),
    [GET_REF]: () => ({ object: { sha: 'main-head-sha' } }),
    [CREATE_REF]: () => ({}),
    [PUT]: () => ({}),
  }
}

describe('ledgerPath', () => {
  test('one file per bot, so two bots can never conflict', () => {
    expect(ledgerPath('sr-mason')).toBe('ledger/sr-mason.ndjson')
  })
})

describe('readRemoteLedger', () => {
  test('a missing file is an empty history, not an error', async () => {
    const fake = fakeOctokit({
      [GET]: () => {
        throw httpError(404)
      },
    })
    expect(await readRemoteLedger(asOctokit(fake), ctx, 'sr-mason')).toEqual([])
  })

  test('parses stored events', async () => {
    const fake = fakeOctokit({
      [GET]: () => stored([makeEvent({ bot: 'sr-mason', action: 'pr.opened' })]),
    })
    expect(await readRemoteLedger(asOctokit(fake), ctx, 'sr-mason')).toHaveLength(1)
  })

  test('a directory response is treated as no history', async () => {
    const fake = fakeOctokit({ [GET]: () => [] })
    expect(await readRemoteLedger(asOctokit(fake), ctx, 'sr-mason')).toEqual([])
  })

  test('a non-404 error is rethrown, never swallowed', async () => {
    const fake = fakeOctokit({
      [GET]: () => {
        throw httpError(500)
      },
    })
    await expect(readRemoteLedger(asOctokit(fake), ctx, 'sr-mason')).rejects.toThrow(/HTTP 500/)
  })
})

describe('appendRemoteLedger', () => {
  test('creates the ledger branch on first use, then the file with no sha', async () => {
    const fake = fakeOctokit(firstRunRoutes())
    await appendRemoteLedger(
      asOctokit(fake),
      ctx,
      'sr-mason',
      [makeEvent({ bot: 'sr-mason', action: 'pr.opened' })],
      'message',
    )

    const created = fake.calls.find((call) => call.route === CREATE_REF)
    expect(created?.params['ref']).toBe('refs/heads/ledger')
    expect(created?.params['sha']).toBe('main-head-sha')

    const put = fake.calls.find((call) => call.route === PUT)
    expect(put?.params['sha']).toBeUndefined()
    expect(put?.params['branch']).toBe('ledger')
    expect(decoded(put?.params['content']).trim().split('\n')).toHaveLength(1)
  })

  test('appends to existing history and sends the sha, without touching refs', async () => {
    const existing = makeEvent({ bot: 'sr-mason', action: 'pr.opened' })
    const fake = fakeOctokit({
      [GET]: () => stored([existing]),
      [PUT]: () => ({}),
    })
    await appendRemoteLedger(
      asOctokit(fake),
      ctx,
      'sr-mason',
      [makeEvent({ bot: 'sr-mason', action: 'pr.merged' })],
      'message',
    )
    const put = fake.calls.find((call) => call.route === PUT)
    expect(put?.params['sha']).toBe('sha-1')
    expect(decoded(put?.params['content']).trim().split('\n')).toHaveLength(2)
    expect(fake.calls.some((call) => call.route === CREATE_REF)).toBe(false)
  })

  test('writes nothing at all for an empty event list', async () => {
    const fake = fakeOctokit({})
    await appendRemoteLedger(asOctokit(fake), ctx, 'sr-mason', [], 'message')
    expect(fake.calls).toHaveLength(0)
  })

  test('a 403 names the missing permission instead of the raw status', async () => {
    const fake = fakeOctokit({
      [GET]: () => stored([makeEvent({ bot: 'sr-sentry', action: 'pr.opened' })]),
      [PUT]: () => {
        throw httpError(403)
      },
    })
    await expect(
      appendRemoteLedger(
        asOctokit(fake),
        ctx,
        'sr-sentry',
        [makeEvent({ bot: 'sr-sentry', action: 'pr.reviewed' })],
        'message',
      ),
    ).rejects.toThrow(/Contents: read and write/)
  })

  test('a write failure that is not a 403 is left alone', async () => {
    const fake = fakeOctokit({
      [GET]: () => stored([]),
      [PUT]: () => {
        throw httpError(500)
      },
    })
    await expect(
      appendRemoteLedger(
        asOctokit(fake),
        ctx,
        'sr-mason',
        [makeEvent({ bot: 'sr-mason', action: 'pr.opened' })],
        'message',
      ),
    ).rejects.toThrow(/HTTP 500/)
  })
})

describe('ensureLedgerBranch', () => {
  test('does nothing when the branch already exists', async () => {
    const fake = fakeOctokit({ [GET_BRANCH]: () => ({ name: 'ledger' }) })
    expect(await ensureLedgerBranch(asOctokit(fake), ctx)).toBe(false)
    expect(fake.calls.some((call) => call.route === CREATE_REF)).toBe(false)
  })

  test('creates it from the default branch head when missing', async () => {
    const fake = fakeOctokit({
      [GET_BRANCH]: () => {
        throw httpError(404)
      },
      [GET_REPO]: () => ({ default_branch: 'main' }),
      [GET_REF]: () => ({ object: { sha: 'head' } }),
      [CREATE_REF]: () => ({}),
    })
    expect(await ensureLedgerBranch(asOctokit(fake), ctx)).toBe(true)
    expect(fake.calls.find((call) => call.route === GET_REF)?.params['ref']).toBe('heads/main')
  })

  test('a 403 creating the branch explains the missing permission', async () => {
    const fake = fakeOctokit({
      [GET_BRANCH]: () => {
        throw httpError(404)
      },
      [GET_REPO]: () => ({ default_branch: 'main' }),
      [GET_REF]: () => ({ object: { sha: 'head' } }),
      [CREATE_REF]: () => {
        throw httpError(403)
      },
    })
    await expect(ensureLedgerBranch(asOctokit(fake), ctx)).rejects.toThrow(
      /Contents: read and write/,
    )
  })
})

describe('branchExists', () => {
  test('rethrows a non-404 rather than reporting the branch as absent', async () => {
    const fake = fakeOctokit({
      [GET_BRANCH]: () => {
        throw httpError(403)
      },
    })
    await expect(branchExists(asOctokit(fake), ctx, 'ledger')).rejects.toThrow(/HTTP 403/)
  })
})
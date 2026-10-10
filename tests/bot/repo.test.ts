import { describe, expect, test } from 'vitest'
import {
  branchName,
  diffText,
  ensureBranch,
  findOpenPullRequest,
  listCheckRuns,
  listOpenPullRequests,
  slugify,
  updatePullRequest,
  type PullRequestView,
} from '../../src/bot/repo.js'
import { asOctokit, fakeOctokit, httpError } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_PULLS = 'GET /repos/{owner}/{repo}/pulls'
const GET_BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}'
const GET_REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}'
const CREATE_REF = 'POST /repos/{owner}/{repo}/git/refs'
const PATCH_PR = 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}'
const GET_CHECKS = 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs'

describe('slugify', () => {
  test('lowercases and hyphenates', () => {
    expect(slugify('Accept a pasted job description')).toBe('accept-a-pasted-job-description')
  })

  test('strips punctuation and trims edge hyphens', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world')
  })

  test('truncates without leaving a trailing hyphen', () => {
    expect(slugify('aaaa bbbb cccc', 9)).toBe('aaaa-bbbb')
  })

  test('an all-punctuation string becomes empty rather than a stray hyphen', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('branchName', () => {
  test('namespaces by requirement so two builders cannot collide', () => {
    expect(branchName('R-004', 'Conduct a multi-turn interview')).toBe(
      'bot/R-004/conduct-a-multi-turn-interview',
    )
  })
})

describe('diffText', () => {
  const view: PullRequestView = {
    number: 1,
    title: 'a title',
    body: 'a body',
    headSha: 'sha',
    baseBranch: 'main',
    files: [
      { path: 'src/a.ts', patch: '+added line' },
      { path: 'assets/logo.png', patch: null },
    ],
  }

  test('includes each file and its patch', () => {
    const text = diffText(view)
    expect(text).toContain('--- src/a.ts')
    expect(text).toContain('+added line')
  })

  test('says so plainly when a patch cannot be shown', () => {
    expect(diffText(view)).toContain('too large to display')
  })

  test('respects the character limit', () => {
    expect(diffText(view, 10).length).toBeLessThanOrEqual(10)
  })
})

describe('findOpenPullRequest', () => {
  test('scopes the search to the owner and the branch', async () => {
    const fake = fakeOctokit({ [GET_PULLS]: () => [{ number: 31 }] })
    expect(await findOpenPullRequest(asOctokit(fake), ctx, 'bot/R-001/thing')).toBe(31)
    const call = fake.calls[0]
    expect(call?.params['head']).toBe('o:bot/R-001/thing')
    expect(call?.params['state']).toBe('open')
  })

  test('null when the requirement has no open pull request', async () => {
    const fake = fakeOctokit({ [GET_PULLS]: () => [] })
    expect(await findOpenPullRequest(asOctokit(fake), ctx, 'bot/R-001/thing')).toBeNull()
  })
})

describe('ensureBranch', () => {
  test('reuses a branch that already exists and creates nothing', async () => {
    const fake = fakeOctokit({ [GET_BRANCH]: () => ({ name: 'bot/R-001/thing' }) })
    expect(await ensureBranch(asOctokit(fake), ctx, 'bot/R-001/thing', 'main')).toBe(false)
    expect(fake.calls.some((call) => call.route === CREATE_REF)).toBe(false)
  })

  test('creates it from the base branch when it is missing', async () => {
    const fake = fakeOctokit({
      [GET_BRANCH]: () => {
        throw httpError(404)
      },
      [GET_REF]: () => ({ object: { sha: 'base-sha' } }),
      [CREATE_REF]: () => ({}),
    })
    expect(await ensureBranch(asOctokit(fake), ctx, 'bot/R-001/thing', 'main')).toBe(true)
    const created = fake.calls.find((call) => call.route === CREATE_REF)
    expect(created?.params['sha']).toBe('base-sha')
    expect(created?.params['ref']).toBe('refs/heads/bot/R-001/thing')
  })

  test('rethrows a non-404 rather than assuming the branch is absent', async () => {
    const fake = fakeOctokit({
      [GET_BRANCH]: () => {
        throw httpError(500)
      },
    })
    await expect(ensureBranch(asOctokit(fake), ctx, 'b', 'main')).rejects.toThrow(/HTTP 500/)
  })
})

describe('updatePullRequest', () => {
  test('patches the title and body of the pull request that already exists', async () => {
    const fake = fakeOctokit({ [PATCH_PR]: () => ({}) })
    await updatePullRequest(asOctokit(fake), ctx, 31, { title: 'a title', body: 'a body' })
    const call = fake.calls[0]
    expect(call?.params['pull_number']).toBe(31)
    expect(call?.params['title']).toBe('a title')
    expect(call?.params['body']).toBe('a body')
  })
})

describe('listOpenPullRequests', () => {
  test('returns every open pull request with its head branch', async () => {
    const fake = fakeOctokit({
      [GET_PULLS]: () => [
        { number: 1, head: { ref: 'bot/R-001/a' } },
        { number: 2, head: { ref: 'feature/human-work' } },
      ],
    })
    expect(await listOpenPullRequests(asOctokit(fake), ctx)).toEqual([
      { number: 1, headRef: 'bot/R-001/a' },
      { number: 2, headRef: 'feature/human-work' },
    ])
    expect(fake.calls[0]?.params['state']).toBe('open')
  })
})

describe('listCheckRuns', () => {
  test('keeps the start time, which is how the newest run of a name is chosen', async () => {
    const fake = fakeOctokit({
      [GET_CHECKS]: () => ({
        check_runs: [
          { name: 'lint', conclusion: 'cancelled', status: 'completed', started_at: 'T1' },
          { name: 'lint', conclusion: 'success', status: 'completed', started_at: 'T2' },
          { name: 'build', conclusion: null, status: 'queued', started_at: null },
        ],
      }),
    })
    expect(await listCheckRuns(asOctokit(fake), ctx, 'sha')).toEqual([
      { name: 'lint', conclusion: 'cancelled', status: 'completed', startedAt: 'T1' },
      { name: 'lint', conclusion: 'success', status: 'completed', startedAt: 'T2' },
      // A run that has not started has no timestamp. An empty string sorts
      // before every real one, so it loses to any run that did happen.
      { name: 'build', conclusion: null, status: 'queued', startedAt: '' },
    ])
  })
})
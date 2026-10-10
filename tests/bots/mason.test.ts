import { describe, expect, test } from 'vitest'
import type { CheckResult } from '../../src/bot/verify.js'
import {
  buildPrompt,
  buildPrBody,
  buildRepairPrompt,
  fetchIssue,
  handler,
  issueRequirementId,
  MAX_REPAIRS,
  planImplementation,
  readNotes,
  SLUG,
} from '../../src/bots/mason.js'
import type { Requirement } from '../../src/spec/load.js'
import { asOctokit, decoded, fakeOctokit, type RouteHandler } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_ISSUE = 'GET /repos/{owner}/{repo}/issues/{issue_number}'
const GET_REPO = 'GET /repos/{owner}/{repo}'
const GET_TREE = 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}'
const GET_REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}'
const CREATE_REF = 'POST /repos/{owner}/{repo}/git/refs'
const GET_BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}'
const GET_CONTENT = 'GET /repos/{owner}/{repo}/contents/{path}'
const PUT_CONTENT = 'PUT /repos/{owner}/{repo}/contents/{path}'
const CREATE_PR = 'POST /repos/{owner}/{repo}/pulls'
const GET_PULLS = 'GET /repos/{owner}/{repo}/pulls'
const PATCH_PR = 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}'

const requirement: Requirement = { id: 'R-001', phase: 0, text: 'Accept a pasted job description' }

const runBase = {
  slug: SLUG,
  repo: ctx,
  persona: '# a persona',
  dryRun: false,
  history: [],
  log: () => undefined,
}

function happyRoutes(): Record<string, RouteHandler> {
  return {
    [GET_ISSUE]: () => ({
      title: '[R-001] Accept a pasted job description',
      body: 'Closes R-001',
      labels: [],
    }),
    [GET_REPO]: () => ({ default_branch: 'main' }),
    [GET_TREE]: () => ({ tree: [{ path: 'package.json' }, { path: 'src/index.ts' }] }),
    [GET_REF]: () => ({ object: { sha: 'head-sha' } }),
    [CREATE_REF]: () => ({}),
    [GET_BRANCH]: () => {
      throw Object.assign(new Error('HTTP 404'), { status: 404 })
    },
    [GET_PULLS]: () => [],
    [PATCH_PR]: () => ({}),
    [GET_CONTENT]: () => {
      throw Object.assign(new Error('HTTP 404'), { status: 404 })
    },
    [PUT_CONTENT]: () => ({}),
    [CREATE_PR]: () => ({ number: 77 }),
  }
}

const patchText =
  '{"files":[{"path":"src/app/intake.ts","content":"export const intake = true"}],"notes":"first pass"}'

function generate(text: string): () => Promise<{
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}> {
  return async () => ({
    text,
    model: 'deepseek-v4.1-flash',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.0021,
  })
}

/**
 * The self-check is injected everywhere in these tests. Without it the handler
 * would call the real verifier, which writes files into the working tree and runs
 * npm inside the test process.
 */
const passingVerify = async (): Promise<CheckResult> => ({ ok: true, output: '' })
const failingVerify = async (): Promise<CheckResult> => ({
  ok: false,
  output: 'typecheck failed: src/app/intake.ts(1,1)',
})

describe('issueRequirementId', () => {
  test('reads the id from the issue title', () => {
    expect(issueRequirementId('[R-001] Accept a pasted job description', '')).toBe('R-001')
  })

  test('falls back to a Closes line in the body', () => {
    expect(issueRequirementId('something else', 'Closes C-007')).toBe('C-007')
  })

  test('null when the issue names no requirement', () => {
    expect(issueRequirementId('a random idea', 'no reference here')).toBeNull()
  })
})

describe('buildPrBody', () => {
  test('always names the requirement, because that is what CI reads', () => {
    const body = buildPrBody(requirement, 4, '')
    expect(body).toContain('Closes R-001')
    expect(body).toContain('Resolves #4')
    expect(body).toContain('Nothing to flag.')
  })

  test('carries the builder notes through', () => {
    expect(buildPrBody(requirement, 4, 'left the export out')).toContain('left the export out')
  })
})

describe('planImplementation', () => {
  test('parses a fenced patch and names the branch by requirement', () => {
    const raw = `\`\`\`json\n${patchText}\n\`\`\``
    const plan = planImplementation(requirement, 4, raw, readNotes(raw))
    expect(plan.branch).toBe('bot/R-001/accept-a-pasted-job-description')
    expect(plan.files).toHaveLength(1)
    expect(plan.title).toContain('[R-001]')
  })
})

describe('readNotes', () => {
  test('extracts notes', () => {
    expect(readNotes(patchText)).toBe('first pass')
  })

  test('empty string when there are none or the JSON is broken', () => {
    expect(readNotes('{"files":[]}')).toBe('')
    expect(readNotes('not json at all')).toBe('')
  })

  test('empty string when the braces contain invalid JSON', () => {
    expect(readNotes('{not valid json}')).toBe('')
  })
})

describe('fetchIssue', () => {
  test('normalises both label shapes and a null body', async () => {
    const fake = fakeOctokit({
      [GET_ISSUE]: () => ({ title: 't', body: null, labels: ['a', { name: 'b' }] }),
    })
    const issue = await fetchIssue(asOctokit(fake), ctx, 4)
    expect(issue.labels).toEqual(['a', 'b'])
    expect(issue.body).toBe('')
  })
})

describe('buildPrompt', () => {
  test('demands JSON, and forbids editing the spec', () => {
    const prompt = buildPrompt(requirement, 4, ['src/index.ts'])
    expect(prompt).toContain('Return ONLY a JSON object')
    expect(prompt).toContain('Do not edit spec/')
    expect(prompt).toContain('src/index.ts')
  })

  test('carries the conventions and the source when they are supplied', () => {
    const prompt = buildPrompt(
      requirement,
      4,
      ['src/index.ts'],
      'IMPORTS END IN .js',
      'export const a = 1',
    )
    expect(prompt).toContain('Repository conventions you must follow exactly:')
    expect(prompt).toContain('IMPORTS END IN .js')
    expect(prompt).toContain('Read them before you write anything:')
    expect(prompt).toContain('export const a = 1')
  })

  test('omits both sections rather than sending empty headings', () => {
    const prompt = buildPrompt(requirement, 4, ['src/index.ts'])
    expect(prompt).not.toContain('Repository conventions you must follow exactly:')
    expect(prompt).not.toContain('Read them before you write anything:')
  })

  test('forbids the orphan module that failed review on PR #31', () => {
    const prompt = buildPrompt(requirement, 4, ['src/index.ts'])
    expect(prompt).toContain('EDIT the existing file')
    expect(prompt).toContain('a module nothing imports does not satisfy a requirement')
  })
})

describe('buildRepairPrompt', () => {
  test('carries the failure back, and forbids a conversation', () => {
    const prompt = buildRepairPrompt(
      requirement,
      [{ path: 'src/a.ts', content: 'x' }],
      'typecheck failed',
    )
    expect(prompt).toContain('did not pass its own checks')
    expect(prompt).toContain('src/a.ts')
    expect(prompt).toContain('typecheck failed')
    expect(prompt).toContain('Do not explain')
  })
})

describe('handler', () => {
  test('opens one pull request naming the requirement, and records both events', async () => {
    const fake = fakeOctokit(happyRoutes())
    const events = await handler(
      { ...runBase, octokit: asOctokit(fake) },
      { issueNumber: 4, generate: generate(patchText), verify: passingVerify },
    )

    expect(events.map((event) => event.action)).toEqual(['issue.claimed', 'pr.opened'])
    expect(events[0]?.req).toBe('R-001')
    expect(events[1]?.artifact).toBe('77')
    expect(events[0]?.costUsd).toBeCloseTo(0.0021, 6)

    const pr = fake.calls.find((call) => call.route === CREATE_PR)
    // The slug comes from the real spec text, so assert the shape rather than a
    // hard-coded slug that a spec edit would break.
    expect(String(pr?.params['head'])).toMatch(/^bot\/R-001\/accept-a-pasted-job-description/)
    expect(pr?.params['base']).toBe('main')
    expect(String(pr?.params['body'])).toContain('Closes R-001')

    const put = fake.calls.find((call) => call.route === PUT_CONTENT)
    expect(decoded(put?.params['content'])).toContain('export const intake = true')
  })

  test('refuses an issue that names no requirement, without calling the model', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_ISSUE]: () => ({ title: 'a random idea', body: '', labels: [] }),
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      issueNumber: 4,
      generate: async () => {
        throw new Error('the model must not be called here')
      },
    })
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === CREATE_PR)).toBe(false)
  })

  test('refuses a requirement that is not in the spec', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_ISSUE]: () => ({ title: '[R-999] made up', body: '', labels: [] }),
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      issueNumber: 4,
      generate: async () => {
        throw new Error('the model must not be called here')
      },
    })
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === CREATE_PR)).toBe(false)
  })

  test('a dry run creates nothing and calls no model', async () => {
    const routes = happyRoutes()
    const fake = fakeOctokit({
      [GET_ISSUE]: routes[GET_ISSUE]!,
      [GET_REPO]: routes[GET_REPO]!,
      [GET_TREE]: routes[GET_TREE]!,
    })
    const events = await handler(
      { ...runBase, octokit: asOctokit(fake), dryRun: true },
      {
        issueNumber: 4,
        generate: async () => {
          throw new Error('the model must not be called in a dry run')
        },
      },
    )
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === CREATE_PR)).toBe(false)
  })

  test('updates an existing file, sending its sha so the write is accepted', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_CONTENT]: () => ({ sha: 'existing-sha' }),
    })
    await handler({ ...runBase, octokit: asOctokit(fake) }, {
      issueNumber: 4,
      generate: generate(patchText),
      verify: passingVerify,
    })
    const put = fake.calls.find((call) => call.route === PUT_CONTENT)
    expect(put?.params['sha']).toBe('existing-sha')
  })

  test('a content lookup that fails for a reason other than 404 stops the run', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_CONTENT]: () => {
        throw Object.assign(new Error('HTTP 500'), { status: 500 })
      },
    })
    await expect(
      handler({ ...runBase, octokit: asOctokit(fake) }, {
        issueNumber: 4,
        generate: generate(patchText),
        verify: passingVerify,
      }),
    ).rejects.toThrow(/HTTP 500/)
  })

  test('fails its own check, repairs once, and ships the repaired files', async () => {
    const repaired =
      '{"files":[{"path":"src/app/intake.ts","content":"export const intake = 2"}],"notes":"fixed"}'
    let calls = 0
    const generate = async (): Promise<{
      text: string
      model: string
      inputTokens: number
      outputTokens: number
      costUsd: number
    }> => {
      calls += 1
      return {
        text: calls === 1 ? patchText : repaired,
        model: 'deepseek-v4.1-flash',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.0021,
      }
    }
    let checks = 0
    const verify = async (): Promise<CheckResult> => {
      checks += 1
      return { ok: checks > 1, output: 'typecheck failed' }
    }

    const fake = fakeOctokit(happyRoutes())
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      issueNumber: 4,
      generate,
      verify,
    })

    expect(calls).toBe(1 + MAX_REPAIRS)
    const put = fake.calls.find((call) => call.route === PUT_CONTENT)
    expect(decoded(put?.params['content'])).toContain('export const intake = 2')
    // Both model calls are charged to the requirement, not just the first.
    expect(events[0]?.costUsd).toBeCloseTo(0.0042, 6)
  })

  test('updates the pull request that already exists instead of opening a second one', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_PULLS]: () => [{ number: 31 }],
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      issueNumber: 4,
      generate: generate(patchText),
      verify: passingVerify,
    })

    expect(fake.calls.some((call) => call.route === CREATE_PR)).toBe(false)
    const patch = fake.calls.find((call) => call.route === PATCH_PR)
    expect(patch?.params['pull_number']).toBe(31)
    expect(events.map((event) => event.action)).toEqual(['issue.claimed', 'pr.updated'])
    expect(events[1]?.artifact).toBe('31')
  })

  test('the pull request body carries the self-check verdict either way', async () => {
    const clean = fakeOctokit(happyRoutes())
    await handler({ ...runBase, octokit: asOctokit(clean) }, {
      issueNumber: 4,
      generate: generate(patchText),
      verify: passingVerify,
    })
    const opened = clean.calls.find((call) => call.route === CREATE_PR)
    expect(String(opened?.params['body'])).toContain('passed locally')

    const dirty = fakeOctokit(happyRoutes())
    await handler({ ...runBase, octokit: asOctokit(dirty) }, {
      issueNumber: 4,
      generate: generate(patchText),
      verify: failingVerify,
    })
    const body = String(dirty.calls.find((call) => call.route === CREATE_PR)?.params['body'])
    expect(body).toContain('## Self-check')
    expect(body).toContain('typecheck failed')
  })
})
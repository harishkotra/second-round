import { describe, expect, test } from 'vitest'
import {
  buildPrompt,
  buildPrBody,
  fetchIssue,
  handler,
  issueRequirementId,
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
const GET_CONTENT = 'GET /repos/{owner}/{repo}/contents/{path}'
const PUT_CONTENT = 'PUT /repos/{owner}/{repo}/contents/{path}'
const CREATE_PR = 'POST /repos/{owner}/{repo}/pulls'

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
})

describe('handler', () => {
  test('opens one pull request naming the requirement, and records both events', async () => {
    const fake = fakeOctokit(happyRoutes())
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, { issueNumber: 4, generate: generate(patchText) })

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
      }),
    ).rejects.toThrow(/HTTP 500/)
  })
})
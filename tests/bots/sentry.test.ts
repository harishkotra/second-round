import { describe, expect, test } from 'vitest'
import {
  buildReviewPrompt,
  handler,
  nonGoalViolation,
  parseVerdict,
  reviewEvent,
  SLUG,
} from '../../src/bots/sentry.js'
import type { PullRequestView } from '../../src/bot/repo.js'
import { asOctokit, fakeOctokit, type RouteHandler } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}'
const GET_FILES = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files'
const POST_REVIEW = 'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews'

const view: PullRequestView = {
  number: 12,
  title: '[R-001] Accept a pasted job description',
  body: 'Closes R-001',
  headSha: 'sha',
  baseBranch: 'main',
  mergeableState: 'clean',
  files: [{ path: 'src/app/intake.ts', patch: '+export const intake = true' }],
}

const runBase = {
  slug: SLUG,
  repo: ctx,
  persona: '# a persona',
  dryRun: false,
  history: [],
  log: () => undefined,
}

function routes(title = view.title, body = view.body): Record<string, RouteHandler> {
  return {
    [GET_PR]: () => ({
      number: 12,
      title,
      body,
      head: { sha: 'sha' },
      base: { ref: 'main' },
    }),
    [GET_FILES]: () => [{ filename: 'src/app/intake.ts', patch: '+export const intake = true' }],
    [POST_REVIEW]: () => ({}),
  }
}

function generate(text: string): () => Promise<{
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}> {
  return async () => ({
    text,
    model: 'm',
    inputTokens: 10,
    outputTokens: 10,
    costUsd: 0.001,
  })
}

describe('parseVerdict', () => {
  test('reads an approval', () => {
    expect(parseVerdict('{"verdict":"approved","reason":null,"findings":[]}')).toEqual({
      verdict: 'approved',
      reason: null,
      findings: [],
    })
  })

  test('reads a rejection with findings', () => {
    const verdict = parseVerdict(
      '{"verdict":"rejected","reason":"R-001","findings":["src/a.ts:1 no test for new behaviour"]}',
    )
    expect(verdict.verdict).toBe('rejected')
    expect(verdict.findings).toEqual(['src/a.ts:1 no test for new behaviour'])
  })

  test('ignores blank findings rather than emitting empty bullets', () => {
    expect(parseVerdict('{"verdict":"approved","findings":["","  "]}').findings).toEqual([])
  })

  test('rejects an unknown verdict', () => {
    expect(() => parseVerdict('{"verdict":"maybe"}')).toThrow(/approved/)
  })

  test('throws when there is no JSON at all', () => {
    expect(() => parseVerdict('looks good to me')).toThrow(/no JSON/)
  })
})

describe('reviewEvent', () => {
  test('maps to real GitHub review states, not comments', () => {
    expect(reviewEvent('approved')).toBe('APPROVE')
    expect(reviewEvent('rejected')).toBe('REQUEST_CHANGES')
  })
})

describe('nonGoalViolation', () => {
  const nonGoals = [{ id: 'NG-01', text: 'Not a resume builder.', matchTerms: ['resume builder'] }]

  test('catches a non-goal named in the title', () => {
    expect(nonGoalViolation({ ...view, title: 'Add a resume builder' }, nonGoals)?.id).toBe('NG-01')
  })

  test('null when nothing matches', () => {
    expect(nonGoalViolation(view, nonGoals)).toBeNull()
  })
})

describe('buildReviewPrompt', () => {
  test('includes the requirement, the diff, and the JSON contract', () => {
    const prompt = buildReviewPrompt({ id: 'R-001', phase: 0, text: 'Accept a pasted JD' }, view)
    expect(prompt).toContain('R-001')
    expect(prompt).toContain('+export const intake = true')
    expect(prompt).toContain('Return ONLY a JSON object')
  })
})

describe('handler', () => {
  test('submits a real review and records the verdict with its reason', async () => {
    const fake = fakeOctokit(routes())
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      pullNumber: 12,
      generate: generate(
        '{"verdict":"rejected","reason":"R-001","findings":["no test for the new behaviour"]}',
      ),
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('pr.reviewed')
    expect(events[0]?.verdict).toBe('rejected')
    expect(events[0]?.reason).toBe('R-001')

    const review = fake.calls.find((call) => call.route === POST_REVIEW)
    expect(review?.params['event']).toBe('REQUEST_CHANGES')
    expect(String(review?.params['body'])).toContain('no test for the new behaviour')
  })

  test('an approval records no reason', async () => {
    const fake = fakeOctokit(routes())
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      pullNumber: 12,
      generate: generate('{"verdict":"approved","reason":null,"findings":[]}'),
    })
    expect(events[0]?.verdict).toBe('approved')
    expect(events[0]?.reason).toBeNull()
    expect(fake.calls.find((call) => call.route === POST_REVIEW)?.params['event']).toBe('APPROVE')
  })

  test('a non-goal is rejected in code, without asking the model', async () => {
    const fake = fakeOctokit(routes('Add a resume builder', 'Closes R-001'))
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      pullNumber: 12,
      generate: async () => {
        throw new Error('the model must not be consulted about a non-goal')
      },
    })
    expect(events[0]?.verdict).toBe('rejected')
    expect(events[0]?.reason).toBe('NG-01')
    expect(fake.calls.find((call) => call.route === POST_REVIEW)?.params['event']).toBe(
      'REQUEST_CHANGES',
    )
  })

  test('refuses a pull request that names no requirement', async () => {
    const fake = fakeOctokit(routes('something', 'no reference here'))
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      pullNumber: 12,
      generate: async () => {
        throw new Error('the model must not be called here')
      },
    })
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === POST_REVIEW)).toBe(false)
  })

  test('a dry run submits no review', async () => {
    const fake = fakeOctokit({
      [GET_PR]: routes()[GET_PR]!,
      [GET_FILES]: routes()[GET_FILES]!,
    })
    const events = await handler(
      { ...runBase, octokit: asOctokit(fake), dryRun: true },
      {
        pullNumber: 12,
        generate: async () => {
          throw new Error('the model must not be called in a dry run')
        },
      },
    )
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === POST_REVIEW)).toBe(false)
  })
})
import { describe, expect, test } from 'vitest'
import { handler, openRequirementIds, planMilestone, SLUG, type OpenIssue } from '../../src/bots/foreman.js'
import { loadRequirements, type Requirement } from '../../src/spec/load.js'
import { asOctokit, fakeOctokit } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const LIST = 'GET /repos/{owner}/{repo}/issues'
const CREATE = 'POST /repos/{owner}/{repo}/issues'

const requirements: Requirement[] = [
  { id: 'R-001', phase: 0, text: 'Accept a job description' },
  { id: 'R-018', phase: 3, text: 'Voice mode' },
  { id: 'C-007', phase: 0, text: 'Merge gates' },
]

describe('openRequirementIds', () => {
  test('reads ids from both the title and the body', () => {
    const issues: OpenIssue[] = [
      { title: '[R-001] Accept a job description', body: null },
      { title: 'something else', body: 'Closes C-007' },
      { title: 'no id here', body: 'nothing to see' },
    ]
    expect([...openRequirementIds(issues)].sort()).toEqual(['C-007', 'R-001'])
  })

  test('an empty issue list has no ids', () => {
    expect(openRequirementIds([]).size).toBe(0)
  })
})

describe('planMilestone', () => {
  test('one issue per unmet requirement', () => {
    expect(planMilestone(requirements, new Set(['R-001'])).map((draft) => draft.req)).toEqual([
      'R-018',
      'C-007',
    ])
  })

  test('the body keeps the requirement traceable', () => {
    const draft = planMilestone([requirements[0]!], new Set())[0]
    expect(draft?.body).toContain('Closes R-001')
    expect(draft?.title).toContain('[R-001]')
    expect(draft?.labels).toContain('phase-0')
  })

  test('can be limited to a single phase', () => {
    expect(planMilestone(requirements, new Set(), 0).map((draft) => draft.req)).toEqual([
      'R-001',
      'C-007',
    ])
  })

  test('nothing to do when everything is already open', () => {
    expect(planMilestone(requirements, new Set(['R-001', 'R-018', 'C-007']))).toEqual([])
  })
})

describe('handler', () => {
  const runBase = {
    slug: SLUG,
    repo: ctx,
    persona: '# a persona',
    dryRun: false,
    history: [],
    log: () => undefined,
  }

  test('opens one issue per unmet requirement and records each', async () => {
    const requirementsInSpec = await loadRequirements()
    const alreadyOpen: OpenIssue[] = requirementsInSpec
      .slice(0, 5)
      .map((requirement) => ({ title: `[${requirement.id}] x`, body: null }))

    const fake = fakeOctokit({
      [LIST]: () => alreadyOpen,
      [CREATE]: () => ({ number: 100 }),
    })

    const events = await handler({ ...runBase, octokit: asOctokit(fake) })
    expect(events).toHaveLength(requirementsInSpec.length - 5)
    expect(events[0]?.action).toBe('issue.opened')
    expect(fake.calls.filter((call) => call.route === CREATE)).toHaveLength(
      requirementsInSpec.length - 5,
    )
  })

  test('does nothing when every requirement already has an issue', async () => {
    const requirementsInSpec = await loadRequirements()
    const fake = fakeOctokit({
      [LIST]: () =>
        requirementsInSpec.map((requirement) => ({
          title: `[${requirement.id}] x`,
          body: null,
        })),
    })
    expect(await handler({ ...runBase, octokit: asOctokit(fake) })).toEqual([])
    expect(fake.calls.filter((call) => call.route === CREATE)).toHaveLength(0)
  })

  test('a dry run reports the plan without creating anything', async () => {
    const lines: string[] = []
    const fake = fakeOctokit({ [LIST]: () => [] })
    const events = await handler({
      ...runBase,
      dryRun: true,
      octokit: asOctokit(fake),
      log: (message) => lines.push(message),
    })
    expect(events).toEqual([])
    expect(fake.calls.filter((call) => call.route === CREATE)).toHaveLength(0)
    expect(lines.some((line) => line.includes('would open'))).toBe(true)
  })
})
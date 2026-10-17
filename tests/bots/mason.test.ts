import { describe, expect, test } from 'vitest'
import {
  buildPrompt,
  buildPrBody,
  buildRepairPrompt,
  fetchIssue,
  issueRequirementId,
  planImplementation,
  readNotes,
} from '../../src/bots/mason.js'
import { asOctokit, fakeOctokit } from '../helpers/fake-octokit.js'
import { ctx, GET_ISSUE, patchText, requirement } from '../helpers/mason-fixtures.js'

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

  test('states the self-check verdict when there is one', () => {
    const body = buildPrBody(requirement, 4, '', { ok: true, output: '' })
    expect(body).toContain('## Self-check')
    expect(body).toContain('passed locally')
  })

  test('shows the failure rather than hiding it', () => {
    const body = buildPrBody(requirement, 4, '', { ok: false, output: 'typecheck exploded' })
    expect(body).toContain('typecheck exploded')
    expect(body).toContain('rather than hidden')
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
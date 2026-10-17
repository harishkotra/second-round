import { describe, expect, test } from 'vitest'
import {
  dispatchWorkflow,
  ensureLabel,
  listWorkflowRuns,
  openIssue,
  statusOf,
} from '../../src/bot/ops.js'
import { asOctokit, fakeOctokit, httpError } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_RUNS = 'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs'
const DISPATCH = 'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches'
const CREATE_LABEL = 'POST /repos/{owner}/{repo}/labels'
const CREATE_ISSUE = 'POST /repos/{owner}/{repo}/issues'

describe('listWorkflowRuns', () => {
  test('keeps only the conclusion and the time, newest first as GitHub sends them', async () => {
    const fake = fakeOctokit({
      [GET_RUNS]: () => ({
        workflow_runs: [
          { conclusion: 'failure', created_at: '2026-10-10T13:00:00Z', id: 1 },
          { conclusion: null, created_at: '2026-10-10T12:00:00Z', id: 2 },
        ],
      }),
    })

    expect(await listWorkflowRuns(asOctokit(fake), ctx, 'mason.yml')).toEqual([
      { conclusion: 'failure', createdAt: '2026-10-10T13:00:00Z' },
      { conclusion: null, createdAt: '2026-10-10T12:00:00Z' },
    ])
    expect(fake.calls[0]?.params['workflow_id']).toBe('mason.yml')
  })
})

describe('dispatchWorkflow', () => {
  test('asks the workflow to run on main', async () => {
    const fake = fakeOctokit({ [DISPATCH]: () => ({}) })
    await dispatchWorkflow(asOctokit(fake), ctx, 'mason.yml')
    expect(fake.calls[0]?.params).toMatchObject({ workflow_id: 'mason.yml', ref: 'main' })
  })
})

describe('ensureLabel', () => {
  test('creates the label', async () => {
    const fake = fakeOctokit({ [CREATE_LABEL]: () => ({}) })
    await ensureLabel(asOctokit(fake), ctx, 'crew-stalled', 'b60205', 'needs a person')
    expect(fake.calls[0]?.params).toMatchObject({ name: 'crew-stalled', color: 'b60205' })
  })

  test('tolerates a label that already exists', async () => {
    const fake = fakeOctokit({
      [CREATE_LABEL]: () => {
        throw httpError(422)
      },
    })
    await expect(
      ensureLabel(asOctokit(fake), ctx, 'crew-stalled', 'b60205', 'needs a person'),
    ).resolves.toBeUndefined()
  })

  test('does not swallow a real failure', async () => {
    const fake = fakeOctokit({
      [CREATE_LABEL]: () => {
        throw httpError(403)
      },
    })
    await expect(
      ensureLabel(asOctokit(fake), ctx, 'crew-stalled', 'b60205', 'needs a person'),
    ).rejects.toThrow(/403/)
  })
})

describe('openIssue', () => {
  test('returns the new issue number and carries the label', async () => {
    const fake = fakeOctokit({ [CREATE_ISSUE]: () => ({ number: 77 }) })
    const number = await openIssue(asOctokit(fake), ctx, {
      title: 'The crew is stalled',
      body: 'mason.yml has failed three times',
      labels: ['crew-stalled'],
    })
    expect(number).toBe(77)
    expect(fake.calls[0]?.params['labels']).toEqual(['crew-stalled'])
  })
})

describe('statusOf', () => {
  test('reads the status off an octokit error', () => {
    expect(statusOf(httpError(422))).toBe(422)
  })

  test('null for anything else', () => {
    expect(statusOf(new Error('nope'))).toBeNull()
    expect(statusOf(null)).toBeNull()
    expect(statusOf({ status: 'not a number' })).toBeNull()
  })
})
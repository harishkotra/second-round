/**
 * Mason's handler: picking work, claiming it, building it, and opening or
 * updating the pull request.
 *
 * Separated from the pure-function tests because this is the integration path,
 * and it needs the routes and the injected self-check that the pure tests do not.
 */

import { describe, expect, test } from 'vitest'
import type { CheckResult } from '../../src/bot/verify.js'
import { handler, MAX_REPAIRS } from '../../src/bots/mason.js'
import { asOctokit, decoded, fakeOctokit } from '../helpers/fake-octokit.js'
import {
  ADD_LABELS,
  CREATE_PR,
  failingVerify,
  generate,
  GET_BRANCH,
  GET_CONTENT,
  GET_ISSUE,
  GET_ISSUES,
  GET_PULLS,
  GET_REPO,
  GET_TREE,
  happyRoutes,
  PATCH_PR,
  passingVerify,
  patchText,
  PUT_CONTENT,
  REMOVE_LABEL,
  runBase,
} from '../helpers/mason-fixtures.js'

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

  test('a named dry run creates nothing and calls no model', async () => {
    const routes = happyRoutes()
    const fake = fakeOctokit({
      [GET_ISSUE]: routes[GET_ISSUE]!,
      [GET_REPO]: routes[GET_REPO]!,
      [GET_TREE]: routes[GET_TREE]!,
      // The handler reads the merger's ledger for what already shipped, so even
      // a dry run needs the contents route to answer.
      [GET_CONTENT]: routes[GET_CONTENT]!,
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

  test('with no issue named it takes the next ready one and claims it', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_ISSUES]: () => [
        {
          number: 4,
          title: '[R-001] Accept a pasted job description',
          labels: ['ready', 'phase-0'],
        },
      ],
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      generate: generate(patchText),
      verify: passingVerify,
    })

    const added = fake.calls.find((call) => call.route === ADD_LABELS)
    expect(added?.params['labels']).toEqual(['claimed:sr-mason'])
    expect(events[0]?.action).toBe('issue.claimed')
    expect(events[0]?.artifact).toBe('4')
    expect(events[1]?.action).toBe('pr.opened')
  })

  test('a dry run claims nothing and calls no model', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_ISSUES]: () => [
        {
          number: 4,
          title: '[R-001] Accept a pasted job description',
          labels: ['ready', 'phase-0'],
        },
      ],
    })
    const events = await handler(
      { ...runBase, octokit: asOctokit(fake), dryRun: true },
      {
        generate: async () => {
          throw new Error('the model must not be called in a dry run')
        },
      },
    )
    expect(events).toEqual([])
    expect(fake.calls.some((call) => call.route === ADD_LABELS)).toBe(false)
  })

  test('an empty queue is not an error', async () => {
    const fake = fakeOctokit({ ...happyRoutes(), [GET_ISSUES]: () => [] })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      generate: async () => {
        throw new Error('the model must not be called when there is nothing to build')
      },
    })
    expect(events).toEqual([])
  })

  test('gives the lease back when the issue turns out to be unusable', async () => {
    const fake = fakeOctokit({
      ...happyRoutes(),
      [GET_ISSUES]: () => [
        { number: 9, title: 'a random idea', labels: ['ready', 'phase-0'] },
      ],
      [GET_ISSUE]: () => ({ title: 'a random idea', body: '', labels: [] }),
    })
    const events = await handler({ ...runBase, octokit: asOctokit(fake) }, {
      generate: async () => {
        throw new Error('the model must not be called here')
      },
    })
    expect(events).toEqual([])
    // Claimed, then handed straight back: a bot must not sit on work it cannot do.
    expect(fake.calls.some((call) => call.route === ADD_LABELS)).toBe(true)
    const released = fake.calls.find((call) => call.route === REMOVE_LABEL)
    expect(released?.params['name']).toBe('claimed:sr-mason')
  })
})
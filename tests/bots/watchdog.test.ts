import { describe, expect, test } from 'vitest'
import type { RunSummary } from '../../src/bot/ops.js'
import type { BotRun } from '../../src/bot/run.js'
import {
  consecutiveFailures,
  diagnose,
  handler,
  hoursSince,
  lastByArtifact,
  latestEventAt,
  workflowFor,
  type BotHealth,
  type WatchInput,
} from '../../src/bots/watchdog.js'
import { makeEvent, type LedgerEvent } from '../../src/ledger/schema.js'

const ctx = { owner: 'o', repo: 'r' }
const NOW = new Date('2026-10-10T13:30:00.000Z')

function runs(...conclusions: (string | null)[]): RunSummary[] {
  return conclusions.map((conclusion, index) => ({
    conclusion,
    createdAt: `2026-10-10T${String(13 - index).padStart(2, '0')}:00:00Z`,
  }))
}

function health(bot: BotHealth['bot'], ...conclusions: (string | null)[]): BotHealth {
  return { bot, workflow: workflowFor(bot), runs: runs(...conclusions) }
}

function input(overrides: Partial<WatchInput> = {}): WatchInput {
  return {
    bots: [health('sr-mason', 'success')],
    lastEventAt: '2026-10-10T13:29:00.000Z',
    readyUnclaimed: 5,
    retriedFor: {},
    escalatedFor: {},
    now: NOW,
    ...overrides,
  }
}

function runBase(history: LedgerEvent[] = []): Omit<BotRun, 'octokit'> {
  return {
    slug: 'sr-watchdog',
    repo: ctx,
    persona: '',
    dryRun: false,
    history,
    log: () => undefined,
  }
}

describe('consecutiveFailures', () => {
  test('zero when the newest run succeeded', () => {
    expect(consecutiveFailures(runs('success', 'failure', 'failure'))).toBe(0)
  })

  test('counts back until a run that did not fail', () => {
    expect(consecutiveFailures(runs('failure', 'timed_out', 'success'))).toBe(2)
  })

  test('counts a cancelled run as no failure, since the next attempt supersedes it', () => {
    expect(consecutiveFailures(runs('cancelled', 'failure'))).toBe(0)
  })
})

describe('hoursSince', () => {
  test('infinite when there is nothing to measure from', () => {
    expect(hoursSince(null, NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(hoursSince(undefined, NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(hoursSince('not a date', NOW)).toBe(Number.POSITIVE_INFINITY)
  })

  test('hours between then and now', () => {
    expect(hoursSince('2026-10-10T11:30:00.000Z', NOW)).toBeCloseTo(2)
  })
})

describe('workflowFor', () => {
  test('derives the workflow file from the slug', () => {
    expect(workflowFor('sr-mason')).toBe('mason.yml')
  })
})

describe('diagnose', () => {
  test('a healthy crew needs nothing', () => {
    expect(diagnose(input())).toEqual([])
  })

  test('retries an agent whose last run failed', () => {
    const found = diagnose(input({ bots: [health('sr-mason', 'failure')] }))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'dispatch', workflow: 'mason.yml', bot: 'sr-mason' })
  })

  test('does not retry an agent it retried within the hour', () => {
    const found = diagnose(
      input({
        bots: [health('sr-mason', 'failure')],
        retriedFor: { 'sr-mason': '2026-10-10T13:10:00.000Z' },
      }),
    )
    expect(found).toEqual([])
  })

  test('retries again once the cooldown has passed', () => {
    const found = diagnose(
      input({
        bots: [health('sr-mason', 'failure')],
        retriedFor: { 'sr-mason': '2026-10-10T11:00:00.000Z' },
      }),
    )
    expect(found).toHaveLength(1)
  })

  test('escalates instead of retrying once an agent has failed three in a row', () => {
    const found = diagnose(
      input({ bots: [health('sr-mason', 'failure', 'failure', 'failure')] }),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.kind).toBe('escalate')
    expect(found[0]).toMatchObject({ bot: 'sr-mason' })
  })

  test('the escalation names the agent, the count, and the workflow', () => {
    const found = diagnose(
      input({ bots: [health('sr-mason', 'failure', 'failure', 'failure')] }),
    )
    const first = found[0]
    if (first?.kind !== 'escalate') throw new Error('expected an escalation')
    expect(first.title).toContain('sr-mason')
    expect(first.title).toContain('3 runs')
    expect(first.body).toContain('mason.yml')
  })

  test('does not escalate the same agent twice within the cooldown', () => {
    const found = diagnose(
      input({
        bots: [health('sr-mason', 'failure', 'failure', 'failure')],
        escalatedFor: { 'sr-mason': '2026-10-10T12:00:00.000Z' },
      }),
    )
    expect(found).toEqual([])
  })

  test('nudges the builder when nothing has happened for hours and work is waiting', () => {
    const found = diagnose(input({ lastEventAt: '2026-10-10T09:00:00.000Z' }))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'dispatch', workflow: 'mason.yml' })
  })

  test('stays quiet when the loop is silent but nothing is waiting', () => {
    const found = diagnose(
      input({ lastEventAt: '2026-10-10T09:00:00.000Z', readyUnclaimed: 0 }),
    )
    expect(found).toEqual([])
  })

  test('stays quiet when the loop is silent but only recently so', () => {
    const found = diagnose(input({ lastEventAt: '2026-10-10T12:30:00.000Z' }))
    expect(found).toEqual([])
  })

  test('a broken agent is reported even when the loop is also silent', () => {
    const found = diagnose(
      input({
        bots: [health('sr-mason', 'failure'), health('sr-sentry', 'success')],
        lastEventAt: '2026-10-10T05:00:00.000Z',
      }),
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ bot: 'sr-mason' })
  })
})

describe('latestEventAt', () => {
  test('the newest timestamp, whichever bot wrote it', () => {
    const events = [
      makeEvent({ bot: 'sr-mason', action: 'issue.claimed', ts: '2026-10-10T10:00:00.000Z' }),
      makeEvent({ bot: 'sr-sentry', action: 'pr.reviewed', ts: '2026-10-10T12:00:00.000Z' }),
      makeEvent({ bot: 'sr-turnstile', action: 'pr.merged', ts: '2026-10-10T11:00:00.000Z' }),
    ]
    expect(latestEventAt(events)).toBe('2026-10-10T12:00:00.000Z')
  })

  test('null for an empty ledger', () => {
    expect(latestEventAt([])).toBeNull()
  })
})

describe('lastByArtifact', () => {
  test('the newest mention of each artifact', () => {
    const events = [
      makeEvent({
        bot: 'sr-watchdog',
        action: 'stall.retried',
        artifact: 'sr-mason',
        ts: '2026-10-10T10:00:00.000Z',
      }),
      makeEvent({
        bot: 'sr-watchdog',
        action: 'stall.retried',
        artifact: 'sr-mason',
        ts: '2026-10-10T12:00:00.000Z',
      }),
      makeEvent({
        bot: 'sr-watchdog',
        action: 'stall.retried',
        artifact: 'sr-sentry',
        ts: '2026-10-10T11:00:00.000Z',
      }),
    ]
    expect(lastByArtifact(events, 'stall.retried')).toEqual({
      'sr-mason': '2026-10-10T12:00:00.000Z',
      'sr-sentry': '2026-10-10T11:00:00.000Z',
    })
  })
})

describe('handler', () => {
  const healthyDeps = {
    listRuns: async (): Promise<RunSummary[]> => runs('success'),
    dispatch: async (): Promise<void> => undefined,
    escalate: async (): Promise<number> => 99,
    readyUnclaimed: async (): Promise<number> => 5,
    crewEvents: async (): Promise<LedgerEvent[]> => [
      makeEvent({ bot: 'sr-mason', action: 'issue.claimed', ts: '2026-10-10T13:29:00.000Z' }),
    ],
    now: NOW,
  }

  test('records nothing while the crew is running', async () => {
    const events = await handler(runBase() as BotRun, healthyDeps)
    expect(events).toEqual([])
  })

  test('dispatches a failed agent and records what it saw', async () => {
    const dispatched: string[] = []
    const events = await handler(runBase() as BotRun, {
      ...healthyDeps,
      listRuns: async (workflow: string) =>
        workflow === 'mason.yml' ? runs('failure') : runs('success'),
      dispatch: async (workflow: string) => {
        dispatched.push(workflow)
      },
    })

    expect(dispatched).toEqual(['mason.yml'])
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('stall.retried')
    expect(events[0]?.artifact).toBe('sr-mason')
    expect(events[0]?.reason).toContain('failure')
  })

  test('escalates when retrying has not helped, and records the issue', async () => {
    const events = await handler(runBase() as BotRun, {
      ...healthyDeps,
      listRuns: async (workflow: string) =>
        workflow === 'mason.yml' ? runs('failure', 'failure', 'failure') : runs('success'),
      escalate: async (): Promise<number> => 41,
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('stall.escalated')
    expect(events[0]?.reason).toContain('#41')
  })

  test('a retry it already recorded this hour is not repeated', async () => {
    const history = [
      makeEvent({
        bot: 'sr-watchdog',
        action: 'stall.retried',
        artifact: 'sr-mason',
        ts: '2026-10-10T13:10:00.000Z',
      }),
    ]
    const events = await handler(runBase(history) as BotRun, {
      ...healthyDeps,
      listRuns: async (workflow: string) =>
        workflow === 'mason.yml' ? runs('failure') : runs('success'),
    })
    expect(events).toEqual([])
  })
})
import { describe, expect, test } from 'vitest'
import { computeHealth, median } from '../../src/ledger/health.js'
import { makeEvent, type LedgerEvent } from '../../src/ledger/schema.js'

function fixture(): LedgerEvent[] {
  return [
    makeEvent({
      ts: '2026-10-01T00:00:00Z',
      bot: 'sr-foreman',
      action: 'issue.opened',
      req: 'R-004',
      artifact: '1',
    }),
    makeEvent({
      ts: '2026-10-01T00:04:00Z',
      bot: 'sr-mason',
      action: 'issue.responded',
      artifact: '1',
    }),
    makeEvent({
      ts: '2026-10-01T00:10:00Z',
      bot: 'sr-mason',
      action: 'pr.opened',
      req: 'R-004',
      artifact: '2',
      costUsd: 0.02,
    }),
    makeEvent({
      ts: '2026-10-01T00:12:00Z',
      bot: 'sr-sentry',
      action: 'pr.reviewed',
      verdict: 'rejected',
      reason: 'NG-04',
      costUsd: 0.01,
    }),
    makeEvent({
      ts: '2026-10-01T00:20:00Z',
      bot: 'sr-sentry',
      action: 'pr.reviewed',
      verdict: 'approved',
      costUsd: 0.01,
    }),
    makeEvent({
      ts: '2026-10-01T00:21:00Z',
      bot: 'sr-turnstile',
      action: 'pr.merged',
      artifact: '2',
    }),
  ]
}

describe('median', () => {
  test('returns null for an empty list', () => {
    expect(median([])).toBeNull()
  })

  test('returns the middle of an odd list', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  test('averages the middle of an even list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('computeHealth', () => {
  test('an empty ledger produces zeros rather than throwing', () => {
    const health = computeHealth([])
    expect(health.mergedPrs).toBe(0)
    expect(health.totalCostUsd).toBe(0)
    expect(health.costPerMergedPr).toBeNull()
    expect(health.humanTouchRate).toBeNull()
    expect(health.medianTimeToFirstResponseMs).toBeNull()
    expect(health.perBot).toEqual([])
    expect(health.rejectionReasons).toEqual({})
  })

  test('counts per bot and totals the cost', () => {
    const health = computeHealth(fixture())
    const sentry = health.perBot.find((bot) => bot.bot === 'sr-sentry')
    expect(sentry?.reviewed).toBe(2)
    expect(sentry?.rejected).toBe(1)
    expect(health.totalCostUsd).toBeCloseTo(0.04, 6)
    expect(health.mergedPrs).toBe(1)
  })

  test('records rejection reasons, which is the proof they actually disagree', () => {
    expect(computeHealth(fixture()).rejectionReasons).toEqual({ 'NG-04': 1 })
  })

  test('cost per merged pull request', () => {
    expect(computeHealth(fixture()).costPerMergedPr).toBeCloseTo(0.04, 6)
  })

  test('time to first response is the gap between opening and responding', () => {
    expect(computeHealth(fixture()).medianTimeToFirstResponseMs).toBe(4 * 60 * 1000)
  })

  test('a response with no matching opened issue is ignored rather than miscounted', () => {
    const health = computeHealth([
      makeEvent({ ts: '2026-10-01T00:00:00Z', bot: 'sr-mason', action: 'issue.responded', artifact: '99' }),
    ])
    expect(health.medianTimeToFirstResponseMs).toBeNull()
  })

  test('human touch rate needs merges to mean anything', () => {
    expect(computeHealth(fixture()).humanTouchRate).toBe(0)
    const withHuman = computeHealth([
      ...fixture(),
      makeEvent({ ts: '2026-10-01T00:22:00Z', bot: 'sr-turnstile', action: 'pr.human_approved' }),
    ])
    expect(withHuman.humanTouchRate).toBe(1)
  })

  test('blocked reviews count separately from rejections', () => {
    const health = computeHealth([
      makeEvent({
        ts: '2026-10-01T00:00:00Z',
        bot: 'sr-curator',
        action: 'pr.reviewed',
        verdict: 'blocked',
        reason: 'slop',
      }),
    ])
    expect(health.blockedPrs).toBe(1)
    expect(health.rejectedPrs).toBe(0)
    expect(health.rejectionReasons).toEqual({ slop: 1 })
  })

  test('a rejection with no reason code is recorded as unspecified', () => {
    const health = computeHealth([
      makeEvent({
        ts: '2026-10-01T00:00:00Z',
        bot: 'sr-sentry',
        action: 'pr.reviewed',
        verdict: 'rejected',
      }),
    ])
    expect(health.rejectionReasons).toEqual({ unspecified: 1 })
  })
})
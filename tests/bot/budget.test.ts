import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DAILY_CAP_USD,
  dailyCapUsd,
  estimateCostUsd,
  hasBudget,
  spendToday,
  utcDay,
} from '../../src/bot/budget.js'
import { makeEvent } from '../../src/ledger/schema.js'

const now = new Date('2026-10-10T12:00:00Z')

const events = [
  makeEvent({ ts: '2026-10-10T01:00:00Z', bot: 'sr-mason', action: 'pr.opened', costUsd: 0.3 }),
  makeEvent({ ts: '2026-10-10T02:00:00Z', bot: 'sr-mason', action: 'pr.opened', costUsd: 0.25 }),
  makeEvent({ ts: '2026-10-09T02:00:00Z', bot: 'sr-mason', action: 'pr.opened', costUsd: 5 }),
  makeEvent({ ts: '2026-10-10T02:00:00Z', bot: 'sr-sentry', action: 'pr.reviewed', costUsd: 0.9 }),
]

describe('spendToday', () => {
  test('sums only today, and only for this bot', () => {
    expect(spendToday(events, 'sr-mason', now)).toBeCloseTo(0.55, 6)
  })

  test('a different day is not today', () => {
    expect(spendToday(events, 'sr-mason', new Date('2026-10-09T23:00:00Z'))).toBeCloseTo(5, 6)
  })
})

describe('hasBudget', () => {
  test('false once the cap is reached', () => {
    expect(hasBudget(events, 'sr-mason', 0.5, now)).toBe(false)
  })

  test('true while there is room', () => {
    expect(hasBudget(events, 'sr-mason', 1, now)).toBe(true)
  })
})

describe('dailyCapUsd', () => {
  test('defaults when unset', () => {
    expect(dailyCapUsd({})).toBe(DEFAULT_DAILY_CAP_USD)
  })

  test('reads the override', () => {
    expect(dailyCapUsd({ BOT_DAILY_CAP_USD: '2.5' })).toBe(2.5)
  })

  test('rejects nonsense rather than silently defaulting', () => {
    expect(() => dailyCapUsd({ BOT_DAILY_CAP_USD: 'lots' })).toThrow(/non-negative/)
  })

  test('rejects a negative cap', () => {
    expect(() => dailyCapUsd({ BOT_DAILY_CAP_USD: '-1' })).toThrow(/non-negative/)
  })
})

describe('utcDay', () => {
  test('is the UTC date, not the local one', () => {
    expect(utcDay(new Date('2026-10-10T23:30:00Z'))).toBe('2026-10-10')
  })
})

describe('estimateCostUsd', () => {
  test('uses the configured rates', () => {
    const cost = estimateCostUsd(1_000_000, 1_000_000, {
      MODEL_PRICE_IN_PER_MTOK: '1',
      MODEL_PRICE_OUT_PER_MTOK: '2',
    })
    expect(cost).toBeCloseTo(3, 6)
  })

  test('rejects a non-numeric rate instead of producing NaN', () => {
    expect(() => estimateCostUsd(1, 1, { MODEL_PRICE_IN_PER_MTOK: 'free' })).toThrow(
      /must be numbers/,
    )
  })
})
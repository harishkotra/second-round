/**
 * Spend caps (C-010).
 *
 * A crew that can loop is a crew that can rack up cost. Each bot has a daily
 * budget in USD, computed from the ledger, and exceeding it pauses that bot
 * rather than failing it.
 */

import type { LedgerEvent } from '../ledger/schema.js'

export const DEFAULT_DAILY_CAP_USD = 0.5

export function dailyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['BOT_DAILY_CAP_USD']
  if (raw === undefined || raw === '') return DEFAULT_DAILY_CAP_USD
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`BOT_DAILY_CAP_USD must be a non-negative number, got "${raw}"`)
  }
  return parsed
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function spendToday(events: LedgerEvent[], bot: string, now: Date): number {
  const day = utcDay(now)
  let total = 0
  for (const event of events) {
    if (event.bot !== bot) continue
    if (utcDay(new Date(event.ts)) !== day) continue
    total += event.costUsd
  }
  return total
}

export function hasBudget(
  events: LedgerEvent[],
  bot: string,
  capUsd: number,
  now: Date,
): boolean {
  return spendToday(events, bot, now) < capUsd
}

/**
 * Estimates cost from token usage. This is an estimate from configured rates,
 * not a billed figure, and it is labelled as such wherever it is shown.
 */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const inRate = Number(env['MODEL_PRICE_IN_PER_MTOK'] ?? '0.15')
  const outRate = Number(env['MODEL_PRICE_OUT_PER_MTOK'] ?? '0.60')
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate)) {
    throw new Error('MODEL_PRICE_IN_PER_MTOK and MODEL_PRICE_OUT_PER_MTOK must be numbers')
  }
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate
}
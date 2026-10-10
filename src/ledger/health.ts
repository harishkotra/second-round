/**
 * The health board.
 *
 * Every number here is derived from the ledger. Nothing is self-reported, and
 * an empty ledger produces zeros rather than throwing.
 */

import type { LedgerEvent } from './schema.js'

export type BotStats = {
  bot: string
  opened: number
  claimed: number
  responded: number
  reviewed: number
  merged: number
  rejected: number
  blocked: number
  costUsd: number
}

export type Health = {
  perBot: BotStats[]
  mergedPrs: number
  rejectedPrs: number
  blockedPrs: number
  rejectionReasons: Record<string, number>
  totalCostUsd: number
  costPerMergedPr: number | null
  humanTouchRate: number | null
  medianTimeToFirstResponseMs: number | null
}

function emptyStats(bot: string): BotStats {
  return {
    bot,
    opened: 0,
    claimed: 0,
    responded: 0,
    reviewed: 0,
    merged: 0,
    rejected: 0,
    blocked: 0,
    costUsd: 0,
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid]
  if (upper === undefined) return null
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1]
  if (lower === undefined) return null
  return (lower + upper) / 2
}

export function computeHealth(events: LedgerEvent[]): Health {
  const byBot = new Map<string, BotStats>()
  const reasons: Record<string, number> = {}
  const openedAt = new Map<string, number>()
  const firstResponseMs: number[] = []

  let totalCostUsd = 0
  let mergedPrs = 0
  let rejectedPrs = 0
  let blockedPrs = 0
  let humanApprovals = 0

  for (const event of events) {
    totalCostUsd += event.costUsd

    let stats = byBot.get(event.bot)
    if (stats === undefined) {
      stats = emptyStats(event.bot)
      byBot.set(event.bot, stats)
    }
    stats.costUsd += event.costUsd

    switch (event.action) {
      case 'issue.opened':
        stats.opened += 1
        if (event.artifact !== null) openedAt.set(event.artifact, Date.parse(event.ts))
        break
      case 'issue.claimed':
        stats.claimed += 1
        break
      case 'issue.responded': {
        stats.responded += 1
        const opened = event.artifact === null ? undefined : openedAt.get(event.artifact)
        if (opened !== undefined) firstResponseMs.push(Date.parse(event.ts) - opened)
        break
      }
      case 'pr.reviewed': {
        stats.reviewed += 1
        if (event.verdict === 'rejected' || event.verdict === 'blocked') {
          const key = event.reason ?? 'unspecified'
          reasons[key] = (reasons[key] ?? 0) + 1
          if (event.verdict === 'rejected') {
            stats.rejected += 1
            rejectedPrs += 1
          } else {
            stats.blocked += 1
            blockedPrs += 1
          }
        }
        break
      }
      case 'pr.merged':
        stats.merged += 1
        mergedPrs += 1
        break
      case 'pr.human_approved':
        humanApprovals += 1
        break
      default:
        break
    }
  }

  return {
    perBot: [...byBot.values()].sort((a, b) => a.bot.localeCompare(b.bot)),
    mergedPrs,
    rejectedPrs,
    blockedPrs,
    rejectionReasons: reasons,
    totalCostUsd,
    costPerMergedPr: mergedPrs === 0 ? null : totalCostUsd / mergedPrs,
    humanTouchRate: mergedPrs === 0 ? null : humanApprovals / mergedPrs,
    medianTimeToFirstResponseMs: median(firstResponseMs),
  }
}
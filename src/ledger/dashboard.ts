/**
 * The dashboard, rendered from the ledger.
 *
 * The point of this file is visibility. A crew of agents merging code in public
 * is only interesting if a person can see what they are doing without reading
 * thirty pull requests. Everything here is derived from the ledger and from
 * GitHub's own state, and nothing is self-reported.
 */

import { computeHealth } from './health.js'
import type { LedgerEvent } from './schema.js'

export type RequirementText = { id: string; text: string }

export type LiveState = {
  /** Open pull requests, as GitHub reports them. */
  openPrs: { number: number; title: string; head: string }[]
  /** Issues holding a lease, and who holds it. */
  claimed: { number: number; title: string; bot: string }[]
}

export type Delivered = { req: string; pr: string; ts: string }

/** Every requirement that reached main, newest first. */
export function delivered(events: LedgerEvent[]): Delivered[] {
  const out: Delivered[] = []
  for (const event of events) {
    if (event.action !== 'pr.merged' || event.req === null) continue
    out.push({ req: event.req, pr: event.artifact ?? '?', ts: event.ts })
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts))
}

function money(value: number | null): string {
  return value === null ? 'n/a' : `$${value.toFixed(4)}`
}

function when(ts: string): string {
  return ts.replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function textFor(requirements: RequirementText[], id: string): string {
  return requirements.find((requirement) => requirement.id === id)?.text ?? '(not in the spec)'
}

export function renderDashboard(
  events: LedgerEvent[],
  live: LiveState,
  requirements: RequirementText[],
  generatedAt: string,
): string {
  const health = computeHealth(events)
  const shipped = delivered(events)

  const lines: string[] = [
    '# Live crew dashboard',
    '',
    `_Generated from the ledger at ${generatedAt}. Every number is derived from the ledger; nothing is self-reported._`,
    '',
    '## Right now',
    '',
    '| | |',
    '|---|---|',
    `| Requirements delivered | ${health.mergedPrs} |`,
    `| Pull requests open | ${live.openPrs.length} |`,
    `| Requirements in flight | ${live.claimed.length} |`,
    `| Refusals recorded | ${health.blockedPrs} |`,
    `| Total spend | ${money(health.totalCostUsd)} |`,
    `| Cost per delivered requirement | ${money(health.costPerMergedPr)} |`,
    `| Ledger events | ${events.length} |`,
    '',
  ]

  lines.push('## In flight', '')
  if (live.claimed.length === 0) {
    lines.push('Nothing is claimed right now.', '')
  } else {
    lines.push('| Issue | Held by | Requirement |', '|---|---|---|')
    for (const item of live.claimed) {
      lines.push(`| #${item.number} | \`${item.bot}\` | ${item.title} |`)
    }
    lines.push('')
  }

  lines.push('## Pull requests open', '')
  if (live.openPrs.length === 0) {
    lines.push('No pull requests are open.', '')
  } else {
    lines.push('| PR | Title | Branch |', '|---|---|---|')
    for (const pr of live.openPrs) {
      lines.push(`| #${pr.number} | ${pr.title} | \`${pr.head}\` |`)
    }
    lines.push('')
  }

  lines.push('## The crew', '')
  lines.push(
    '| Agent | Opens | Claims | Reviews | Merges | Refusals | Spend |',
    '|---|---|---|---|---|---|---|',
  )
  for (const bot of health.perBot) {
    lines.push(
      `| \`${bot.bot}\` | ${bot.opened} | ${bot.claimed} | ${bot.reviewed} | ${bot.merged} | ${bot.blocked} | ${money(bot.costUsd)} |`,
    )
  }
  lines.push('')

  lines.push('## Delivered', '')
  if (shipped.length === 0) {
    lines.push('Nothing has reached main yet.', '')
  } else {
    lines.push('| Requirement | What it does | Merged | PR |', '|---|---|---|---|')
    for (const item of shipped) {
      lines.push(`| ${item.req} | ${textFor(requirements, item.req)} | ${when(item.ts)} | #${item.pr} |`)
    }
    lines.push('')
  }

  const reasons = Object.entries(health.rejectionReasons)
  lines.push('## Refusals', '')
  if (reasons.length === 0) {
    lines.push('Nothing has been refused.', '')
  } else {
    lines.push('| Reason | Count |', '|---|---|')
    for (const [reason, count] of reasons) lines.push(`| ${reason} | ${count} |`)
    lines.push('')
  }

  lines.push('## Recent activity', '')
  const recent = [...events].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 15)
  if (recent.length === 0) {
    lines.push('The ledger is empty.', '')
  } else {
    lines.push('| When | Agent | Action | Requirement | Detail |', '|---|---|---|---|---|')
    for (const event of recent) {
      const detail = event.reason ?? event.verdict ?? event.artifact ?? ''
      lines.push(
        `| ${when(event.ts)} | \`${event.bot}\` | ${event.action} | ${event.req ?? ''} | ${detail} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * The changelog a user reads. One entry per requirement that reached main, in
 * the order it reached main.
 */
export function renderChangelog(
  events: LedgerEvent[],
  requirements: RequirementText[],
): string {
  const shipped = delivered(events)

  const lines: string[] = [
    '# Changelog',
    '',
    'What changed in the product, newest first. One entry per requirement that',
    'reached `main`. Generated from the ledger, so it cannot drift from what',
    'actually shipped.',
    '',
  ]

  if (shipped.length === 0) {
    lines.push('Nothing has shipped yet.', '')
    return lines.join('\n')
  }

  for (const item of shipped) {
    lines.push(`## ${item.req} — ${textFor(requirements, item.req)}`, '')
    lines.push(`Shipped ${when(item.ts)} in #${item.pr}.`, '')
  }

  return lines.join('\n')
}
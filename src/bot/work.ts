/**
 * Picking the next thing to build.
 *
 * GitHub itself is the work queue. An issue is available when it is open, marked
 * ready, belongs to the product rather than the crew's own machinery, and has no
 * lease on it.
 *
 * This module exists because the loop did not close. Foreman opened thirty
 * issues and Mason waited to be told which one, so a human was the scheduler and
 * nothing built continuously. The wiring was half-built twice over: an
 * `issues: [assigned]` trigger waiting for an assignee nobody creates, and the
 * label lease in claim.ts, written and tested and called by nothing.
 */

import type { Octokit } from 'octokit'
import type { LedgerEvent } from '../ledger/schema.js'
import { claimIssue, claimedBy, normalizeLabels } from './claim.js'
import type { BotSlug, RepoContext } from './github.js'

export const READY_LABEL = 'ready'

/** Crew work is titled `[C-nnn] ...`; product work is `[R-nnn] ...`. */
export const CREW_TITLE_PREFIX = '[C-'

export type QueueItem = {
  number: number
  title: string
  labels: string[]
  phase: number
}

/** Anything the phase labels cannot place sorts last. */
export const NO_PHASE = Number.MAX_SAFE_INTEGER

export function phaseOf(labels: string[]): number {
  for (const label of labels) {
    const match = label.match(/^phase-(\d+)$/)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return NO_PHASE
}

/** The crew's own machinery is not product work, and is already built. */
export function isProductWork(item: QueueItem): boolean {
  return !item.title.startsWith(CREW_TITLE_PREFIX)
}

/**
 * Earliest phase first, then the oldest issue. A lower phase is closer to
 * something a user can actually see, so the product grows outward from what
 * works rather than inward from what is tidy.
 */
export function orderQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => a.phase - b.phase || a.number - b.number)
}

/** The requirement an issue title names, e.g. `[R-001] ...` -> `R-001`. */
export function requirementIdOf(title: string): string | null {
  const match = title.match(/^\[([RC]-\d{3})\]/)
  return match?.[1] ?? null
}

/**
 * Requirements that already reached main, read from the ledger.
 *
 * The queue has to know what is already delivered or the crew rebuilds it. Issue
 * #1 was still open after its pull request merged, so without this the picker
 * takes R-001 again and pays for it twice.
 */
export function deliveredRequirements(events: LedgerEvent[]): Set<string> {
  const out = new Set<string>()
  for (const event of events) {
    if (event.action === 'pr.merged' && event.req !== null) out.add(event.req)
  }
  return out
}

/**
 * Work this bot may take: ready, product, not already delivered, and either
 * unclaimed or already claimed by this same bot.
 *
 * Treating your own lease as available is what stops a failed attempt from
 * stranding an issue forever. If a run dies halfway, the label is still on the
 * issue, and the next run picks the same issue up and finishes it. A different
 * builder still cannot touch it.
 */
export function availableQueue(
  items: QueueItem[],
  bot: BotSlug,
  delivered: ReadonlySet<string> = new Set(),
): QueueItem[] {
  return items.filter((item) => {
    if (!item.labels.includes(READY_LABEL)) return false
    if (!isProductWork(item)) return false

    const id = requirementIdOf(item.title)
    if (id !== null && delivered.has(id)) return false

    const holder = claimedBy(item.labels)
    return holder === null || holder === bot
  })
}

type IssueLike = {
  number: number
  title: string
  labels?: (string | { name?: string | undefined })[] | undefined
  pull_request?: unknown
}

export async function listQueue(octokit: Octokit, ctx: RepoContext): Promise<QueueItem[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
    owner: ctx.owner,
    repo: ctx.repo,
    state: 'open',
    per_page: 100,
  })

  const items: QueueItem[] = []
  for (const raw of data as IssueLike[]) {
    // The issues endpoint returns pull requests too. They are not work.
    if (raw.pull_request !== undefined) continue
    const labels = normalizeLabels(raw.labels ?? [])
    items.push({ number: raw.number, title: raw.title, labels, phase: phaseOf(labels) })
  }
  return items
}

/**
 * Claims and returns the next issue, or null when there is nothing to build.
 *
 * The claim happens before the work, so two builders can never pick the same
 * issue: the lease is a label, and the second claim sees it.
 */
export async function nextClaimable(
  octokit: Octokit,
  ctx: RepoContext,
  bot: BotSlug,
  delivered: ReadonlySet<string> = new Set(),
): Promise<number | null> {
  const queue = orderQueue(availableQueue(await listQueue(octokit, ctx), bot, delivered))
  for (const item of queue) {
    // A lease this bot already holds is a retry, not a new claim.
    if (claimedBy(item.labels) === bot) return item.number
    if (await claimIssue(octokit, ctx, item.number, bot)) return item.number
  }
  return null
}

/** The next issue that would be claimed, without claiming it. For dry runs. */
export async function peekNext(
  octokit: Octokit,
  ctx: RepoContext,
  bot: BotSlug,
  delivered: ReadonlySet<string> = new Set(),
): Promise<QueueItem | null> {
  return orderQueue(availableQueue(await listQueue(octokit, ctx), bot, delivered))[0] ?? null
}
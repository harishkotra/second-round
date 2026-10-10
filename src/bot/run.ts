/**
 * The shared bot wrapper.
 *
 * Every bot run: load its persona, check its budget, do the work, record what it
 * did. Dependencies are injectable so the whole path is testable without a network.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Octokit } from 'octokit'
import { makeEvent, type LedgerEvent } from '../ledger/schema.js'
import { dailyCapUsd, hasBudget, spendToday } from './budget.js'
import {
  envFlag,
  makeOctokit,
  repoFromEnv,
  tokenFromEnv,
  type BotSlug,
  type RepoContext,
} from './github.js'
import { appendRemoteLedger, readRemoteLedger } from './ledger-remote.js'

export type BotRun = {
  slug: BotSlug
  repo: RepoContext
  octokit: Octokit
  persona: string
  dryRun: boolean
  history: LedgerEvent[]
  log: (message: string) => void
}

export type BotHandler = (run: BotRun) => Promise<LedgerEvent[]>

export type RunDeps = {
  octokit: Octokit
  repo: RepoContext
  persona: string
  dryRun: boolean
  history: LedgerEvent[]
  now: Date
  capUsd: number
}

export async function withBot(
  slug: BotSlug,
  handler: BotHandler,
  deps: Partial<RunDeps> = {},
): Promise<number> {
  const log = (message: string): void => {
    console.log(`[${slug}] ${message}`)
  }

  const dryRun = deps.dryRun ?? envFlag('DRY_RUN')
  const repo = deps.repo ?? repoFromEnv()
  const persona =
    deps.persona ?? (await readFile(join('.github', 'agents', `${slug}.md`), 'utf8'))

  const token = tokenFromEnv()
  const octokit = deps.octokit ?? makeOctokit(token)
  if (!dryRun && token === null && deps.octokit === undefined) {
    throw new Error('GH_TOKEN is not set and this is not a dry run')
  }

  const history = deps.history ?? (await readRemoteLedger(octokit, repo, slug))
  const now = deps.now ?? new Date()
  const capUsd = deps.capUsd ?? dailyCapUsd()

  if (!hasBudget(history, slug, capUsd, now)) {
    const spent = spendToday(history, slug, now)
    log(`budget exhausted: spent $${spent.toFixed(4)} of $${capUsd.toFixed(2)} today, pausing`)
    if (!dryRun) {
      await appendRemoteLedger(
        octokit,
        repo,
        slug,
        [
          makeEvent({
            bot: slug,
            action: 'budget.exceeded',
            reason: `spent ${spent.toFixed(4)} >= cap ${capUsd.toFixed(2)}`,
          }),
        ],
        `ledger: ${slug} paused on budget`,
      )
    }
    return 0
  }

  const events = await handler({ slug, repo, octokit, persona, dryRun, history, log })

  if (events.length === 0) {
    log('nothing to do')
    return 0
  }

  if (dryRun) {
    for (const event of events) {
      log(`dry run, would record ${event.action}${event.artifact === null ? '' : ` ${event.artifact}`}`)
    }
    return 0
  }

  await appendRemoteLedger(
    octokit,
    repo,
    slug,
    events,
    `ledger: ${slug}, ${events.length} event(s)`,
  )
  log(`recorded ${events.length} event(s)`)
  return 0
}

export async function runBot(slug: BotSlug, handler: BotHandler): Promise<void> {
  try {
    process.exit(await withBot(slug, handler))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[${slug}] failed: ${message}`)
    process.exit(1)
  }
}
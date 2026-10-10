/**
 * Turnstile: the only identity permitted to merge (C-007).
 *
 * It has no opinions, only checks. If the reviewer could also merge, a soft
 * review and a merge would become the same action and the gate would be
 * decorative. Separating the identity that judges from the identity that merges
 * is the entire reason this bot exists.
 */

import type { Octokit } from 'octokit'
import { isEntry, type RepoContext } from '../bot/github.js'
import {
  listCheckRuns,
  listReviews,
  mergePullRequest,
  pullRequestView,
  type CheckRun,
  type PullRequestView,
  type Review,
} from '../bot/repo.js'
import { runBot, type BotRun } from '../bot/run.js'
import { makeEvent, type LedgerEvent } from '../ledger/schema.js'
import { requirementIdIn } from '../spec/reference.js'
import { loadRequirements } from '../spec/load.js'

export const SLUG = 'sr-turnstile' as const

export const REQUIRED_CHECKS = ['lint', 'typecheck', 'test', 'build', 'req-id'] as const

export type MergeState = {
  checks: CheckRun[]
  reviews: Review[]
  touchesSpec: boolean
  humanApproved: boolean
}

export type MergeDecision = { ok: true } | { ok: false; reason: string }

export function isBotLogin(login: string): boolean {
  return login.endsWith('[bot]')
}

export function latestReviewPerAuthor(reviews: Review[]): Review[] {
  const latest = new Map<string, Review>()
  for (const review of reviews) {
    if (review.state === 'COMMENTED') continue
    latest.set(review.login, review)
  }
  return [...latest.values()]
}

export function canMerge(state: MergeState): MergeDecision {
  const byName = new Map(state.checks.map((check) => [check.name, check]))

  for (const required of REQUIRED_CHECKS) {
    const check = byName.get(required)
    if (check === undefined) return { ok: false, reason: `missing-check:${required}` }
    if (check.conclusion !== 'success') {
      return { ok: false, reason: `check-not-green:${required}:${String(check.conclusion)}` }
    }
  }

  const latest = latestReviewPerAuthor(state.reviews)

  const rejected = latest.find((review) => review.state === 'CHANGES_REQUESTED')
  if (rejected !== undefined) return { ok: false, reason: `changes-requested-by:${rejected.login}` }

  const approved = latest.some((review) => review.state === 'APPROVED')
  if (!approved) return { ok: false, reason: 'no-approval' }

  if (state.touchesSpec && !state.humanApproved) {
    return { ok: false, reason: 'spec-change-needs-human' }
  }

  return { ok: true }
}

export function humanApproved(reviews: Review[]): boolean {
  return latestReviewPerAuthor(reviews).some(
    (review) => review.state === 'APPROVED' && !isBotLogin(review.login),
  )
}

export async function pullNumberFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const raw = env['PR_NUMBER']
  if (raw === undefined || raw.trim() === '') throw new Error('PR_NUMBER is not set')
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`PR_NUMBER must be a positive integer, got "${raw}"`)
  }
  return parsed
}

export type TurnstileDeps = {
  pullNumber?: number
}

export async function gatherState(
  octokit: Octokit,
  ctx: RepoContext,
  pullNumber: number,
): Promise<{ state: MergeState; view: PullRequestView }> {
  const view = await pullRequestView(octokit, ctx, pullNumber)
  const checks = await listCheckRuns(octokit, ctx, view.headSha)
  const reviews = await listReviews(octokit, ctx, pullNumber)

  return {
    view,
    state: {
      checks,
      reviews,
      touchesSpec: view.files.some((file) => file.path.startsWith('spec/')),
      humanApproved: humanApproved(reviews),
    },
  }
}

export async function handler(
  run: BotRun,
  deps: TurnstileDeps = {},
): Promise<LedgerEvent[]> {
  const pullNumber = deps.pullNumber ?? (await pullNumberFromEnv())
  const { state, view } = await gatherState(run.octokit, run.repo, pullNumber)

  const requirements = await loadRequirements()
  const validIds = new Set(requirements.map((item) => item.id))
  const requirementId = requirementIdIn(view.body, validIds)

  const decision = canMerge(state)

  if (run.dryRun) {
    run.log(`dry run, would ${decision.ok ? 'merge' : 'refuse'} #${pullNumber}`)
    return []
  }

  if (!decision.ok) {
    run.log(`refusing #${pullNumber}: ${decision.reason}`)
    return [
      makeEvent({
        bot: SLUG,
        action: 'pr.reviewed',
        req: requirementId,
        artifact: String(pullNumber),
        verdict: 'blocked',
        reason: decision.reason,
      }),
    ]
  }

  const sha = await mergePullRequest(run.octokit, run.repo, pullNumber)
  run.log(`merged #${pullNumber} as ${sha.slice(0, 7)}`)

  return [
    makeEvent({
      bot: SLUG,
      action: 'pr.merged',
      req: requirementId,
      artifact: String(pullNumber),
    }),
  ]
}

if (isEntry(process.argv[1] ?? '', 'turnstile')) {
  await runBot(SLUG, handler)
}
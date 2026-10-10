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
  branchBehindBy,
  listCheckRuns,
  listOpenPullRequests,
  listReviews,
  mergePullRequest,
  pullRequestView,
  updatePullRequestBranch,
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

/**
 * The newest run of each check name.
 *
 * One commit can carry several runs of the same name: a concurrency group
 * cancels the first attempt and a later attempt succeeds. Keying by name alone
 * takes whichever the API happened to return last, which is how PR #32 came to
 * be refused with `check-not-green:lint:cancelled` while its lint had in fact
 * passed. GitHub judges the most recent run, so this does too.
 */
export function latestCheckPerName(checks: CheckRun[]): Map<string, CheckRun> {
  const latest = new Map<string, CheckRun>()
  for (const check of checks) {
    const existing = latest.get(check.name)
    if (existing === undefined || check.startedAt > existing.startedAt) {
      latest.set(check.name, check)
    }
  }
  return latest
}

export function canMerge(state: MergeState): MergeDecision {
  const byName = latestCheckPerName(state.checks)

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

/**
 * The pull request to attempt, or null to sweep.
 *
 * A blank PR_NUMBER means "look around and merge whatever is ready", which is
 * what the scheduled run does. The sweep exists because this bot used to have
 * exactly one trigger, `check_suite`, and GitHub documents that a check suite
 * created by GitHub Actions never fires a workflow. The trigger could not work,
 * so PR #32 sat green and approved and unmerged with nothing to collect it.
 */
export function pullNumberFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env['PR_NUMBER']
  if (raw === undefined || raw.trim() === '') return null
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

export const BOT_BRANCH_PREFIX = 'bot/'

/**
 * The open pull requests this bot is allowed to consider: the ones the crew
 * opened. A human's pull request is not the crew's to merge.
 */
export async function sweepTargets(octokit: Octokit, ctx: RepoContext): Promise<number[]> {
  const open = await listOpenPullRequests(octokit, ctx)
  return open
    .filter((pull) => pull.headRef.startsWith(BOT_BRANCH_PREFIX))
    .map((pull) => pull.number)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function blockedEvent(
  requirementId: string | null,
  pullNumber: number,
  reason: string,
): LedgerEvent {
  return makeEvent({
    bot: SLUG,
    action: 'pr.reviewed',
    req: requirementId,
    artifact: String(pullNumber),
    verdict: 'blocked',
    reason,
  })
}

/**
 * A sweep runs every half hour. Recording the same failure every time would bury
 * the record, so a reason already recorded against this pull request is not
 * repeated. A *different* reason is recorded, because that is news.
 */
function isRepeat(history: LedgerEvent[], artifact: string, reason: string): boolean {
  const previous = [...history].reverse().find((event) => event.artifact === artifact)
  return previous !== undefined && previous.reason === reason
}

async function attemptMerge(
  run: BotRun,
  pullNumber: number,
  validIds: Set<string>,
  explicit: boolean,
): Promise<LedgerEvent[]> {
  let gathered: { state: MergeState; view: PullRequestView }
  try {
    gathered = await gatherState(run.octokit, run.repo, pullNumber)
  } catch (error) {
    const reason = `unreadable: ${messageOf(error)}`
    run.log(`cannot read #${pullNumber}: ${reason}`)
    if (!explicit && isRepeat(run.history, String(pullNumber), reason)) return []
    return [blockedEvent(null, pullNumber, reason)]
  }

  const { state, view } = gathered
  const requirementId = requirementIdIn(view.body, validIds)
  const decision = canMerge(state)

  if (run.dryRun) {
    run.log(`dry run, would ${decision.ok ? 'merge' : 'refuse'} #${pullNumber}`)
    return []
  }

  if (!decision.ok) {
    run.log(`refusing #${pullNumber}: ${decision.reason}`)
    // A sweep passes over everything every half hour, so it only speaks when it
    // acts. An explicitly named pull request always records its reason.
    if (!explicit) return []
    return [blockedEvent(requirementId, pullNumber, decision.reason)]
  }

  // Branch protection here is strict, so a pull request must be level with main
  // before it can merge. The crew pushes to main, so an open pull request falls
  // behind just by waiting, and GitHub then refuses with "N of N required status
  // checks are expected". Bring the branch up to date and merge on the next pass:
  // the push wakes the reviewer, and the workflow_run trigger wakes this bot.
  const behind = await branchBehindBy(run.octokit, run.repo, view.baseBranch, view.headSha)
  if (behind > 0) {
    if (run.dryRun) {
      run.log(`dry run, would bring #${pullNumber} up to date with ${view.baseBranch} (${behind} behind)`)
      return []
    }
    await updatePullRequestBranch(run.octokit, run.repo, pullNumber)
    run.log(`#${pullNumber} was ${behind} behind ${view.baseBranch}; updated the branch, will merge next pass`)
    return [
      makeEvent({
        bot: SLUG,
        action: 'pr.updated',
        req: requirementId,
        artifact: String(pullNumber),
        reason: `branch-behind:${behind}`,
      }),
    ]
  }

  let sha: string
  try {
    sha = await mergePullRequest(run.octokit, run.repo, pullNumber)
  } catch (error) {
    // The merge is the one thing this bot exists to do. Returning quietly here is
    // how a real failure hid for two whole runs: a green run, an empty ledger,
    // and a pull request that stayed open with nobody told why. Say it in the
    // record instead.
    const reason = `merge-failed: ${messageOf(error)}`
    run.log(`merge failed for #${pullNumber}: ${reason}`)
    if (!explicit && isRepeat(run.history, String(pullNumber), reason)) return []
    return [blockedEvent(requirementId, pullNumber, reason)]
  }

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

export async function handler(
  run: BotRun,
  deps: TurnstileDeps = {},
): Promise<LedgerEvent[]> {
  const requirements = await loadRequirements()
  const validIds = new Set(requirements.map((item) => item.id))

  const single = deps.pullNumber ?? pullNumberFromEnv()
  const targets = single === null ? await sweepTargets(run.octokit, run.repo) : [single]

  if (targets.length === 0) {
    run.log('nothing to merge')
    return []
  }

  const events: LedgerEvent[] = []
  for (const pullNumber of targets) {
    events.push(...(await attemptMerge(run, pullNumber, validIds, single !== null)))
  }
  return events
}

if (isEntry(process.argv[1] ?? '', 'turnstile')) {
  await runBot(SLUG, handler)
}
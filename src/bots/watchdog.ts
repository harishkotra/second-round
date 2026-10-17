/**
 * The night watch.
 *
 * The other four bots are autonomous but not self-aware. If Mason starts failing
 * because a permission was revoked, or the whole loop goes quiet because a label
 * was mistyped, the crew simply stops — and nothing says so. A machine that stops
 * silently is not autonomous, it is merely unattended.
 *
 * So the watchdog reads how each bot's last runs went, and whether anything has
 * happened at all, then does the smallest thing that could restart the loop and
 * records that it did. When retrying does not help, it stops pretending and files
 * an issue a person will see.
 *
 * It has no git identity and no App, by design: it must not be able to write
 * code. Its only levers are dispatching other bots and opening an issue.
 */

import { isEntry, type BotSlug, type RepoContext } from '../bot/github.js'
import { readRemoteLedger } from '../bot/ledger-remote.js'
import {
  dispatchWorkflow,
  ensureLabel,
  listWorkflowRuns,
  openIssue,
  type RunSummary,
} from '../bot/ops.js'
import { runBot, type BotRun } from '../bot/run.js'
import { availableQueue, deliveredRequirements, listQueue } from '../bot/work.js'
import { makeEvent, type LedgerEvent } from '../ledger/schema.js'

export const WATCHDOG: BotSlug = 'sr-watchdog'
export const ESCALATION_LABEL = 'crew-stalled'

const CREW: BotSlug[] = ['sr-foreman', 'sr-mason', 'sr-sentry', 'sr-turnstile']

/** A bot that fails the same way three times is failing for a reason a retry cannot fix. */
export const FAILURES_BEFORE_ESCALATING = 3
export const RETRY_COOLDOWN_HOURS = 1
export const ESCALATION_COOLDOWN_HOURS = 6
export const SILENCE_HOURS = 3

export type BotHealth = {
  bot: BotSlug
  workflow: string
  runs: RunSummary[]
}

export type WatchInput = {
  bots: BotHealth[]
  lastEventAt: string | null
  readyUnclaimed: number
  retriedFor: Record<string, string>
  escalatedFor: Record<string, string>
  now: Date
}

export type Intervention =
  | { kind: 'dispatch'; bot: BotSlug; workflow: string; reason: string }
  | { kind: 'escalate'; bot: BotSlug; title: string; body: string; reason: string }

/** How many runs in a row, counting back from the newest, ended badly. */
export function consecutiveFailures(runs: RunSummary[]): number {
  let count = 0
  for (const run of runs) {
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out') count += 1
    else break
  }
  return count
}

export function hoursSince(iso: string | null | undefined, now: Date): number {
  if (iso === null || iso === undefined) return Number.POSITIVE_INFINITY
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return (now.getTime() - then) / 3_600_000
}

export function workflowFor(bot: BotSlug): string {
  return `${bot.replace('sr-', '')}.yml`
}

export function diagnose(input: WatchInput): Intervention[] {
  const found: Intervention[] = []

  for (const health of input.bots) {
    const failures = consecutiveFailures(health.runs)
    if (failures === 0) continue

    if (failures >= FAILURES_BEFORE_ESCALATING) {
      if (hoursSince(input.escalatedFor[health.bot], input.now) < ESCALATION_COOLDOWN_HOURS) {
        continue
      }
      found.push({
        kind: 'escalate',
        bot: health.bot,
        title: `The crew is stalled: ${health.bot} has failed ${failures} runs in a row`,
        body: [
          `${health.bot} has failed its last ${failures} runs, and retrying it did not help.`,
          '',
          'The watchdog has stopped retrying, because a bot that fails the same way three',
          'times is failing for a reason a retry cannot fix. This needs a person.',
          '',
          `Workflow: \`.github/workflows/${health.workflow}\``,
          '',
          'Recent runs, newest first:',
          ...health.runs.map((run) => `- ${run.createdAt} — ${run.conclusion ?? 'running'}`),
        ].join('\n'),
        reason: `${failures} consecutive failures`,
      })
      continue
    }

    if (hoursSince(input.retriedFor[health.bot], input.now) < RETRY_COOLDOWN_HOURS) continue
    found.push({
      kind: 'dispatch',
      bot: health.bot,
      workflow: health.workflow,
      reason: `last run ${health.runs[0]?.conclusion ?? 'unknown'}`,
    })
  }

  if (found.length > 0) return found

  // Nothing is individually broken, but nothing is happening either, and work is
  // waiting. That is the loop stuck somewhere a per-bot check cannot see.
  const quiet = hoursSince(input.lastEventAt, input.now)
  if (input.readyUnclaimed > 0 && quiet >= SILENCE_HOURS) {
    const howLong =
      quiet === Number.POSITIVE_INFINITY ? 'the whole record' : `${quiet.toFixed(1)}h`
    found.push({
      kind: 'dispatch',
      bot: 'sr-mason',
      workflow: workflowFor('sr-mason'),
      reason: `no ledger activity for ${howLong} with ${input.readyUnclaimed} ready issue(s) waiting`,
    })
  }

  return found
}

export function latestEventAt(events: LedgerEvent[]): string | null {
  let newest: string | null = null
  for (const event of events) {
    if (newest === null || Date.parse(event.ts) > Date.parse(newest)) newest = event.ts
  }
  return newest
}

/** The most recent time each artifact was mentioned by a given action. */
export function lastByArtifact(events: LedgerEvent[], action: string): Record<string, string> {
  const seen: Record<string, string> = {}
  for (const event of events) {
    if (event.action !== action || event.artifact === null) continue
    const known = seen[event.artifact]
    if (known === undefined || Date.parse(event.ts) > Date.parse(known)) {
      seen[event.artifact] = event.ts
    }
  }
  return seen
}

async function readCrewEvents(
  octokit: BotRun['octokit'],
  ctx: RepoContext,
  own: LedgerEvent[],
): Promise<LedgerEvent[]> {
  const events = [...own]
  for (const bot of CREW) events.push(...(await readRemoteLedger(octokit, ctx, bot)))
  return events
}

async function countReady(octokit: BotRun['octokit'], ctx: RepoContext): Promise<number> {
  const queue = await listQueue(octokit, ctx)
  const delivered = deliveredRequirements(await readRemoteLedger(octokit, ctx, 'sr-turnstile'))
  return availableQueue(queue, 'sr-mason', delivered).length
}

export type WatchdogDeps = {
  listRuns?: (workflow: string) => Promise<RunSummary[]>
  dispatch?: (workflow: string) => Promise<void>
  escalate?: (title: string, body: string) => Promise<number>
  readyUnclaimed?: () => Promise<number>
  crewEvents?: () => Promise<LedgerEvent[]>
  now?: Date
}

export async function handler(run: BotRun, deps: WatchdogDeps = {}): Promise<LedgerEvent[]> {
  const now = deps.now ?? new Date()
  const listRuns =
    deps.listRuns ?? ((workflow: string) => listWorkflowRuns(run.octokit, run.repo, workflow))
  const dispatch =
    deps.dispatch ?? ((workflow: string) => dispatchWorkflow(run.octokit, run.repo, workflow))
  const escalate =
    deps.escalate ??
    (async (title: string, body: string) => {
      await ensureLabel(
        run.octokit,
        run.repo,
        ESCALATION_LABEL,
        'b60205',
        'The crew has stopped and needs a person',
      )
      return openIssue(run.octokit, run.repo, { title, body, labels: [ESCALATION_LABEL] })
    })

  const bots: BotHealth[] = []
  for (const bot of CREW) {
    const workflow = workflowFor(bot)
    bots.push({ bot, workflow, runs: await listRuns(workflow) })
  }

  const readyUnclaimed =
    deps.readyUnclaimed !== undefined
      ? await deps.readyUnclaimed()
      : await countReady(run.octokit, run.repo)

  const allEvents =
    deps.crewEvents !== undefined
      ? await deps.crewEvents()
      : await readCrewEvents(run.octokit, run.repo, run.history)

  const interventions = diagnose({
    bots,
    lastEventAt: latestEventAt(allEvents),
    readyUnclaimed,
    retriedFor: lastByArtifact(run.history, 'stall.retried'),
    escalatedFor: lastByArtifact(run.history, 'stall.escalated'),
    now,
  })

  const events: LedgerEvent[] = []
  for (const action of interventions) {
    if (action.kind === 'escalate') {
      const issue = await escalate(action.title, action.body)
      run.log(`escalated ${action.bot}: ${action.reason} (issue #${issue})`)
      events.push(
        makeEvent({
          bot: WATCHDOG,
          action: 'stall.escalated',
          artifact: action.bot,
          reason: `${action.reason} (issue #${issue})`,
        }),
      )
      continue
    }

    await dispatch(action.workflow)
    run.log(`dispatched ${action.workflow}: ${action.reason}`)
    events.push(
      makeEvent({
        bot: WATCHDOG,
        action: 'stall.retried',
        artifact: action.bot,
        reason: action.reason,
      }),
    )
  }

  if (events.length === 0) run.log('the crew is running')
  return events
}

if (isEntry(process.argv[1] ?? '', 'watchdog')) {
  await runBot(WATCHDOG, (run) => handler(run))
}
/**
 * Sentry: reviews every pull request against the requirement it claims to satisfy.
 *
 * Sentry is a model reading a diff, so its verdict is signal and never the gate.
 * The gate is CI. Sentry's value is naming what CI cannot see: a change that
 * passes every check and still is not what the requirement asked for, or one
 * that quietly builds something the project declared it would not build.
 */

import type { Octokit } from 'octokit'
import { isEntry, type RepoContext } from '../bot/github.js'
import { callModel } from '../bot/model.js'
import { diffText, pullRequestView, submitReview, type PullRequestView } from '../bot/repo.js'
import { runBot, type BotRun } from '../bot/run.js'
import { makeEvent, type LedgerEvent } from '../ledger/schema.js'
import { loadNonGoals, loadRequirements, matchesNonGoal, type NonGoal, type Requirement } from '../spec/load.js'
import { requirementIdIn } from '../spec/reference.js'

export const SLUG = 'sr-sentry' as const

export type Verdict = {
  verdict: 'approved' | 'rejected'
  reason: string | null
  findings: string[]
}

export function reviewEvent(verdict: 'approved' | 'rejected'): 'APPROVE' | 'REQUEST_CHANGES' {
  return verdict === 'approved' ? 'APPROVE' : 'REQUEST_CHANGES'
}

export function parseVerdict(raw: string): Verdict {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('reviewer returned no JSON object')

  const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('reviewer output must be a JSON object')
  }
  const record = parsed as Record<string, unknown>

  const verdict = record['verdict']
  if (verdict !== 'approved' && verdict !== 'rejected') {
    throw new Error(`reviewer verdict must be "approved" or "rejected", got ${String(verdict)}`)
  }

  const findings: string[] = []
  const rawFindings = record['findings']
  if (Array.isArray(rawFindings)) {
    for (const item of rawFindings) {
      if (typeof item === 'string' && item.trim() !== '') findings.push(item.trim())
    }
  }

  const reason = record['reason']
  return {
    verdict,
    reason: typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null,
    findings,
  }
}

export function nonGoalViolation(
  view: PullRequestView,
  nonGoals: NonGoal[],
): NonGoal | null {
  const haystack = [view.title, view.body, ...view.files.map((file) => file.path)].join('\n')
  return matchesNonGoal(haystack, nonGoals)
}

export function buildReviewPrompt(
  requirement: Requirement,
  view: PullRequestView,
): string {
  return [
    `Review this pull request against the requirement it claims to satisfy.`,
    '',
    `Requirement ${requirement.id}: ${requirement.text}`,
    '',
    `Pull request #${view.number}: ${view.title}`,
    '',
    'Body:',
    view.body,
    '',
    'Diff:',
    diffText(view),
    '',
    'Return ONLY a JSON object, no prose and no code fences:',
    '{"verdict":"approved"|"rejected","reason":"<short code such as R-004 or NG-02, or null>","findings":["<specific finding with file and line>"]}',
    '',
    'Rules:',
    '- Judge the diff against the requirement first. A fine diff that does not satisfy the requirement is a rejection.',
    '- A change that builds something the project declared a non-goal is a rejection.',
    '- A change with no tests for new behaviour is a rejection.',
    '- Do not approve to be agreeable. A rejection with a clear reason is more useful than a soft approval.',
  ].join('\n')
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

export type SentryDeps = {
  generate: typeof callModel
  pullNumber?: number
}

export async function handler(
  run: BotRun,
  deps: SentryDeps = { generate: callModel },
): Promise<LedgerEvent[]> {
  const pullNumber = deps.pullNumber ?? (await pullNumberFromEnv())
  const view = await pullRequestView(run.octokit, run.repo, pullNumber)

  const requirements = await loadRequirements()
  const validIds = new Set(requirements.map((item) => item.id))
  const requirementId = requirementIdIn(view.body, validIds)

  if (requirementId === null) {
    run.log(`#${pullNumber} names no requirement, refusing to review it`)
    return []
  }

  const requirement = requirements.find((item) => item.id === requirementId)
  if (requirement === undefined) return []

  const nonGoals = await loadNonGoals()
  const violation = nonGoalViolation(view, nonGoals)

  if (run.dryRun) {
    run.log(`dry run, would review #${pullNumber} against ${requirementId}`)
    return []
  }

  let verdict: Verdict
  let costUsd = 0

  if (violation !== null) {
    // A non-goal match is decided in code, not by asking a model to be careful.
    verdict = {
      verdict: 'rejected',
      reason: violation.id,
      findings: [`Matches the non-goal ${violation.id}: ${violation.text}`],
    }
  } else {
    const result = await deps.generate({
      persona: run.persona,
      messages: [{ role: 'user', content: buildReviewPrompt(requirement, view) }],
    })
    verdict = parseVerdict(result.text)
    costUsd = result.costUsd
  }

  const body =
    verdict.findings.length === 0
      ? `Reviewed against ${requirement.id}. ${verdict.verdict === 'approved' ? 'Approved.' : 'Rejected.'}`
      : ['Reviewed against ' + requirement.id + '.', '', ...verdict.findings.map((f) => `- ${f}`)].join('\n')

  await submitReview(run.octokit, run.repo, pullNumber, reviewEvent(verdict.verdict), body)

  run.log(`#${pullNumber} ${verdict.verdict}${verdict.reason === null ? '' : ` (${verdict.reason})`}`)

  return [
    makeEvent({
      bot: SLUG,
      action: 'pr.reviewed',
      req: requirement.id,
      artifact: String(pullNumber),
      costUsd,
      verdict: verdict.verdict,
      reason: verdict.reason,
    }),
  ]
}

if (isEntry(process.argv[1] ?? '', 'sentry')) {
  await runBot(SLUG, handler)
}
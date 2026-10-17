/**
 * Foreman: owns the spec, opens one issue per unmet requirement (C-001).
 *
 * Deliberately deterministic. It does not ask a model what the work should be,
 * because the spec already says. One requirement, one issue, every time.
 */

import type { Octokit } from 'octokit'
import { isEntry, type RepoContext } from '../bot/github.js'
import { runBot, type BotRun } from '../bot/run.js'
import { makeEvent, type LedgerEvent } from '../ledger/schema.js'
import { loadRequirements, type Requirement } from '../spec/load.js'

export const SLUG = 'sr-foreman' as const

export type IssueDraft = {
  title: string
  body: string
  req: string
  labels: string[]
}

export type OpenIssue = {
  title: string
  body: string | null
}

const REQ_IN_TEXT = /\[([RC]-\d{3})\]|Closes\s+([RC]-\d{3})/g

export function openRequirementIds(issues: OpenIssue[]): Set<string> {
  const ids = new Set<string>()
  for (const issue of issues) {
    const text = `${issue.title}\n${issue.body ?? ''}`
    for (const match of text.matchAll(REQ_IN_TEXT)) {
      const id = match[1] ?? match[2]
      if (id !== undefined) ids.add(id)
    }
  }
  return ids
}

export function planMilestone(
  requirements: Requirement[],
  alreadyOpen: Set<string>,
  phase?: number,
): IssueDraft[] {
  return requirements
    .filter((requirement) => !alreadyOpen.has(requirement.id))
    .filter((requirement) => phase === undefined || requirement.phase === phase)
    .map((requirement) => ({
      title: `[${requirement.id}] ${requirement.text}`,
      body: [
        '## Requirement',
        '',
        requirement.text,
        '',
        `Phase ${requirement.phase}, defined in \`spec/requirements.yaml\`.`,
        '',
        `Closes ${requirement.id}`,
      ].join('\n'),
      req: requirement.id,
      labels: ['ready', `phase-${requirement.phase}`],
    }))
}

export async function listOpenIssues(
  octokit: Octokit,
  ctx: RepoContext,
): Promise<OpenIssue[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
    owner: ctx.owner,
    repo: ctx.repo,
    state: 'open',
    per_page: 100,
  })

  const out: OpenIssue[] = []
  for (const item of data) {
    if ('pull_request' in item) continue
    out.push({ title: item.title, body: item.body ?? null })
  }
  return out
}

export async function createIssue(
  octokit: Octokit,
  ctx: RepoContext,
  draft: IssueDraft,
): Promise<number> {
  const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner: ctx.owner,
    repo: ctx.repo,
    title: draft.title,
    body: draft.body,
    labels: draft.labels,
  })
  return data.number
}

export async function handler(run: BotRun): Promise<LedgerEvent[]> {
  const requirements = await loadRequirements()
  const issues = await listOpenIssues(run.octokit, run.repo)
  const drafts = planMilestone(requirements, openRequirementIds(issues))

  if (drafts.length === 0) {
    run.log('every requirement already has an open issue')
    return []
  }

  if (run.dryRun) {
    for (const draft of drafts) run.log(`dry run, would open ${draft.title}`)
    return []
  }

  const events: LedgerEvent[] = []
  for (const draft of drafts) {
    const number = await createIssue(run.octokit, run.repo, draft)
    run.log(`opened #${number} ${draft.title}`)
    events.push(
      makeEvent({ bot: SLUG, action: 'issue.opened', req: draft.req, artifact: String(number) }),
    )
  }
  return events
}

if (isEntry(process.argv[1] ?? '', 'foreman')) {
  await runBot(SLUG, handler)
}
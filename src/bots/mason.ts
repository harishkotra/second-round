/**
 * Mason: implements one assigned requirement (R-001 onward).
 *
 * One issue per run, one branch, one pull request. Never main, never a merge,
 * never an approval. If the requirement is ambiguous it says so in the pull
 * request rather than guessing silently.
 */

import type { Octokit } from 'octokit'
import { readConventions, readRepoContext } from '../bot/context.js'
import { isEntry, type RepoContext } from '../bot/github.js'
import { callModel } from '../bot/model.js'
import { parsePatch, type FileChange } from '../bot/patch.js'
import {
  branchName,
  commitFiles,
  createBranch,
  defaultBranch,
  listRepoPaths,
  openPullRequest,
} from '../bot/repo.js'
import { runBot, type BotRun } from '../bot/run.js'
import { makeEvent, type LedgerEvent } from '../ledger/schema.js'
import { loadRequirements, type Requirement } from '../spec/load.js'
import { requirementIdIn, referencedRequirementIds } from '../spec/reference.js'

export const SLUG = 'sr-mason' as const
export const MODEL = 'deepseek-v4.1-flash'

export type ImplementPlan = {
  branch: string
  title: string
  body: string
  files: FileChange[]
  notes: string
}

export function issueRequirementId(title: string, body: string): string | null {
  const match = title.match(/\[([RC]-\d{3})\]/)
  if (match?.[1] !== undefined) return match[1]
  return referencedRequirementIds(body)[0] ?? null
}

export function buildPrBody(
  requirement: Requirement,
  issueNumber: number,
  notes: string,
): string {
  return [
    '## What this does',
    '',
    requirement.text,
    '',
    '## Notes from the builder',
    '',
    notes.trim() === '' ? 'Nothing to flag.' : notes.trim(),
    '',
    `Closes ${requirement.id}`,
    `Resolves #${issueNumber}`,
  ].join('\n')
}

export function planImplementation(
  requirement: Requirement,
  issueNumber: number,
  rawPatch: string,
  notes: string,
): ImplementPlan {
  return {
    branch: branchName(requirement.id, requirement.text),
    title: `[${requirement.id}] ${requirement.text}`,
    body: buildPrBody(requirement, issueNumber, notes),
    files: parsePatch(rawPatch),
    notes,
  }
}

export function readNotes(rawPatch: string): string {
  const start = rawPatch.indexOf('{')
  const end = rawPatch.lastIndexOf('}')
  if (start === -1 || end <= start) return ''
  try {
    const parsed: unknown = JSON.parse(rawPatch.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null) return ''
    const notes = (parsed as Record<string, unknown>)['notes']
    return typeof notes === 'string' ? notes : ''
  } catch {
    return ''
  }
}

export function buildPrompt(
  requirement: Requirement,
  issueNumber: number,
  paths: string[],
  conventions = '',
  context = '',
): string {
  const parts = [
    `Implement this requirement from the project spec.`,
    '',
    `Requirement ${requirement.id}: ${requirement.text}`,
    `Tracking issue: #${issueNumber}`,
  ]

  if (conventions !== '') {
    parts.push('', 'Repository conventions you must follow exactly:', conventions)
  }

  parts.push('', 'Files that already exist in the repository:', paths.slice(0, 200).join('\n'))

  if (context !== '') {
    parts.push(
      '',
      'Current contents of the source files. Read them before you write anything:',
      context,
    )
  }

  parts.push(
    '',
    'Return ONLY a JSON object, no prose and no code fences, in exactly this shape:',
    '{"files":[{"path":"src/...","content":"<full file contents>"}],"notes":"<anything you could not do, or empty>"}',
    '',
    'Rules:',
    '- Write full file contents, not diffs.',
    '- Include ONLY the files you actually changed. Do not echo back files you left alone.',
    '- If this requirement changes existing behaviour, EDIT the existing file. Do not add a',
    '  new module beside it: a module nothing imports does not satisfy a requirement.',
    '- Only write inside src/, tests/, api/, docs/ or spec/.',
    '- Write real working code with real tests. No placeholders and no mock data.',
    '- Keep every file under 400 lines.',
    '- Do not edit spec/. Changing what is owed is a human decision.',
  )

  return parts.join('\n')
}

export async function issueNumberFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const raw = env['ISSUE_NUMBER']
  if (raw === undefined || raw.trim() === '') {
    throw new Error('ISSUE_NUMBER is not set')
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`ISSUE_NUMBER must be a positive integer, got "${raw}"`)
  }
  return parsed
}

export async function fetchIssue(
  octokit: Octokit,
  ctx: RepoContext,
  issueNumber: number,
): Promise<{ title: string; body: string; labels: string[] }> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
  })
  const labels: string[] = []
  for (const label of data.labels) {
    const name = typeof label === 'string' ? label : label.name
    if (name !== undefined) labels.push(name)
  }
  return { title: data.title, body: data.body ?? '', labels }
}

export type MasonDeps = {
  generate: typeof callModel
  issueNumber?: number
  conventions?: string
  context?: string
}

export async function handler(
  run: BotRun,
  deps: MasonDeps = { generate: callModel },
): Promise<LedgerEvent[]> {
  const issueNumber = deps.issueNumber ?? (await issueNumberFromEnv())
  const issue = await fetchIssue(run.octokit, run.repo, issueNumber)

  const requirementId = issueRequirementId(issue.title, issue.body)
  if (requirementId === null) {
    run.log(`issue #${issueNumber} names no requirement, refusing to build it`)
    return []
  }

  const requirements = await loadRequirements()
  const requirement = requirements.find((item) => item.id === requirementId)
  if (requirement === undefined) {
    run.log(`issue #${issueNumber} names ${requirementId}, which is not in the spec`)
    return []
  }

  const base = await defaultBranch(run.octokit, run.repo)
  const paths = await listRepoPaths(run.octokit, run.repo, base)
  const conventions = deps.conventions ?? (await readConventions())
  const context = deps.context ?? (await readRepoContext())
  const prompt = buildPrompt(requirement, issueNumber, paths, conventions, context)

  if (run.dryRun) {
    run.log(
      `dry run, would implement ${requirement.id} on ${branchName(requirement.id, requirement.text)}` +
        ` (${conventions.length} chars of conventions, ${context.length} chars of source)`,
    )
    return []
  }

  const result = await deps.generate({
    persona: run.persona,
    messages: [{ role: 'user', content: prompt }],
    model: MODEL,
  })

  const plan = planImplementation(requirement, issueNumber, result.text, readNotes(result.text))

  await createBranch(run.octokit, run.repo, plan.branch, base)
  await commitFiles(run.octokit, run.repo, plan.branch, plan.files, `${requirement.id}`)
  const pullNumber = await openPullRequest(run.octokit, run.repo, {
    head: plan.branch,
    base,
    title: plan.title,
    body: plan.body,
  })

  run.log(`opened #${pullNumber} on ${plan.branch} (${plan.files.length} file(s), $${result.costUsd.toFixed(4)})`)

  return [
    makeEvent({
      bot: SLUG,
      action: 'issue.claimed',
      req: requirement.id,
      artifact: String(issueNumber),
      costUsd: result.costUsd,
    }),
    makeEvent({
      bot: SLUG,
      action: 'pr.opened',
      req: requirement.id,
      artifact: String(pullNumber),
      costUsd: 0,
    }),
  ]
}

if (isEntry(process.argv[1] ?? '', 'mason')) {
  await runBot(SLUG, handler)
}
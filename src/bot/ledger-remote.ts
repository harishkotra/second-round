/**
 * The ledger, read and written through the Contents API.
 *
 * The ledger lives on its own `ledger` branch rather than on main, because main
 * is protected: a bot cannot push to it, and should not be able to. Keeping the
 * record on a machine-owned branch means no branch-protection bypass is needed
 * and the product code stays gated.
 *
 * Each bot writes only its own file (ledger/<bot>.ndjson), and each bot workflow
 * has its own concurrency group, so two runs of the same bot cannot collide.
 */

import type { Octokit } from 'octokit'
import { parseLedger } from '../ledger/append.js'
import { serializeEvent, type LedgerEvent } from '../ledger/schema.js'
import type { BotSlug, RepoContext } from './github.js'

export const LEDGER_BRANCH = 'ledger'

export function ledgerPath(bot: BotSlug): string {
  return `ledger/${bot}.ndjson`
}

function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

type RemoteFile = { content: string; sha: string }

async function readFileOnBranch(
  octokit: Octokit,
  ctx: RepoContext,
  path: string,
  branch: string,
): Promise<RemoteFile | null> {
  let payload: unknown
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: ctx.owner,
      repo: ctx.repo,
      path,
      ref: branch,
    })
    payload = response.data
  } catch (error) {
    if (statusOf(error) === 404) return null
    throw error
  }

  if (Array.isArray(payload) || typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const content = record['content']
  const sha = record['sha']
  if (typeof content !== 'string' || typeof sha !== 'string') return null

  return { content: Buffer.from(content, 'base64').toString('utf8'), sha }
}

export async function readRemoteLedger(
  octokit: Octokit,
  ctx: RepoContext,
  bot: BotSlug,
  branch: string = LEDGER_BRANCH,
): Promise<LedgerEvent[]> {
  const file = await readFileOnBranch(octokit, ctx, ledgerPath(bot), branch)
  return file === null ? [] : parseLedger(file.content)
}

export async function branchExists(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string,
): Promise<boolean> {
  try {
    await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner: ctx.owner,
      repo: ctx.repo,
      branch,
    })
    return true
  } catch (error) {
    if (statusOf(error) === 404) return false
    throw error
  }
}

/**
 * Creates the ledger branch on first use, so the crew is self-sufficient and
 * nobody has to remember a setup step. The branch is seeded from the default
 * branch head, which is all a fresh branch needs.
 */
export async function ensureLedgerBranch(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string = LEDGER_BRANCH,
): Promise<boolean> {
  if (await branchExists(octokit, ctx, branch)) return false

  const { data: repoInfo } = await octokit.request('GET /repos/{owner}/{repo}', {
    owner: ctx.owner,
    repo: ctx.repo,
  })

  const { data: head } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `heads/${repoInfo.default_branch}`,
  })

  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `refs/heads/${branch}`,
    sha: head.object.sha,
  })

  return true
}

export async function appendRemoteLedger(
  octokit: Octokit,
  ctx: RepoContext,
  bot: BotSlug,
  events: LedgerEvent[],
  message: string,
  branch: string = LEDGER_BRANCH,
): Promise<void> {
  if (events.length === 0) return

  const file = await readFileOnBranch(octokit, ctx, ledgerPath(bot), branch)
  const existing = file === null ? [] : parseLedger(file.content)

  // A missing file on the first run means the branch may not exist either.
  if (file === null) await ensureLedgerBranch(octokit, ctx, branch)

  const content = `${[...existing, ...events].map(serializeEvent).join('\n')}\n`

  const base = {
    owner: ctx.owner,
    repo: ctx.repo,
    path: ledgerPath(bot),
    branch,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
  }

  await octokit.request(
    'PUT /repos/{owner}/{repo}/contents/{path}',
    file === null ? base : { ...base, sha: file.sha },
  )
}
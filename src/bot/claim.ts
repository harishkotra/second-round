/**
 * Label leases (C-005).
 *
 * GitHub itself is the work queue. An issue is claimed by applying a
 * `claimed:<bot>` label, which is a single API call and therefore atomic
 * enough, and which is public, which is the point of the showcase.
 */

import type { Octokit } from 'octokit'
import type { BotSlug, RepoContext } from './github.js'

const CLAIM_PREFIX = 'claimed:'

export function claimLabel(bot: BotSlug): string {
  return `${CLAIM_PREFIX}${bot}`
}

export function claimedBy(labels: string[]): string | null {
  for (const label of labels) {
    if (label.startsWith(CLAIM_PREFIX)) return label.slice(CLAIM_PREFIX.length)
  }
  return null
}

export function isClaimed(labels: string[]): boolean {
  return claimedBy(labels) !== null
}

type LabelLike = string | { name?: string | undefined }

export function normalizeLabels(labels: LabelLike[]): string[] {
  const out: string[] = []
  for (const label of labels) {
    const name = typeof label === 'string' ? label : label.name
    if (name !== undefined && name !== '') out.push(name)
  }
  return out
}

export async function listLabels(
  octokit: Octokit,
  ctx: RepoContext,
  issueNumber: number,
): Promise<string[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
  })
  return normalizeLabels(data.labels)
}

export async function claimIssue(
  octokit: Octokit,
  ctx: RepoContext,
  issueNumber: number,
  bot: BotSlug,
): Promise<boolean> {
  const labels = await listLabels(octokit, ctx, issueNumber)
  if (isClaimed(labels)) return false

  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
    labels: [claimLabel(bot)],
  })
  return true
}

export async function releaseClaim(
  octokit: Octokit,
  ctx: RepoContext,
  issueNumber: number,
  bot: BotSlug,
): Promise<void> {
  await octokit.request(
    'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',
    {
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: issueNumber,
      name: claimLabel(bot),
    },
  )
}
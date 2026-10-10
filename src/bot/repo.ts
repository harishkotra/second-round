/**
 * Repository operations shared by the bots.
 *
 * Branches and pull requests only. Nothing here can touch main, and nothing here
 * merges: that is Turnstile's sole privilege, and keeping it separate is the
 * point of the design.
 */

import type { Octokit } from 'octokit'
import type { RepoContext } from './github.js'
import type { FileChange } from './patch.js'

export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, max).replace(/-+$/, '')
}

export function branchName(requirementId: string, title: string): string {
  return `bot/${requirementId}/${slugify(title)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export async function defaultBranch(octokit: Octokit, ctx: RepoContext): Promise<string> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}', {
    owner: ctx.owner,
    repo: ctx.repo,
  })
  return data.default_branch
}

export async function createBranch(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string,
  fromBranch: string,
): Promise<void> {
  const { data: head } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `heads/${fromBranch}`,
  })

  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `refs/heads/${branch}`,
    sha: head.object.sha,
  })
}

export async function commitFiles(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string,
  files: FileChange[],
  message: string,
): Promise<void> {
  for (const file of files) {
    let sha: string | undefined
    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: ctx.owner,
        repo: ctx.repo,
        path: file.path,
        ref: branch,
      })
      const record = asRecord(data)
      const existing = record === null ? undefined : record['sha']
      if (typeof existing === 'string') sha = existing
    } catch (error) {
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : null
      if (status !== 404) throw error
    }

    const body = {
      owner: ctx.owner,
      repo: ctx.repo,
      path: file.path,
      branch,
      message: `${message} (${file.path})`,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
    }

    await octokit.request(
      'PUT /repos/{owner}/{repo}/contents/{path}',
      sha === undefined ? body : { ...body, sha },
    )
  }
}

export async function openPullRequest(
  octokit: Octokit,
  ctx: RepoContext,
  options: { head: string; base: string; title: string; body: string },
): Promise<number> {
  const { data } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: ctx.owner,
    repo: ctx.repo,
    head: options.head,
    base: options.base,
    title: options.title,
    body: options.body,
  })
  return data.number
}

function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

/**
 * The open pull request whose head is `branch`, or null.
 *
 * This exists so a second attempt at a requirement updates the pull request that
 * already exists instead of opening another one beside it. Without it, every
 * retry produces a new pull request for the same requirement, and the review
 * history for that requirement is scattered across all of them.
 */
export async function findOpenPullRequest(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string,
): Promise<number | null> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
    owner: ctx.owner,
    repo: ctx.repo,
    head: `${ctx.owner}:${branch}`,
    state: 'open',
    per_page: 100,
  })
  const first: (typeof data)[number] | undefined = data[0]
  return first === undefined ? null : first.number
}

/** Creates the branch only when it is missing, so a retry can reuse it. */
export async function ensureBranch(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string,
  fromBranch: string,
): Promise<boolean> {
  try {
    await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
      owner: ctx.owner,
      repo: ctx.repo,
      branch,
    })
    return false
  } catch (error) {
    if (statusOf(error) !== 404) throw error
  }

  await createBranch(octokit, ctx, branch, fromBranch)
  return true
}

export async function updatePullRequest(
  octokit: Octokit,
  ctx: RepoContext,
  pullNumber: number,
  options: { title: string; body: string },
): Promise<void> {
  await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: pullNumber,
    title: options.title,
    body: options.body,
  })
}

export type PullRequestView = {
  number: number
  title: string
  body: string
  headSha: string
  baseBranch: string
  files: { path: string; patch: string | null }[]
}

export async function pullRequestView(
  octokit: Octokit,
  ctx: RepoContext,
  pullNumber: number,
): Promise<PullRequestView> {
  const { data: pr } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: pullNumber,
  })

  const { data: files } = await octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
    { owner: ctx.owner, repo: ctx.repo, pull_number: pullNumber, per_page: 100 },
  )

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    files: files.map((file) => ({ path: file.filename, patch: file.patch ?? null })),
  }
}

export function diffText(view: PullRequestView, limit = 12000): string {
  const parts: string[] = []
  for (const file of view.files) {
    parts.push(`--- ${file.path}`)
    parts.push(file.patch ?? '(binary or too large to display)')
  }
  return parts.join('\n').slice(0, limit)
}

export async function submitReview(
  octokit: Octokit,
  ctx: RepoContext,
  pullNumber: number,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body: string,
): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: pullNumber,
    event,
    body,
  })
}

export type CheckRun = {
  name: string
  conclusion: string | null
  status: string
}

export async function listCheckRuns(
  octokit: Octokit,
  ctx: RepoContext,
  ref: string,
): Promise<CheckRun[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
    owner: ctx.owner,
    repo: ctx.repo,
    ref,
    per_page: 100,
  })
  return data.check_runs.map((run) => ({
    name: run.name,
    conclusion: run.conclusion,
    status: run.status,
  }))
}

export type Review = {
  login: string
  state: string
}

export async function listReviews(
  octokit: Octokit,
  ctx: RepoContext,
  pullNumber: number,
): Promise<Review[]> {
  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
    { owner: ctx.owner, repo: ctx.repo, pull_number: pullNumber, per_page: 100 },
  )
  const reviews: Review[] = []
  for (const review of data) {
    const login = review.user?.login
    if (login !== undefined) reviews.push({ login, state: review.state })
  }
  return reviews
}

export async function mergePullRequest(
  octokit: Octokit,
  ctx: RepoContext,
  pullNumber: number,
): Promise<string> {
  const { data } = await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: pullNumber,
    merge_method: 'squash',
  })
  return data.sha
}

export async function listRepoPaths(
  octokit: Octokit,
  ctx: RepoContext,
  branch: string,
): Promise<string[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
    owner: ctx.owner,
    repo: ctx.repo,
    tree_sha: branch,
    recursive: 'true',
  })
  return data.tree.map((entry) => entry.path).filter((path): path is string => path !== undefined)
}
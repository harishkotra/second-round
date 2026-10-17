/**
 * Pull requests, and the issues they deliver.
 *
 * Split out of repo.ts, which had grown past the file-length rule while carrying
 * two separate concerns: branches and files on one side, pull requests on the
 * other. This is the second one. Nothing here can merge or approve: that stays
 * Turnstile's sole privilege, and keeping it out of reach is the point.
 */

import type { Octokit } from 'octokit'
import type { RepoContext } from './github.js'

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

export type OpenPullRequest = { number: number; title: string; headRef: string }

/** Every open pull request, so a merger can sweep rather than wait for an event. */
export async function listOpenPullRequests(
  octokit: Octokit,
  ctx: RepoContext,
): Promise<OpenPullRequest[]> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
    owner: ctx.owner,
    repo: ctx.repo,
    state: 'open',
    per_page: 100,
  })
  return data.map((pull) => ({ number: pull.number, title: pull.title, headRef: pull.head.ref }))
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

/**
 * Closes an issue with a comment saying why.
 *
 * This exists because the queue has to reflect what actually shipped. Issue #1
 * was still open after its pull request merged, despite `Resolves #1` being in
 * the body, so relying on GitHub's closing keywords is not enough. The merger
 * closes the issue explicitly, and the reason it closed is on the record.
 */
export async function closeIssue(
  octokit: Octokit,
  ctx: RepoContext,
  issueNumber: number,
  comment: string,
): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
    body: comment,
  })
  await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: issueNumber,
    state: 'closed',
  })
}
/**
 * What the operator can do to the repository.
 *
 * Kept out of repo.ts because these are not things a crew member does to a
 * branch or a pull request. These are the levers the watchdog pulls: read how a
 * bot's last runs went, ask a workflow to run again, create the label an
 * escalation needs, and file the escalation itself.
 */

import type { Octokit } from 'octokit'
import type { RepoContext } from './github.js'

export type RunSummary = {
  conclusion: string | null
  createdAt: string
}

/** The most recent runs of one workflow, newest first. */
export async function listWorkflowRuns(
  octokit: Octokit,
  ctx: RepoContext,
  workflowFile: string,
  perPage = 5,
): Promise<RunSummary[]> {
  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs',
    {
      owner: ctx.owner,
      repo: ctx.repo,
      workflow_id: workflowFile,
      per_page: perPage,
    },
  )
  return data.workflow_runs.map((run) => ({
    conclusion: run.conclusion,
    createdAt: run.created_at,
  }))
}

/** Asks a workflow to run now, on the default branch. */
export async function dispatchWorkflow(
  octokit: Octokit,
  ctx: RepoContext,
  workflowFile: string,
  ref = 'main',
): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
    owner: ctx.owner,
    repo: ctx.repo,
    workflow_id: workflowFile,
    ref,
  })
}

/**
 * Creates a label, tolerating the case where it already exists.
 *
 * An issue opened with a label that does not exist simply loses the label, and
 * the escalation would then look like ordinary work.
 */
export async function ensureLabel(
  octokit: Octokit,
  ctx: RepoContext,
  name: string,
  color: string,
  description: string,
): Promise<void> {
  try {
    await octokit.request('POST /repos/{owner}/{repo}/labels', {
      owner: ctx.owner,
      repo: ctx.repo,
      name,
      color,
      description,
    })
  } catch (error) {
    if (statusOf(error) !== 422) throw error
  }
}

export async function openIssue(
  octokit: Octokit,
  ctx: RepoContext,
  options: { title: string; body: string; labels: string[] },
): Promise<number> {
  const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner: ctx.owner,
    repo: ctx.repo,
    title: options.title,
    body: options.body,
    labels: options.labels,
  })
  return data.number
}

export function statusOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}
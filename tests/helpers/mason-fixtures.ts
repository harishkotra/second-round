/**
 * Shared fixtures for Mason's tests.
 *
 * Split out when the test file passed the file-length rule. The pure-function
 * tests and the handler tests are two different jobs, and both need the same
 * routes, the same fake model and the same injected self-check.
 */

import type { BotRun } from '../../src/bot/run.js'
import type { CheckResult } from '../../src/bot/verify.js'
import { SLUG } from '../../src/bots/mason.js'
import type { Requirement } from '../../src/spec/load.js'
import type { RouteHandler } from './fake-octokit.js'

export const ctx = { owner: 'o', repo: 'r' }

export const GET_ISSUE = 'GET /repos/{owner}/{repo}/issues/{issue_number}'
export const GET_REPO = 'GET /repos/{owner}/{repo}'
export const GET_TREE = 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}'
export const GET_REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}'
export const CREATE_REF = 'POST /repos/{owner}/{repo}/git/refs'
export const GET_BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}'
export const GET_CONTENT = 'GET /repos/{owner}/{repo}/contents/{path}'
export const PUT_CONTENT = 'PUT /repos/{owner}/{repo}/contents/{path}'
export const CREATE_PR = 'POST /repos/{owner}/{repo}/pulls'
export const GET_PULLS = 'GET /repos/{owner}/{repo}/pulls'
export const PATCH_PR = 'PATCH /repos/{owner}/{repo}/pulls/{pull_number}'
export const GET_ISSUES = 'GET /repos/{owner}/{repo}/issues'
export const ADD_LABELS = 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels'
export const REMOVE_LABEL = 'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}'

export const requirement: Requirement = {
  id: 'R-001',
  phase: 0,
  text: 'Accept a pasted job description',
}

export const runBase: Omit<BotRun, 'octokit'> = {
  slug: SLUG,
  repo: ctx,
  persona: '# a persona',
  dryRun: false,
  history: [],
  log: () => undefined,
}

export function happyRoutes(): Record<string, RouteHandler> {
  return {
    [GET_ISSUE]: () => ({
      title: '[R-001] Accept a pasted job description',
      body: 'Closes R-001',
      labels: [],
    }),
    [GET_REPO]: () => ({ default_branch: 'main' }),
    [GET_TREE]: () => ({ tree: [{ path: 'package.json' }, { path: 'src/index.ts' }] }),
    [GET_REF]: () => ({ object: { sha: 'head-sha' } }),
    [CREATE_REF]: () => ({}),
    [GET_BRANCH]: () => {
      throw Object.assign(new Error('HTTP 404'), { status: 404 })
    },
    [GET_PULLS]: () => [],
    [PATCH_PR]: () => ({}),
    [GET_ISSUES]: () => [],
    [ADD_LABELS]: () => ({}),
    [REMOVE_LABEL]: () => ({}),
    [GET_CONTENT]: () => {
      throw Object.assign(new Error('HTTP 404'), { status: 404 })
    },
    [PUT_CONTENT]: () => ({}),
    [CREATE_PR]: () => ({ number: 77 }),
  }
}

export const patchText =
  '{"files":[{"path":"src/app/intake.ts","content":"export const intake = true"}],"notes":"first pass"}'

export function generate(text: string): () => Promise<{
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}> {
  return async () => ({
    text,
    model: 'deepseek-v4.1-flash',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.0021,
  })
}

/**
 * The self-check is injected everywhere in these tests. Without it the handler
 * would call the real verifier, which writes files into the working tree and runs
 * npm inside the test process.
 */
export const passingVerify = async (): Promise<CheckResult> => ({ ok: true, output: '' })

export const failingVerify = async (): Promise<CheckResult> => ({
  ok: false,
  output: 'typecheck failed: src/app/intake.ts(1,1)',
})
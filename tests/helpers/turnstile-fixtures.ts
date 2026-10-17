/**
 * Shared fixtures for Turnstile's tests.
 *
 * Split out when the test file passed the file-length rule. The gate tests are
 * pure and the handler tests are the integration path; both need the same check
 * runs, the same fake routes and the same approved review.
 */

import type { CheckRun } from '../../src/bot/repo.js'
import type { BotRun } from '../../src/bot/run.js'
import { REQUIRED_CHECKS, SLUG, type MergeState } from '../../src/bots/turnstile.js'
import { httpError, type RouteHandler } from './fake-octokit.js'

export const ctx = { owner: 'o', repo: 'r' }

export const GET_PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}'
export const GET_PULLS = 'GET /repos/{owner}/{repo}/pulls'
export const GET_FILES = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files'
export const GET_CHECKS = 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs'
export const GET_REVIEWS = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews'
export const MERGE = 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'
export const GET_COMPARE = 'GET /repos/{owner}/{repo}/compare/{basehead}'
export const UPDATE_BRANCH = 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch'
export const GET_CONTENTS = 'GET /repos/{owner}/{repo}/contents/{path}'
export const COMMENT = 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments'
export const PATCH_ISSUE = 'PATCH /repos/{owner}/{repo}/issues/{issue_number}'

export const green: CheckRun[] = REQUIRED_CHECKS.map((name) => ({
  name,
  conclusion: 'success',
  status: 'completed',
  startedAt: '2026-01-01T00:00:10Z',
}))

/** The same names, cancelled, and started before the successful attempt. */
export const cancelled: CheckRun[] = REQUIRED_CHECKS.map((name) => ({
  name,
  conclusion: 'cancelled',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00Z',
}))

export const sentryApproved = [{ login: 'sr-sentry[bot]', state: 'APPROVED' }]

export function state(overrides: Partial<MergeState> = {}): MergeState {
  return {
    checks: green,
    reviews: sentryApproved,
    touchesSpec: false,
    humanApproved: false,
    ...overrides,
  }
}

export const runBase: Omit<BotRun, 'octokit'> = {
  slug: SLUG,
  repo: ctx,
  persona: '# a persona',
  dryRun: false,
  history: [],
  log: () => undefined,
}

export function routes(): Record<string, RouteHandler> {
  return {
    [GET_PR]: () => ({
      number: 12,
      title: 'x',
      body: 'Closes R-001',
      head: { sha: 'sha' },
      base: { ref: 'main' },
    }),
    [GET_FILES]: () => [{ filename: 'src/app/x.ts', patch: '+1' }],
    [GET_CHECKS]: () => ({ check_runs: green }),
    [GET_REVIEWS]: () => [{ user: { login: 'sr-sentry[bot]' }, state: 'APPROVED' }],
    [MERGE]: () => ({ sha: 'merged-sha' }),
    [GET_COMPARE]: () => ({ behind_by: 0 }),
    [UPDATE_BRANCH]: () => ({}),
    // No ledger by default, so the builder's claim is unknown and no issue is
    // closed. The close path is exercised by its own test.
    [GET_CONTENTS]: () => {
      throw httpError(404)
    },
    [COMMENT]: () => ({}),
    [PATCH_ISSUE]: () => ({}),
  }
}
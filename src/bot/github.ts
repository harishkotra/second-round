/**
 * Bot identity and environment.
 *
 * The installation token is minted by the workflow with the GitHub-owned
 * `actions/create-github-app-token` action, so nothing here hand-rolls the JWT
 * flow. Each bot therefore runs as a genuinely separate GitHub identity.
 */

import { Octokit } from 'octokit'

/**
 * The watchdog is the one slug without its own GitHub App, and deliberately so.
 *
 * Every other bot has an App because it needs a git identity: it opens pull
 * requests, reviews them, or merges them. The watchdog must be unable to do any
 * of those things. It dispatches other bots, releases leases, and files an issue
 * when it cannot help. Giving it a token that can write code would make it a
 * fifth builder, which is not the job.
 */
export const BOT_SLUGS = [
  'sr-foreman',
  'sr-mason',
  'sr-sentry',
  'sr-turnstile',
  'sr-watchdog',
] as const
export type BotSlug = (typeof BOT_SLUGS)[number]

export type RepoContext = {
  owner: string
  repo: string
}

export function isBotSlug(value: string): value is BotSlug {
  return (BOT_SLUGS as readonly string[]).includes(value)
}

export function repoFromEnv(env: NodeJS.ProcessEnv = process.env): RepoContext {
  const full = env['GITHUB_REPOSITORY']
  if (full === undefined || !full.includes('/')) {
    throw new Error('GITHUB_REPOSITORY must be set as "owner/repo"')
  }
  const [owner, repo] = full.split('/')
  if (owner === undefined || owner === '' || repo === undefined || repo === '') {
    throw new Error(`GITHUB_REPOSITORY is malformed: ${full}`)
  }
  return { owner, repo }
}

export function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env['GH_TOKEN']
  return token === undefined || token === '' ? null : token
}

export function makeOctokit(token: string | null): Octokit {
  return token === null ? new Octokit() : new Octokit({ auth: token })
}

export function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[name]
  return value === '1' || value === 'true'
}

export function isEntry(entry: string, name: string): boolean {
  return entry.endsWith(`${name}.ts`) || entry.endsWith(`${name}.js`)
}
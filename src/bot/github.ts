/**
 * Bot identity and environment.
 *
 * The installation token is minted by the workflow with the GitHub-owned
 * `actions/create-github-app-token` action, so nothing here hand-rolls the JWT
 * flow. Each bot therefore runs as a genuinely separate GitHub identity.
 */

import { Octokit } from 'octokit'

export const BOT_SLUGS = ['sr-foreman', 'sr-mason', 'sr-sentry', 'sr-turnstile'] as const
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
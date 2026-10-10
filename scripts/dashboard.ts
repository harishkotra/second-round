/**
 * Renders the dashboard and the changelog, then writes them to disk.
 *
 * Run by the Dashboard workflow, which commits the two files to a `dashboard`
 * branch and prints the same content into the run summary. It is a script rather
 * than a bot because it needs no identity of its own: it reads the ledger and
 * writes two generated files, and nothing it does is a decision.
 *
 * main is protected, so a bot cannot push there, and it should not. The
 * dashboard therefore lives on its own branch, regenerated from scratch every
 * run, and the README links to it.
 */

import { writeFile } from 'node:fs/promises'
import { claimedBy } from '../src/bot/claim.js'
import { makeOctokit, repoFromEnv, tokenFromEnv, type BotSlug } from '../src/bot/github.js'
import { readRemoteLedger } from '../src/bot/ledger-remote.js'
import { listOpenPullRequests } from '../src/bot/pulls.js'
import { listQueue } from '../src/bot/work.js'
import {
  renderChangelog,
  renderDashboard,
  type LiveState,
  type RequirementText,
} from '../src/ledger/dashboard.js'
import type { LedgerEvent } from '../src/ledger/schema.js'
import { loadRequirements } from '../src/spec/load.js'

const BOTS: readonly BotSlug[] = ['sr-foreman', 'sr-mason', 'sr-sentry', 'sr-turnstile']

async function main(): Promise<void> {
  const ctx = repoFromEnv()
  const octokit = makeOctokit(tokenFromEnv())

  const events: LedgerEvent[] = []
  for (const bot of BOTS) {
    events.push(...(await readRemoteLedger(octokit, ctx, bot)))
  }

  const openPrs = (await listOpenPullRequests(octokit, ctx)).map((pull) => ({
    number: pull.number,
    title: pull.title,
    head: pull.headRef,
  }))

  const claimed: LiveState['claimed'] = []
  for (const item of await listQueue(octokit, ctx)) {
    const holder = claimedBy(item.labels)
    if (holder !== null) claimed.push({ number: item.number, title: item.title, bot: holder })
  }

  const requirements: RequirementText[] = (await loadRequirements()).map((requirement) => ({
    id: requirement.id,
    text: requirement.text,
  }))

  const live: LiveState = { openPrs, claimed }
  const generatedAt = new Date().toISOString()

  const dashboard = renderDashboard(events, live, requirements, generatedAt)
  const changelog = renderChangelog(events, requirements)

  await writeFile('DASHBOARD.md', `${dashboard}\n`, 'utf8')
  await writeFile('CHANGELOG.md', `${changelog}\n`, 'utf8')

  // The workflow appends this to the run summary, so the same view exists in
  // the Actions tab without anyone opening the branch.
  console.log(dashboard)
}

await main()
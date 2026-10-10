import { describe, expect, test } from 'vitest'
import {
  delivered,
  renderChangelog,
  renderDashboard,
  type LiveState,
} from '../../src/ledger/dashboard.js'
import { makeEvent } from '../../src/ledger/schema.js'

const requirements = [
  { id: 'R-001', text: 'Accept a pasted job description or a job description URL.' },
  { id: 'R-002', text: 'Ask the follow-up question the answer earned.' },
]

const merged = makeEvent({
  bot: 'sr-turnstile',
  action: 'pr.merged',
  req: 'R-001',
  artifact: '32',
  ts: '2026-10-10T08:59:03.943Z',
})

const live: LiveState = {
  openPrs: [{ number: 33, title: '[R-002] Ask the follow-up', head: 'bot/R-002/ask' }],
  claimed: [{ number: 2, title: '[R-002] Ask the follow-up question', bot: 'sr-mason' }],
}

describe('delivered', () => {
  test('one entry per merged requirement, newest first', () => {
    const older = makeEvent({
      bot: 'sr-turnstile',
      action: 'pr.merged',
      req: 'R-002',
      artifact: '30',
      ts: '2026-10-09T00:00:00.000Z',
    })
    expect(delivered([merged, older]).map((entry) => entry.req)).toEqual(['R-001', 'R-002'])
  })

  test('ignores a merge that names no requirement', () => {
    const bare = makeEvent({ bot: 'sr-turnstile', action: 'pr.merged', artifact: '9' })
    expect(delivered([bare])).toEqual([])
  })
})

describe('renderDashboard', () => {
  test('shows what is happening, who is doing it, and what it cost', () => {
    const md = renderDashboard([merged], live, requirements, '2026-10-10T09:00:00.000Z')
    expect(md).toContain('# Live crew dashboard')
    expect(md).toContain('| Requirements delivered | 1 |')
    expect(md).toContain('| Requirements in flight | 1 |')
    expect(md).toContain('| Pull requests open | 1 |')
    expect(md).toContain('`sr-mason`')
    expect(md).toContain('#33')
    expect(md).toContain('Accept a pasted job description')
  })

  test('says so plainly when there is nothing to show', () => {
    const md = renderDashboard([], { openPrs: [], claimed: [] }, requirements, 'now')
    expect(md).toContain('Nothing is claimed right now.')
    expect(md).toContain('No pull requests are open.')
    expect(md).toContain('Nothing has reached main yet.')
    expect(md).toContain('The ledger is empty.')
  })

  test('falls back rather than throwing when a requirement is not in the spec', () => {
    const orphan = makeEvent({
      bot: 'sr-turnstile',
      action: 'pr.merged',
      req: 'R-099',
      artifact: '1',
    })
    expect(renderDashboard([orphan], live, requirements, 'now')).toContain('(not in the spec)')
  })
})

describe('renderChangelog', () => {
  test('names each shipped requirement and the pull request that shipped it', () => {
    const md = renderChangelog([merged], requirements)
    expect(md).toContain('## R-001 — Accept a pasted job description or a job description URL.')
    expect(md).toContain('in #32')
  })

  test('says nothing has shipped when nothing has', () => {
    expect(renderChangelog([], requirements)).toContain('Nothing has shipped yet.')
  })
})
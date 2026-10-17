import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { appendEvent, appendEvents, parseLedger, readEvents } from '../../src/ledger/append.js'
import { makeEvent } from '../../src/ledger/schema.js'

async function tmpPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'ledger-')), 'events.ndjson')
}

describe('append and read', () => {
  test('round-trips events in order', async () => {
    const path = await tmpPath()
    await appendEvent(path, makeEvent({ bot: 'sr-mason', action: 'pr.opened', artifact: '42' }))
    await appendEvent(
      path,
      makeEvent({ bot: 'sr-sentry', action: 'pr.reviewed', verdict: 'rejected', reason: 'R-005' }),
    )
    const events = await readEvents(path)
    expect(events).toHaveLength(2)
    expect(events[1]?.verdict).toBe('rejected')
  })

  test('reading a missing file yields an empty history, not an error', async () => {
    expect(await readEvents(await tmpPath())).toEqual([])
  })

  test('appending nothing writes nothing', async () => {
    const path = await tmpPath()
    await appendEvents(path, [])
    expect(await readEvents(path)).toEqual([])
  })

  test('creates missing parent directories', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ledger-'))
    const path = join(base, 'nested', 'deep', 'events.ndjson')
    await appendEvent(path, makeEvent({ bot: 'sr-foreman', action: 'issue.opened' }))
    expect(await readEvents(path)).toHaveLength(1)
  })
})

describe('parseLedger', () => {
  test('skips blank lines', () => {
    expect(parseLedger('\n\n')).toEqual([])
  })

  test('names the line number of a malformed entry', () => {
    const good = JSON.stringify(makeEvent({ bot: 'sr-foreman', action: 'issue.opened' }))
    expect(() => parseLedger(`${good}\n{"bot":"x"}\n`)).toThrow(/line 2/)
  })
})
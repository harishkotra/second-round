/**
 * Reading and appending the ledger.
 *
 * The record is one JSON object per line, append-only. A malformed line is a
 * hard failure with the line number named, never a silent skip: a record you
 * cannot trust is worse than no record.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseLedgerLine, serializeEvent, type LedgerEvent } from './schema.js'

export function parseLedger(raw: string): LedgerEvent[] {
  const out: LedgerEvent[] = []
  const lines = raw.split('\n')

  lines.forEach((line, index) => {
    if (line.trim() === '') return
    try {
      out.push(parseLedgerLine(line))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`ledger line ${index + 1}: ${message}`)
    }
  })

  return out
}

export async function appendEvents(path: string, events: LedgerEvent[]): Promise<void> {
  if (events.length === 0) return
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${events.map(serializeEvent).join('\n')}\n`, 'utf8')
}

export async function appendEvent(path: string, event: LedgerEvent): Promise<void> {
  await appendEvents(path, [event])
}

export async function readEvents(path: string): Promise<LedgerEvent[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null
    if (code === 'ENOENT') return []
    throw error
  }
  return parseLedger(raw)
}
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  checkReqId,
  isDirectRun,
  loadValidIds,
  run,
} from '../../scripts/check-req-id.js'

const ids = new Set(['R-001', 'C-007'])

describe('checkReqId', () => {
  test('accepts a valid product requirement id', () => {
    expect(checkReqId('Closes R-001', ids)).toEqual({ ok: true, id: 'R-001' })
  })

  test('accepts a valid crew requirement id', () => {
    expect(checkReqId('Some context.\n\nCloses C-007', ids)).toEqual({
      ok: true,
      id: 'C-007',
    })
  })

  test('accepts the Fixes and Resolves synonyms', () => {
    expect(checkReqId('Fixes R-001', ids).ok).toBe(true)
    expect(checkReqId('Resolves R-001', ids).ok).toBe(true)
  })

  test('rejects an empty body', () => {
    expect(checkReqId('', ids).ok).toBe(false)
  })

  test('rejects whitespace-only body', () => {
    const result = checkReqId('   \n\t ', ids)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('empty')
  })

  test('rejects a body with no id at all', () => {
    const result = checkReqId('refactored the thing, looks good', ids)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('no requirement id found')
  })

  test('rejects an unknown id and names it', () => {
    const result = checkReqId('Closes R-999', ids)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('R-999')
  })

  test('passes when any referenced id is valid', () => {
    expect(checkReqId('Closes R-999\nCloses R-001', ids)).toEqual({
      ok: true,
      id: 'R-001',
    })
  })

  test('does not match an id embedded in a word', () => {
    expect(checkReqId('Closes XR-0010', ids).ok).toBe(false)
  })

  test('does not match a bare id with no Closes keyword', () => {
    expect(checkReqId('This relates to R-001 somehow', ids).ok).toBe(false)
  })
})

describe('loadValidIds', () => {
  test('reads every id from the real spec file', async () => {
    const real = await loadValidIds()
    expect(real.size).toBeGreaterThanOrEqual(30)
    expect(real.has('R-001')).toBe(true)
    expect(real.has('R-018')).toBe(true)
    expect(real.has('C-001')).toBe(true)
    expect(real.has('C-012')).toBe(true)
  })

  test('ignores lines that are not requirement ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'second-round-spec-'))
    await writeFile(
      join(dir, 'requirements.yaml'),
      [
        'requirements:',
        '  - id: R-001',
        '    text: a real one',
        '  - text: a line with no id',
        '  - id: not-an-id',
        '  - id: R-00',
        '',
      ].join('\n'),
    )
    expect([...(await loadValidIds(dir))]).toEqual(['R-001'])
  })

  test('returns an empty set when the file has no ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'second-round-spec-'))
    await writeFile(join(dir, 'requirements.yaml'), 'requirements: []\n')
    expect((await loadValidIds(dir)).size).toBe(0)
  })
})

describe('isDirectRun', () => {
  test('is true when the module is the entry point', () => {
    expect(isDirectRun('/some/path/check-req-id.ts')).toBe(true)
    expect(isDirectRun('/some/path/check-req-id.js')).toBe(true)
  })

  test('is false when a test runner is the entry point', () => {
    expect(isDirectRun('/usr/local/bin/vitest')).toBe(false)
  })
})

describe('run (the CI entry point, in-process)', () => {
  test('passes when there is no PR body, as on a push to main', async () => {
    expect(await run('')).toBe(0)
  })

  test('passes when the body names a real requirement', async () => {
    expect(await run('Adds the JD intake field.\n\nCloses R-001')).toBe(0)
  })

  test('fails when the body names a requirement that does not exist', async () => {
    expect(await run('Closes R-999')).toBe(1)
  })

  test('fails when the body names no requirement at all', async () => {
    expect(await run('quick fix, no issue')).toBe(1)
  })
})
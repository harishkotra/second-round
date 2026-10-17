import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MAX_OUTPUT_CHARS, runCheck, verifyLocally, writeChanges } from '../../src/bot/verify.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-verify-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Real npm, but harmless and fast: --version always succeeds. */
const PASS = { name: 'ok', args: ['--version'] }
/** A script that cannot exist, so npm exits non-zero. */
const FAIL = { name: 'broken', args: ['run', 'no-such-script-exists'] }

describe('writeChanges', () => {
  test('writes files and creates the directories they need', async () => {
    const written = await writeChanges(
      [{ path: 'src/deep/nested/thing.ts', content: 'export const thing = 1' }],
      root,
    )
    expect(written).toEqual(['src/deep/nested/thing.ts'])
    expect(await readFile(join(root, 'src/deep/nested/thing.ts'), 'utf8')).toBe(
      'export const thing = 1',
    )
  })
})

describe('runCheck', () => {
  test('reports success', async () => {
    expect((await runCheck(PASS.args, root)).ok).toBe(true)
  })

  test('reports failure with output the model can act on', async () => {
    const result = await runCheck(FAIL.args, root)
    expect(result.ok).toBe(false)
    expect(result.output.length).toBeGreaterThan(0)
  })
})

describe('verifyLocally', () => {
  test('ok when every check passes', async () => {
    const result = await verifyLocally([{ path: 'src/a.ts', content: 'x' }], root, [PASS])
    expect(result.ok).toBe(true)
    expect(result.output).toBe('')
  })

  test('names the check that failed, so the repair prompt has a target', async () => {
    const result = await verifyLocally([{ path: 'src/a.ts', content: 'x' }], root, [FAIL])
    expect(result.ok).toBe(false)
    expect(result.output).toContain('### broken failed')
  })

  test('reports every failing check, not only the first', async () => {
    const result = await verifyLocally([{ path: 'src/a.ts', content: 'x' }], root, [FAIL, FAIL])
    expect(result.output.match(/### broken failed/g)).toHaveLength(2)
  })

  test('caps the output so a repair prompt cannot explode', async () => {
    const result = await verifyLocally([{ path: 'src/a.ts', content: 'x' }], root, [FAIL])
    expect(result.output.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS)
  })
})
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  CONVENTION_FILES,
  listSourceFiles,
  readConventions,
  readRepoContext,
} from '../../src/bot/context.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-context-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readConventions', () => {
  test('reads the conventions file when it is present', async () => {
    await writeFile(join(root, 'CONVENTIONS.md'), 'use .js extensions\n')
    expect(await readConventions(root)).toBe('use .js extensions')
  })

  test('prefers AGENTS.md when both files exist', async () => {
    await writeFile(join(root, 'AGENTS.md'), 'agents wins')
    await writeFile(join(root, 'CONVENTIONS.md'), 'conventions loses')
    expect(await readConventions(root)).toBe('agents wins')
  })

  test('empty string when neither file exists', async () => {
    expect(await readConventions(root)).toBe('')
  })

  test('declares both filenames it will look for', () => {
    expect([...CONVENTION_FILES]).toEqual(['AGENTS.md', 'CONVENTIONS.md'])
  })
})

describe('listSourceFiles', () => {
  test('lists source files relative to the root, sorted', async () => {
    await mkdir(join(root, 'src', 'bot'), { recursive: true })
    await writeFile(join(root, 'src', 'b.ts'), '')
    await writeFile(join(root, 'src', 'bot', 'a.ts'), '')
    await writeFile(join(root, 'src', 'notes.md'), '')
    expect(await listSourceFiles(join(root, 'src'), root)).toEqual(['src/b.ts', 'src/bot/a.ts'])
  })

  test('skips node_modules and dist', async () => {
    await mkdir(join(root, 'src', 'node_modules'), { recursive: true })
    await mkdir(join(root, 'src', 'dist'), { recursive: true })
    await writeFile(join(root, 'src', 'node_modules', 'x.ts'), '')
    await writeFile(join(root, 'src', 'dist', 'y.ts'), '')
    await writeFile(join(root, 'src', 'keep.ts'), '')
    expect(await listSourceFiles(join(root, 'src'), root)).toEqual(['src/keep.ts'])
  })

  test('empty when the directory does not exist', async () => {
    expect(await listSourceFiles(join(root, 'nope'), root)).toEqual([])
  })
})

describe('readRepoContext', () => {
  test('includes file contents under labelled headers', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1')
    const context = await readRepoContext(root)
    expect(context).toContain('=== src/a.ts ===')
    expect(context).toContain('export const a = 1')
  })

  test('names the files it had to omit once the budget is spent', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'x'.repeat(200))
    await writeFile(join(root, 'src', 'b.ts'), 'y'.repeat(200))
    const context = await readRepoContext(root, 250)
    expect(context).toContain('=== src/a.ts ===')
    expect(context).toContain('not shown, context budget reached')
    expect(context).toContain('src/b.ts')
  })

  test('empty when there is no src directory', async () => {
    expect(await readRepoContext(root)).toBe('')
  })
})
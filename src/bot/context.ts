/**
 * The context a builder needs before it writes a line: the repository's
 * conventions, and the current contents of the code it is about to change.
 *
 * This module exists because of a real failure. The first live pull request
 * (R-001, PR #31) failed CI twice and was rejected in review, and both problems
 * had one cause: the builder was given a list of file names and nothing else.
 * It could not see the ESM import convention, so its imports failed typecheck.
 * It could not see `src/bots/mason.ts`, so it refused to edit it and invented an
 * orphan module instead, which meant the requirement was never actually met.
 *
 * Both were context failures, not model failures. The fix is to hand the builder
 * what a human contributor would have: the conventions, and the code.
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Roughly 20k tokens of source. Enough for this repository, cheap to send. */
export const DEFAULT_BUDGET_BYTES = 80_000

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git'])

const WANTED = ['.ts', '.json']

/**
 * The repository's conventions file, or an empty string if none exists.
 *
 * `AGENTS.md` is the conventional name and is preferred when present, but it is
 * a protected filename on some machines, so `CONVENTIONS.md` is read as well.
 */
export const CONVENTION_FILES = ['AGENTS.md', 'CONVENTIONS.md'] as const

export async function readConventions(root: string = process.cwd()): Promise<string> {
  for (const name of CONVENTION_FILES) {
    try {
      return (await readFile(join(root, name), 'utf8')).trim()
    } catch {
      continue
    }
  }
  return ''
}

/** Every source file under `dir`, as repository-relative POSIX paths, sorted. */
export async function listSourceFiles(dir: string, root: string): Promise<string[]> {
  const out: string[] = []

  async function walk(current: string): Promise<void> {
    let entries: Dirent<string>[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (WANTED.some((extension) => entry.name.endsWith(extension))) {
        out.push(relative(root, full).split(sep).join('/'))
      }
    }
  }

  await walk(dir)
  return out.sort()
}

/**
 * The contents of every source file, as labelled blocks, up to a byte budget.
 * Files past the budget are named but not included, so the builder still knows
 * they exist.
 */
export async function readRepoContext(
  root: string = process.cwd(),
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): Promise<string> {
  const files = await listSourceFiles(join(root, 'src'), root)
  const blocks: string[] = []
  const omitted: string[] = []
  let used = 0

  for (const file of files) {
    let text: string
    try {
      text = await readFile(join(root, file), 'utf8')
    } catch {
      continue
    }
    if (used + text.length > budgetBytes) {
      omitted.push(file)
      continue
    }
    used += text.length
    blocks.push(`=== ${file} ===\n${text}`)
  }

  if (omitted.length > 0) {
    blocks.push(`=== not shown, context budget reached ===\n${omitted.join('\n')}`)
  }

  return blocks.join('\n\n')
}
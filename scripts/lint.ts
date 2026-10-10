/**
 * The no-slop gate.
 *
 * Deliberately dependency-free and deterministic. Curator (the slop auditor bot)
 * will grow richer analysis later; this is the floor that never regresses, and it
 * runs in CI on every pull request.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOTS = ['src', 'scripts', 'api', 'tests']
const MAX_LINES = 400

// The rule definitions below necessarily contain the very patterns they look
// for, so this file exempts itself from its own rules. Keep it the only entry,
// and keep the file-length check applying to everything including this file.
const SELF_EXEMPT = new Set(['scripts/lint.ts'])

type Violation = { file: string; line: number; rule: string; detail: string }

type Rule = {
  name: string
  pattern: RegExp
  detail: string
  appliesTo?: (path: string) => boolean
}

const isTest = (p: string): boolean => p.includes('/tests/') || p.startsWith('tests/')
const isScript = (p: string): boolean => p.includes('/scripts/') || p.startsWith('scripts/')

const RULES: Rule[] = [
  {
    name: 'placeholder-comment',
    pattern: /\bTODO\b|\bFIXME\b|\bXXX\b/,
    detail: 'placeholder comment committed',
  },
  {
    name: 'no-any',
    pattern: /:\s*any\b|<any>|as\s+any\b/,
    detail: 'use of any defeats the type system',
  },
  {
    name: 'no-ts-ignore',
    pattern: /@ts-ignore|@ts-nocheck/,
    detail: 'suppressing the type checker',
  },
  {
    name: 'no-console-in-src',
    pattern: /console\.log\(/,
    detail: 'console.log left in application code',
    appliesTo: (p) => !isScript(p) && !isTest(p),
  },
  {
    name: 'no-focused-test',
    pattern: /\.only\(/,
    detail: 'a focused test would silently skip the rest of the suite',
    appliesTo: isTest,
  },
]

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    const info = await stat(full)
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue
      await walk(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

export function scanFile(shown: string, content: string): Violation[] {
  const violations: Violation[] = []
  const lines = content.split('\n')

  if (lines.length > MAX_LINES) {
    violations.push({
      file: shown,
      line: MAX_LINES + 1,
      rule: 'max-file-length',
      detail: `${lines.length} lines exceeds ${MAX_LINES}`,
    })
  }

  if (SELF_EXEMPT.has(shown)) return violations

  lines.forEach((text, index) => {
    for (const rule of RULES) {
      if (rule.appliesTo && !rule.appliesTo(shown)) continue
      if (rule.pattern.test(text)) {
        violations.push({
          file: shown,
          line: index + 1,
          rule: rule.name,
          detail: rule.detail,
        })
      }
    }
  })

  return violations
}

async function main(): Promise<number> {
  const files: string[] = []
  for (const root of ROOTS) {
    await walk(root, files)
  }

  const violations: Violation[] = []
  for (const file of files) {
    violations.push(...scanFile(relative('.', file), await readFile(file, 'utf8')))
  }

  if (violations.length === 0) {
    console.log(`lint: clean (${files.length} files)`)
    return 0
  }

  console.error(`lint: ${violations.length} violation(s)`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.rule}  ${v.detail}`)
  }
  return 1
}

process.exit(await main())
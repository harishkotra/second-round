/**
 * The requirement-ID gate (C-002).
 *
 * Every pull request must name a requirement that exists in spec/requirements.yaml.
 * An LLM reviewer is signal; this is the gate. It is deterministic, it names the
 * offending id, and it cannot be talked out of a verdict.
 *
 * The two patterns use lookbehind rather than capture groups on purpose: a capture
 * group returns `string | undefined` under noUncheckedIndexedAccess, which forces a
 * defensive branch that no test can ever reach. Matching the id directly keeps the
 * module free of unreachable branches.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { referencedRequirementIds } from '../src/spec/reference.js'

export type ReqIdResult =
  | { ok: true; id: string }
  | { ok: false; reason: string }

const ID_LINE = /(?<=^\s*-\s*id:\s*)[RC]-\d{3}(?=\s*$)/gm

export function checkReqId(body: string, validIds: Set<string>): ReqIdResult {
  const trimmed = body.trim()

  if (trimmed === '') {
    return { ok: false, reason: 'pull request body is empty' }
  }

  const referenced = referencedRequirementIds(trimmed)

  if (referenced.length === 0) {
    return {
      ok: false,
      reason: 'no requirement id found (expected e.g. "Closes R-001" or "Closes C-007")',
    }
  }

  const valid = referenced.find((id) => validIds.has(id))

  if (valid) {
    return { ok: true, id: valid }
  }

  return {
    ok: false,
    reason: `requirement id not defined in spec/requirements.yaml: ${referenced.join(', ')}`,
  }
}

export async function loadValidIds(specDir = 'spec'): Promise<Set<string>> {
  const raw = await readFile(join(specDir, 'requirements.yaml'), 'utf8')
  return new Set(raw.match(ID_LINE) ?? [])
}

export function isDirectRun(entry: string): boolean {
  return entry.endsWith('check-req-id.ts') || entry.endsWith('check-req-id.js')
}

/**
 * Returns the process exit code rather than calling process.exit, so the CI
 * behaviour is testable in-process instead of only through a subprocess.
 */
export async function run(body: string, specDir = 'spec'): Promise<number> {
  // A push to main carries no PR body. Pass, and say so, rather than leaving a
  // required check in a "skipped" state that branch protection cannot interpret.
  if (body.trim() === '') {
    console.log('req-id: no PR body (not a pull request) -> pass')
    return 0
  }

  const validIds = await loadValidIds(specDir)
  const result = checkReqId(body, validIds)

  if (result.ok) {
    console.log(`req-id: ok -> ${result.id}`)
    return 0
  }

  console.error(`req-id: FAIL -> ${result.reason}`)
  console.error(`valid ids: ${[...validIds].sort().join(', ')}`)
  return 1
}

if (isDirectRun(process.argv[1] ?? '')) {
  process.exit(await run(process.env.PR_BODY ?? ''))
}
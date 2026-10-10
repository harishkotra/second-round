/**
 * A builder checking its own homework before it asks for review.
 *
 * Mason used to write blind and open the pull request immediately, so the first
 * feedback it ever received was a public CI failure. That is a bad way to learn:
 * the failure is noisy, it burns a review cycle, and the bot never sees it.
 *
 * So the builder now writes its files into the working tree, runs the same gates
 * CI runs, and only then opens the pull request. If the gates fail, the errors go
 * back to the model for one repair pass.
 *
 * The files are written to the checkout the workflow already made. They are never
 * committed through git: the pull request is built through the Contents API, so
 * this is a scratch copy that only exists to be checked.
 */

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { FileChange } from './patch.js'

const exec = promisify(execFile)

/** Keep the repair prompt bounded: errors are long, but not this long. */
export const MAX_OUTPUT_CHARS = 6000

/** The gates CI runs, in the order that fails fastest. */
export const CHECKS: readonly { name: string; args: readonly string[] }[] = [
  { name: 'typecheck', args: ['--silent', 'run', 'typecheck'] },
  { name: 'test', args: ['--silent', 'run', 'test'] },
]

export type CheckResult = {
  ok: boolean
  output: string
}

/** Writes the changes into the working tree, creating directories as needed. */
export async function writeChanges(files: FileChange[], root: string): Promise<string[]> {
  const written: string[] = []
  for (const file of files) {
    const full = join(root, file.path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, file.content, 'utf8')
    written.push(file.path)
  }
  return written
}

export async function runCheck(args: readonly string[], root: string): Promise<CheckResult> {
  try {
    const { stdout, stderr } = await exec('npm', [...args], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { ok: true, output: `${stdout}${stderr}`.trim() }
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string }
    const output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`.trim()
    return { ok: false, output: output === '' ? (failed.message ?? 'check failed') : output }
  }
}

/**
 * Writes the files, then runs every gate. Returns the combined failures, which
 * the caller hands straight back to the model.
 */
export async function verifyLocally(
  files: FileChange[],
  root: string = process.cwd(),
  checks: readonly { name: string; args: readonly string[] }[] = CHECKS,
): Promise<CheckResult> {
  await writeChanges(files, root)

  const parts: string[] = []
  for (const check of checks) {
    const result = await runCheck(check.args, root)
    if (!result.ok) parts.push(`### ${check.name} failed\n\n${result.output}`)
  }

  return { ok: parts.length === 0, output: parts.join('\n\n').slice(0, MAX_OUTPUT_CHARS) }
}
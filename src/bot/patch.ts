/**
 * Parsing what a model returns.
 *
 * Models wrap JSON in prose and code fences however they feel, so extraction is
 * forgiving while validation stays strict: a patch with a malformed file entry
 * is rejected outright rather than half-applied.
 */

export type FileChange = {
  path: string
  content: string
}

const FORBIDDEN_PATH = /(^\/|\.\.|^~)/

export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in the model response')
  }
  return candidate.slice(start, end + 1)
}

export function isSafePath(path: string): boolean {
  if (path.trim() === '') return false
  if (FORBIDDEN_PATH.test(path)) return false
  return path.startsWith('src/') || path.startsWith('tests/') || path.startsWith('api/') ||
    path.startsWith('docs/') || path.startsWith('spec/') || path.startsWith('.github/')
}

export function parsePatch(raw: string): FileChange[] {
  const parsed: unknown = JSON.parse(extractJson(raw))

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('patch must be a JSON object')
  }

  const files = (parsed as Record<string, unknown>)['files']
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('patch must contain a non-empty "files" list')
  }

  const entries: unknown[] = files
  return entries.map((entry, index) => {
    const where = `files[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${where}: must be a mapping`)
    }
    const record = entry as Record<string, unknown>
    const path = record['path']
    const content = record['content']
    if (typeof path !== 'string' || !isSafePath(path)) {
      throw new Error(`${where}.path is missing or outside the allowed directories: ${String(path)}`)
    }
    if (typeof content !== 'string') {
      throw new Error(`${where}.content must be a string`)
    }
    return { path, content }
  })
}
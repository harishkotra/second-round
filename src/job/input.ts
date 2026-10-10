/**
 * R-001: accept a pasted job description or a job description URL.
 *
 * People arrive with a job description in one of two shapes: text they copied
 * out of a posting, or a link to the posting. Both are accepted here and
 * normalised into one shape, so nothing downstream has to care which it was.
 *
 * A URL is fetched and reduced to readable text. Fetching is injected so the
 * whole path is testable without a network, the same way the model client is.
 */

export type JobSource =
  | { kind: 'text'; text: string }
  | { kind: 'url'; url: string }

export type JobDescription = {
  source: JobSource
  text: string
}

export type LoadJobDeps = {
  fetchImpl?: typeof fetch
}

const URL_LIKE = /^https?:\/\/\S+$/i

const HIDDEN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi
const TAG = /<[^>]*>/g
const ENTITY = /&(#x?[0-9a-f]+|[a-z]+);/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '\"',
  apos: "'",
  nbsp: ' ',
}

/** True when the whole input is a single http(s) URL, not text that mentions one. */
export function isJobUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!URL_LIKE.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseJobInput(raw: string): JobSource {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new Error('job description is empty: paste the text or give a URL')
  }
  return isJobUrl(trimmed) ? { kind: 'url', url: trimmed } : { kind: 'text', text: trimmed }
}

function decodeEntity(name: string): string {
  const lower = name.toLowerCase()
  const code = lower.startsWith('#x')
    ? Number.parseInt(lower.slice(2), 16)
    : lower.startsWith('#')
      ? Number.parseInt(lower.slice(1), 10)
      : Number.NaN

  if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
    return String.fromCodePoint(code)
  }
  return NAMED_ENTITIES[lower] ?? `&${name};`
}

/** The readable text of an HTML document: no tags, no scripts, no runs of space. */
export function htmlToText(html: string): string {
  return html
    .replace(HIDDEN, ' ')
    .replace(TAG, ' ')
    .replace(ENTITY, (_match, name: string) => decodeEntity(name))
    .replace(/\s+/g, ' ')
    .trim()
}

export async function loadJobDescription(
  raw: string,
  deps: LoadJobDeps = {},
): Promise<JobDescription> {
  const source = parseJobInput(raw)
  if (source.kind === 'text') return { source, text: source.text }

  const doFetch = deps.fetchImpl ?? fetch
  const response = await doFetch(source.url, {
    headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.8' },
  })

  if (!response.ok) {
    throw new Error(
      `could not fetch the job description: HTTP ${response.status} from ${source.url}`,
    )
  }

  const text = htmlToText(await response.text())
  if (text === '') {
    throw new Error(`the page at ${source.url} contained no readable text`)
  }

  return { source, text }
}

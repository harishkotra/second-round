/**
 * Accepting a job description (R-001).
 *
 * The product starts with the job: either a description the candidate pasted in,
 * or a URL to one. This module is the single place that decides which of the two
 * it was handed and normalises it, so every later step can depend on one shape
 * instead of re-guessing.
 *
 * A URL is recognised by its scheme. A bare host such as `example.com/jobs/1` is
 * treated as pasted text, because guessing at hostnames turns ordinary prose into
 * false positives.
 */

export type JobDescription =
  | { kind: 'pasted'; text: string }
  | { kind: 'url'; url: string }

const URL_LIKE = /^https?:\/\/\S+$/i

export function isJobUrl(value: string): boolean {
  return URL_LIKE.test(value.trim())
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString()
  } catch {
    throw new Error(`not a usable job description URL: ${value}`)
  }
}

export function acceptJobDescription(raw: string): JobDescription {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new Error('a job description or a job description URL is required')
  }

  if (!isJobUrl(trimmed)) {
    return { kind: 'pasted', text: trimmed }
  }

  return { kind: 'url', url: normalizeUrl(trimmed) }
}

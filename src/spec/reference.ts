/**
 * Finding a requirement reference in free text.
 *
 * Deliberately dependency-free so both the CI gate script and the reviewer bot
 * can share one definition instead of drifting apart.
 *
 * Lookbehind is used rather than a capture group on purpose: a capture group
 * returns `string | undefined` under noUncheckedIndexedAccess, which forces a
 * defensive branch no test can reach.
 */

const REFERENCE = /(?<=\b(?:Closes|Fixes|Resolves)\s+)[RC]-\d{3}\b/g

export function referencedRequirementIds(text: string): string[] {
  return text.match(REFERENCE) ?? []
}

export function requirementIdIn(text: string, validIds: Set<string>): string | null {
  for (const id of referencedRequirementIds(text)) {
    if (validIds.has(id)) return id
  }
  return null
}
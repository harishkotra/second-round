/**
 * Loads and validates the spec. The spec is the contract every pull request is
 * measured against, so a malformed spec must fail loudly rather than silently
 * yielding an empty requirement list.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

export type Requirement = {
  id: string
  phase: number
  text: string
}

export type NonGoal = {
  id: string
  text: string
  matchTerms: string[]
}

const REQUIREMENT_ID = /^[RC]-\d{3}$/

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected a mapping`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}: expected a non-empty string`)
  }
  return value
}

function asNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where}: expected a number`)
  }
  return value
}

function asStringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected a list`)
  const list: unknown[] = value
  return list.map((item, index) => asString(item, `${where}[${index}]`))
}

export function parseRequirements(raw: string): Requirement[] {
  const doc = asRecord(parse(raw), 'requirements.yaml')
  const list = doc['requirements']
  if (!Array.isArray(list)) {
    throw new Error('requirements.yaml: "requirements" must be a list')
  }
  const entries: unknown[] = list
  return entries.map((entry, index) => {
    const where = `requirements.yaml[${index}]`
    const item = asRecord(entry, where)
    const id = asString(item['id'], `${where}.id`)
    if (!REQUIREMENT_ID.test(id)) {
      throw new Error(`${where}.id: "${id}" must look like R-000 or C-000`)
    }
    return {
      id,
      phase: asNumber(item['phase'], `${where}.phase`),
      text: asString(item['text'], `${where}.text`),
    }
  })
}

export function parseNonGoals(raw: string): NonGoal[] {
  const doc = asRecord(parse(raw), 'non-goals.yaml')
  const list = doc['non_goals']
  if (!Array.isArray(list)) {
    throw new Error('non-goals.yaml: "non_goals" must be a list')
  }
  const entries: unknown[] = list
  return entries.map((entry, index) => {
    const where = `non-goals.yaml[${index}]`
    const item = asRecord(entry, where)
    return {
      id: asString(item['id'], `${where}.id`),
      text: asString(item['text'], `${where}.text`),
      matchTerms: asStringList(item['match_terms'], `${where}.match_terms`),
    }
  })
}

export async function loadRequirements(specDir = 'spec'): Promise<Requirement[]> {
  return parseRequirements(await readFile(join(specDir, 'requirements.yaml'), 'utf8'))
}

export async function loadNonGoals(specDir = 'spec'): Promise<NonGoal[]> {
  return parseNonGoals(await readFile(join(specDir, 'non-goals.yaml'), 'utf8'))
}

/**
 * The mechanism behind C-003. A pull request or a plan whose text matches a
 * non-goal is blocked rather than argued about.
 */
export function matchesNonGoal(text: string, nonGoals: NonGoal[]): NonGoal | null {
  const haystack = text.toLowerCase()
  for (const goal of nonGoals) {
    for (const term of goal.matchTerms) {
      if (haystack.includes(term.toLowerCase())) return goal
    }
  }
  return null
}
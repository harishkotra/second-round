import { describe, expect, test } from 'vitest'
import {
  loadNonGoals,
  loadRequirements,
  matchesNonGoal,
  parseNonGoals,
  parseRequirements,
} from '../../src/spec/load.js'

describe('parseRequirements', () => {
  test('parses a well-formed list', () => {
    const raw = 'requirements:\n  - id: R-001\n    phase: 0\n    text: do a thing\n'
    expect(parseRequirements(raw)).toEqual([{ id: 'R-001', phase: 0, text: 'do a thing' }])
  })

  test('rejects a missing requirements key', () => {
    expect(() => parseRequirements('other: []')).toThrow(/requirements/)
  })

  test('rejects a malformed id and names it', () => {
    const raw = 'requirements:\n  - id: X-1\n    phase: 0\n    text: t\n'
    expect(() => parseRequirements(raw)).toThrow(/X-1/)
  })

  test('rejects a missing text', () => {
    const raw = 'requirements:\n  - id: R-001\n    phase: 0\n'
    expect(() => parseRequirements(raw)).toThrow(/text/)
  })

  test('rejects a non-numeric phase', () => {
    const raw = 'requirements:\n  - id: R-001\n    phase: soon\n    text: t\n'
    expect(() => parseRequirements(raw)).toThrow(/phase/)
  })
})

describe('parseNonGoals', () => {
  test('parses match terms', () => {
    const raw = 'non_goals:\n  - id: NG-01\n    text: not that\n    match_terms:\n      - thing\n'
    expect(parseNonGoals(raw)[0]?.matchTerms).toEqual(['thing'])
  })

  test('rejects a missing match_terms list', () => {
    const raw = 'non_goals:\n  - id: NG-01\n    text: not that\n'
    expect(() => parseNonGoals(raw)).toThrow(/match_terms/)
  })
})

describe('matchesNonGoal', () => {
  const goals = [{ id: 'NG-01', text: 'Not a resume builder.', matchTerms: ['resume builder'] }]

  test('matches case-insensitively', () => {
    expect(matchesNonGoal('Adds a Resume Builder screen', goals)?.id).toBe('NG-01')
  })

  test('returns null when nothing matches', () => {
    expect(matchesNonGoal('Adds a rubric scorer', goals)).toBeNull()
  })
})

describe('the real spec files', () => {
  test('requirements load and cover both fleets', async () => {
    const requirements = await loadRequirements()
    expect(requirements.length).toBeGreaterThanOrEqual(30)
    expect(requirements.some((r) => r.id.startsWith('R-'))).toBe(true)
    expect(requirements.some((r) => r.id.startsWith('C-'))).toBe(true)
  })

  test('every requirement id is unique', async () => {
    const ids = (await loadRequirements()).map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('non-goals load and every one has match terms', async () => {
    const goals = await loadNonGoals()
    expect(goals.length).toBeGreaterThanOrEqual(6)
    for (const goal of goals) expect(goal.matchTerms.length).toBeGreaterThan(0)
  })
})
import { describe, expect, test } from 'vitest'
import { referencedRequirementIds, requirementIdIn } from '../../src/spec/reference.js'

describe('referencedRequirementIds', () => {
  test('finds Closes, Fixes and Resolves references', () => {
    expect(referencedRequirementIds('Closes R-001\nFixes C-007\nResolves R-002')).toEqual([
      'R-001',
      'C-007',
      'R-002',
    ])
  })

  test('ignores a bare id with no keyword in front of it', () => {
    expect(referencedRequirementIds('relates to R-001')).toEqual([])
  })

  test('ignores an id embedded in a longer token', () => {
    expect(referencedRequirementIds('Closes XR-0010')).toEqual([])
  })

  test('empty text yields nothing', () => {
    expect(referencedRequirementIds('')).toEqual([])
  })
})

describe('requirementIdIn', () => {
  const ids = new Set(['R-001', 'C-007'])

  test('returns the first reference that actually exists in the spec', () => {
    expect(requirementIdIn('Closes R-999\nCloses R-001', ids)).toBe('R-001')
  })

  test('null when every reference is unknown', () => {
    expect(requirementIdIn('Closes R-999', ids)).toBeNull()
  })

  test('null when there is no reference at all', () => {
    expect(requirementIdIn('nothing to see', ids)).toBeNull()
  })
})
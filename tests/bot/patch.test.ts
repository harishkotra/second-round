import { describe, expect, test } from 'vitest'
import { extractJson, isSafePath, parsePatch } from '../../src/bot/patch.js'

describe('extractJson', () => {
  test('pulls JSON out of a fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test('pulls JSON out of surrounding prose', () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toBe('{"a":1}')
  })

  test('throws when there is no object at all', () => {
    expect(() => extractJson('no json here')).toThrow(/no JSON object/)
  })
})

describe('isSafePath', () => {
  test('accepts the allowed roots', () => {
    expect(isSafePath('src/a.ts')).toBe(true)
    expect(isSafePath('tests/a.test.ts')).toBe(true)
    expect(isSafePath('api/extract.ts')).toBe(true)
  })

  test('rejects absolute paths and parent traversal', () => {
    expect(isSafePath('/etc/passwd')).toBe(false)
    expect(isSafePath('../../etc/passwd')).toBe(false)
    expect(isSafePath('src/../../escape.ts')).toBe(false)
    expect(isSafePath('~/secrets')).toBe(false)
  })

  test('rejects anything outside the allowed roots', () => {
    expect(isSafePath('node_modules/x.js')).toBe(false)
    expect(isSafePath('package.json')).toBe(false)
    expect(isSafePath('')).toBe(false)
  })
})

describe('parsePatch', () => {
  test('parses a valid patch', () => {
    expect(parsePatch('{"files":[{"path":"src/a.ts","content":"export const a = 1"}]}')).toEqual([
      { path: 'src/a.ts', content: 'export const a = 1' },
    ])
  })

  test('rejects an empty file list', () => {
    expect(() => parsePatch('{"files":[]}')).toThrow(/non-empty/)
  })

  test('rejects a missing files key', () => {
    expect(() => parsePatch('{"notes":"done"}')).toThrow(/non-empty/)
  })

  test('rejects a path outside the allowed roots', () => {
    expect(() => parsePatch('{"files":[{"path":"package.json","content":"{}"}]}')).toThrow(
      /outside the allowed/,
    )
  })

  test('rejects non-string content', () => {
    expect(() => parsePatch('{"files":[{"path":"src/a.ts","content":1}]}')).toThrow(
      /content must be a string/,
    )
  })

  test('rejects a non-object entry', () => {
    expect(() => parsePatch('{"files":["nope"]}')).toThrow(/must be a mapping/)
  })

  test('rejects a top-level array, because a patch must be an object', () => {
    expect(() => parsePatch('[1,2,3]')).toThrow(/no JSON object/)
  })
})
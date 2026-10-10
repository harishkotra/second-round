import { describe, expect, it } from 'vitest'
import { acceptJobDescription, isJobUrl } from '../../src/job/input.js'

describe('isJobUrl', () => {
  it('recognises http and https URLs', () => {
    expect(isJobUrl('https://example.com/jobs/1')).toBe(true)
    expect(isJobUrl('http://example.com/jobs/1')).toBe(true)
  })

  it('ignores surrounding whitespace', () => {
    expect(isJobUrl('  https://example.com/jobs/1\n')).toBe(true)
  })

  it('does not treat prose as a URL', () => {
    expect(isJobUrl('We are hiring a backend engineer.')).toBe(false)
  })

  it('does not treat a bare host as a URL', () => {
    expect(isJobUrl('example.com/jobs/1')).toBe(false)
  })
})

describe('acceptJobDescription', () => {
  it('accepts a pasted description', () => {
    const text = 'Senior Engineer\n\nWe build things.'
    expect(acceptJobDescription(text)).toEqual({ kind: 'pasted', text })
  })

  it('trims a pasted description', () => {
    expect(acceptJobDescription('  hello  ')).toEqual({ kind: 'pasted', text: 'hello' })
  })

  it('accepts a job description URL', () => {
    expect(acceptJobDescription('https://example.com/jobs/1')).toEqual({
      kind: 'url',
      url: 'https://example.com/jobs/1',
    })
  })

  it('keeps the path and query of a URL', () => {
    expect(acceptJobDescription('https://example.com/jobs/1?ref=abc')).toEqual({
      kind: 'url',
      url: 'https://example.com/jobs/1?ref=abc',
    })
  })

  it('normalises a URL', () => {
    expect(acceptJobDescription('HTTPS://Example.com')).toEqual({
      kind: 'url',
      url: 'https://example.com/',
    })
  })

  it('treats a description that mentions a URL as pasted text', () => {
    const text = 'Apply at https://example.com/jobs/1 if interested.'
    expect(acceptJobDescription(text)).toEqual({ kind: 'pasted', text })
  })

  it('rejects empty input', () => {
    expect(() => acceptJobDescription('   ')).toThrow(/required/)
  })
})

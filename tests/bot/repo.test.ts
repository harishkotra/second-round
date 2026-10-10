import { describe, expect, test } from 'vitest'
import { branchName, diffText, slugify, type PullRequestView } from '../../src/bot/repo.js'

describe('slugify', () => {
  test('lowercases and hyphenates', () => {
    expect(slugify('Accept a pasted job description')).toBe('accept-a-pasted-job-description')
  })

  test('strips punctuation and trims edge hyphens', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world')
  })

  test('truncates without leaving a trailing hyphen', () => {
    expect(slugify('aaaa bbbb cccc', 9)).toBe('aaaa-bbbb')
  })

  test('an all-punctuation string becomes empty rather than a stray hyphen', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('branchName', () => {
  test('namespaces by requirement so two builders cannot collide', () => {
    expect(branchName('R-004', 'Conduct a multi-turn interview')).toBe(
      'bot/R-004/conduct-a-multi-turn-interview',
    )
  })
})

describe('diffText', () => {
  const view: PullRequestView = {
    number: 1,
    title: 'a title',
    body: 'a body',
    headSha: 'sha',
    baseBranch: 'main',
    files: [
      { path: 'src/a.ts', patch: '+added line' },
      { path: 'assets/logo.png', patch: null },
    ],
  }

  test('includes each file and its patch', () => {
    const text = diffText(view)
    expect(text).toContain('--- src/a.ts')
    expect(text).toContain('+added line')
  })

  test('says so plainly when a patch cannot be shown', () => {
    expect(diffText(view)).toContain('too large to display')
  })

  test('respects the character limit', () => {
    expect(diffText(view, 10).length).toBeLessThanOrEqual(10)
  })
})
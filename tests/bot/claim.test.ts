import { describe, expect, test } from 'vitest'
import {
  claimIssue,
  claimLabel,
  claimedBy,
  isClaimed,
  listLabels,
  normalizeLabels,
  releaseClaim,
} from '../../src/bot/claim.js'
import { asOctokit, fakeOctokit } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_ISSUE = 'GET /repos/{owner}/{repo}/issues/{issue_number}'
const ADD_LABELS = 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels'
const REMOVE_LABEL = 'DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}'

describe('label helpers', () => {
  test('claimLabel namespaces the lease by bot', () => {
    expect(claimLabel('sr-mason')).toBe('claimed:sr-mason')
  })

  test('claimedBy extracts the holder', () => {
    expect(claimedBy(['bug', 'claimed:sr-mason'])).toBe('sr-mason')
  })

  test('claimedBy is null when nothing holds the lease', () => {
    expect(claimedBy(['bug', 'ready'])).toBeNull()
  })

  test('isClaimed is false for a plain issue', () => {
    expect(isClaimed(['bug', 'ready'])).toBe(false)
  })

  test('normalizeLabels handles the string form, the object form, and blanks', () => {
    expect(normalizeLabels(['a', { name: 'b' }, {}, ''])).toEqual(['a', 'b'])
  })
})

describe('claimIssue', () => {
  test('claims an unclaimed issue and applies its own label', async () => {
    const fake = fakeOctokit({
      [GET_ISSUE]: () => ({ labels: ['ready'] }),
      [ADD_LABELS]: () => ({}),
    })
    expect(await claimIssue(asOctokit(fake), ctx, 7, 'sr-mason')).toBe(true)
    const add = fake.calls.find((call) => call.route === ADD_LABELS)
    expect(add?.params['labels']).toEqual(['claimed:sr-mason'])
  })

  test('refuses an issue another bot already holds, without writing', async () => {
    const fake = fakeOctokit({
      [GET_ISSUE]: () => ({ labels: ['claimed:sr-mason'] }),
    })
    expect(await claimIssue(asOctokit(fake), ctx, 7, 'sr-turnstile')).toBe(false)
    expect(fake.calls).toHaveLength(1)
  })

  test('listLabels tolerates both label shapes', async () => {
    const fake = fakeOctokit({
      [GET_ISSUE]: () => ({ labels: ['a', { name: 'b' }] }),
    })
    expect(await listLabels(asOctokit(fake), ctx, 1)).toEqual(['a', 'b'])
  })

  test('releaseClaim targets the calling bot own label', async () => {
    const fake = fakeOctokit({
      [REMOVE_LABEL]: () => ({}),
    })
    await releaseClaim(asOctokit(fake), ctx, 3, 'sr-mason')
    expect(fake.calls[0]?.params['name']).toBe('claimed:sr-mason')
  })
})
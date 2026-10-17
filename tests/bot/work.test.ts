import { describe, expect, test } from 'vitest'
import {
  availableQueue,
  deliveredRequirements,
  isProductWork,
  listQueue,
  nextClaimable,
  orderQueue,
  peekNext,
  phaseOf,
  requirementIdOf,
  type QueueItem,
} from '../../src/bot/work.js'
import { makeEvent } from '../../src/ledger/schema.js'
import { asOctokit, fakeOctokit } from '../helpers/fake-octokit.js'

const ctx = { owner: 'o', repo: 'r' }
const GET_ISSUES = 'GET /repos/{owner}/{repo}/issues'
const GET_ISSUE = 'GET /repos/{owner}/{repo}/issues/{issue_number}'
const ADD_LABELS = 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels'

function item(number: number, title: string, labels: string[]): QueueItem {
  return { number, title, labels, phase: phaseOf(labels) }
}

describe('phaseOf', () => {
  test('reads the phase label', () => {
    expect(phaseOf(['ready', 'phase-2'])).toBe(2)
  })

  test('work the labels cannot place sorts last', () => {
    expect(phaseOf(['ready'])).toBeGreaterThan(1000)
  })
})

describe('orderQueue', () => {
  test('earliest phase first, then the oldest issue', () => {
    const ordered = orderQueue([
      item(30, '[R-012] late phase', ['ready', 'phase-1']),
      item(9, '[R-003] same phase, later', ['ready', 'phase-0']),
      item(5, '[R-002] same phase, earlier', ['ready', 'phase-0']),
    ])
    expect(ordered.map((entry) => entry.number)).toEqual([5, 9, 30])
  })
})

describe('availableQueue', () => {
  const queue = [
    item(1, '[R-001] free', ['ready', 'phase-0']),
    item(2, '[R-002] mine', ['ready', 'phase-0', 'claimed:sr-mason']),
    item(3, '[R-003] someone else', ['ready', 'phase-0', 'claimed:sr-sentry']),
    item(4, '[R-004] not ready', ['phase-0']),
    item(5, '[C-001] crew work', ['ready', 'phase-0']),
  ]

  test('takes ready product work that is free or already mine', () => {
    expect(availableQueue(queue, 'sr-mason').map((entry) => entry.number)).toEqual([1, 2])
  })

  test('another bot holding the lease keeps it out of reach', () => {
    expect(availableQueue(queue, 'sr-sentry').map((entry) => entry.number)).toEqual([1, 3])
  })

  test('crew work is never product work', () => {
    expect(isProductWork(item(5, '[C-001] crew work', []))).toBe(false)
    expect(isProductWork(item(1, '[R-001] free', []))).toBe(true)
  })
})

describe('listQueue', () => {
  test('skips pull requests, which the issues endpoint also returns', async () => {
    const fake = fakeOctokit({
      [GET_ISSUES]: () => [
        { number: 1, title: '[R-001] free', labels: [{ name: 'ready' }] },
        { number: 2, title: 'a pull request', labels: [], pull_request: { url: 'x' } },
      ],
    })
    const queue = await listQueue(asOctokit(fake), ctx)
    expect(queue.map((entry) => entry.number)).toEqual([1])
    expect(queue[0]?.labels).toEqual(['ready'])
  })
})

describe('nextClaimable', () => {
  test('claims the next ready issue and returns it', async () => {
    const fake = fakeOctokit({
      [GET_ISSUES]: () => [{ number: 7, title: '[R-003] c', labels: ['ready', 'phase-0'] }],
      [GET_ISSUE]: () => ({ labels: ['ready', 'phase-0'] }),
      [ADD_LABELS]: () => ({}),
    })
    expect(await nextClaimable(asOctokit(fake), ctx, 'sr-mason')).toBe(7)
    const added = fake.calls.find((call) => call.route === ADD_LABELS)
    expect(added?.params['labels']).toEqual(['claimed:sr-mason'])
  })

  test('a lease it already holds is a retry, not a second claim', async () => {
    const fake = fakeOctokit({
      [GET_ISSUES]: () => [
        { number: 7, title: '[R-003] c', labels: ['ready', 'phase-0', 'claimed:sr-mason'] },
      ],
    })
    expect(await nextClaimable(asOctokit(fake), ctx, 'sr-mason')).toBe(7)
    expect(fake.calls.some((call) => call.route === ADD_LABELS)).toBe(false)
  })

  test('null when nothing is ready', async () => {
    const fake = fakeOctokit({ [GET_ISSUES]: () => [] })
    expect(await nextClaimable(asOctokit(fake), ctx, 'sr-mason')).toBeNull()
  })

  test('skips work another builder already holds', async () => {
    const fake = fakeOctokit({
      [GET_ISSUES]: () => [
        { number: 7, title: '[R-003] c', labels: ['ready', 'phase-0', 'claimed:sr-sentry'] },
      ],
    })
    expect(await nextClaimable(asOctokit(fake), ctx, 'sr-mason')).toBeNull()
  })
})

describe('peekNext', () => {
  test('takes nothing, so a dry run cannot hold work', async () => {
    const fake = fakeOctokit({
      [GET_ISSUES]: () => [{ number: 7, title: '[R-003] c', labels: ['ready', 'phase-0'] }],
    })
    expect((await peekNext(asOctokit(fake), ctx, 'sr-mason'))?.number).toBe(7)
    expect(fake.calls.some((call) => call.route === ADD_LABELS)).toBe(false)
  })
})

describe('requirementIdOf', () => {
  test('reads the id an issue title names', () => {
    expect(requirementIdOf('[R-001] something')).toBe('R-001')
    expect(requirementIdOf('[C-012] crew work')).toBe('C-012')
  })

  test('null when the title names none', () => {
    expect(requirementIdOf('a random idea')).toBeNull()
  })
})

describe('deliveredRequirements', () => {
  test('collects the requirements that reached main, and nothing else', () => {
    const events = [
      makeEvent({ bot: 'sr-turnstile', action: 'pr.merged', req: 'R-001', artifact: '32' }),
      makeEvent({ bot: 'sr-turnstile', action: 'pr.merged', artifact: '33' }),
      makeEvent({ bot: 'sr-sentry', action: 'pr.reviewed', req: 'R-002' }),
    ]
    expect([...deliveredRequirements(events)]).toEqual(['R-001'])
  })

  test('empty when nothing has shipped', () => {
    expect(deliveredRequirements([]).size).toBe(0)
  })
})

describe('availableQueue and what already shipped', () => {
  test('a delivered requirement is never offered again', () => {
    const queue = [item(1, '[R-001] already shipped', ['ready', 'phase-0'])]
    expect(availableQueue(queue, 'sr-mason', new Set(['R-001']))).toEqual([])
    expect(availableQueue(queue, 'sr-mason').map((entry) => entry.number)).toEqual([1])
  })
})
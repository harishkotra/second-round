import type { Octokit } from 'octokit'

export type RouteHandler = (params: Record<string, unknown>) => unknown

export type FakeCall = {
  route: string
  params: Record<string, unknown>
}

export type FakeOctokit = {
  calls: FakeCall[]
  request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>
}

export function fakeOctokit(routes: Record<string, RouteHandler>): FakeOctokit {
  const calls: FakeCall[] = []
  return {
    calls,
    async request(route: string, params: Record<string, unknown> = {}) {
      calls.push({ route, params })
      const handler = routes[route]
      if (handler === undefined) {
        throw new Error(`fakeOctokit: no route registered for "${route}"`)
      }
      return { data: handler(params) }
    },
  }
}

export function asOctokit(fake: FakeOctokit): Octokit {
  return fake as unknown as Octokit
}

export function httpError(status: number): Error {
  const error = new Error(`HTTP ${status}`)
  Object.assign(error, { status })
  return error
}

export function encoded(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64')
}

export function decoded(content: unknown): string {
  return Buffer.from(String(content), 'base64').toString('utf8')
}
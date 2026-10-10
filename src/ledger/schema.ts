/**
 * The ledger event shape (C-006).
 *
 * Every agent action is one line of JSON. The health board and the oversight
 * digest are computed from this and nothing else, so nothing in the record is
 * self-reported.
 */

export const VERDICTS = ['approved', 'rejected', 'blocked'] as const
export type Verdict = (typeof VERDICTS)[number]

export const ACTIONS = [
  'issue.opened',
  'issue.claimed',
  'issue.responded',
  'pr.opened',
  'pr.updated',
  'pr.reviewed',
  'pr.merged',
  'pr.human_approved',
  'budget.exceeded',
  'drift.reported',
  'slop.reported',
] as const
export type Action = (typeof ACTIONS)[number]

export type LedgerEvent = {
  ts: string
  bot: string
  action: Action
  req: string | null
  artifact: string | null
  costUsd: number
  verdict: Verdict | null
  reason: string | null
}

const REQUIREMENT_ID = /^[RC]-\d{3}$/

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value)
}

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value)
}

export function validateEvent(value: unknown): LedgerEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('ledger event must be a mapping')
  }
  const record = value as Record<string, unknown>

  const ts = record['ts']
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) {
    throw new Error('ledger event: "ts" must be an ISO timestamp')
  }

  const bot = record['bot']
  if (typeof bot !== 'string' || bot.trim() === '') {
    throw new Error('ledger event: "bot" must be a non-empty string')
  }

  const action = record['action']
  if (!isAction(action)) {
    throw new Error(`ledger event: "action" must be one of ${ACTIONS.join(', ')}`)
  }

  const req = record['req']
  if (req !== null && typeof req !== 'string') {
    throw new Error('ledger event: "req" must be null or a requirement id')
  }
  if (typeof req === 'string' && !REQUIREMENT_ID.test(req)) {
    throw new Error(`ledger event: "req" is not a requirement id: ${req}`)
  }

  const artifact = record['artifact']
  if (artifact !== null && typeof artifact !== 'string') {
    throw new Error('ledger event: "artifact" must be null or a string')
  }

  const costUsd = record['costUsd']
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error('ledger event: "costUsd" must be a non-negative number')
  }

  const verdict = record['verdict']
  if (verdict !== null && !isVerdict(verdict)) {
    throw new Error(`ledger event: "verdict" must be null or one of ${VERDICTS.join(', ')}`)
  }

  const reason = record['reason']
  if (reason !== null && typeof reason !== 'string') {
    throw new Error('ledger event: "reason" must be null or a string')
  }

  return { ts, bot, action, req, artifact, costUsd, verdict, reason }
}

export function parseLedgerLine(line: string): LedgerEvent {
  return validateEvent(JSON.parse(line))
}

export function serializeEvent(value: LedgerEvent): string {
  return JSON.stringify(validateEvent(value))
}

export type EventInit = {
  bot: string
  action: Action
  ts?: string
  req?: string | null
  artifact?: string | null
  costUsd?: number
  verdict?: Verdict | null
  reason?: string | null
}

export function makeEvent(init: EventInit): LedgerEvent {
  return validateEvent({
    ts: init.ts ?? new Date().toISOString(),
    bot: init.bot,
    action: init.action,
    req: init.req ?? null,
    artifact: init.artifact ?? null,
    costUsd: init.costUsd ?? 0,
    verdict: init.verdict ?? null,
    reason: init.reason ?? null,
  })
}
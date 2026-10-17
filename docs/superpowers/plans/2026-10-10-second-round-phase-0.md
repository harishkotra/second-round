# Second Round Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the thinnest working slice of both fleets: a deployed product that runs one interviewer against a pasted JD and scores the answers, plus a four-bot crew with a deterministic merge gate and a live ledger.

**Architecture:** Two independent systems in one repo. The product is a Vite + React client with a serverless LLM proxy. The crew is a set of GitHub App bots, each a GitHub Actions workflow that mints its own installation token, claims work through issue labels, and appends to a committed append-only ledger. The spec in `spec/requirements.yaml` is the contract between them.

**Tech Stack:** Node 23, TypeScript (strict), Octokit + `@octokit/auth-app`, `actions/create-github-app-token`, Vite + React + TypeScript + Tailwind, Vercel serverless functions, Vitest, Particle.ai OpenAI-compatible endpoint.

**Spec:** `docs/superpowers/specs/2026-10-10-second-round-design.md`

## Global Constraints

- Node `>=22`. TypeScript `strict: true`. No `any`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`.
- Every PR body must contain `Closes R-0NN` or `Closes C-0NN` naming an ID that exists in `spec/`.
- LLM base URL and key come from env (`PARTICLE_BASE_URL`, `PARTICLE_API_KEY`). Never hardcoded, never in the client bundle.
- Coverage floor 70 percent. No `TODO` comments committed. No placeholder or mock data in shipped paths.
- Ledger path is `ledger/events.ndjson`. Every bot trigger uses `paths-ignore: ledger/**`.
- Bots are least privilege. Only `sr-turnstile` holds merge rights.

## Review Focus

- **A PR body with no requirement ID, or an ID that does not exist.** Expected: CI fails with the offending ID named, not a generic error.
- **Two bots claiming the same issue at the same moment.** Expected: exactly one wins the label; the loser exits cleanly without opening a PR.
- **A bot whose spend cap is already exhausted.** Expected: it exits without calling the model, and records a `budget.exceeded` ledger event.
- **A ledger commit triggering the bots.** Expected: no bot workflow runs, because every trigger ignores `ledger/**`.
- **A JD with no extractable competencies** (a one-line JD, or a non-English one). Expected: the Reader returns an explicit empty result with a reason, and the UI says so rather than inventing competencies.

---

### Task 1: Repo skeleton, spec files, and the requirement-ID gate

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.editorconfig`
- Create: `spec/requirements.yaml`, `spec/non-goals.yaml`
- Create: `scripts/check-req-id.ts`
- Create: `.github/workflows/ci.yml`
- Test: `tests/scripts/check-req-id.test.ts`

**Interfaces:**
- Produces: `checkReqId(body: string, validIds: Set<string>): { ok: true; id: string } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { checkReqId } from '../../scripts/check-req-id'
const ids = new Set(['R-001', 'C-007'])

test('accepts a valid product requirement id', () => {
  expect(checkReqId('Closes R-001', ids)).toEqual({ ok: true, id: 'R-001' })
})
test('rejects a missing id', () => {
  expect(checkReqId('fixes stuff', ids).ok).toBe(false)
})
test('rejects an unknown id and names it', () => {
  const r = checkReqId('Closes R-999', ids)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.reason).toContain('R-999')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/check-req-id.test.ts`
Expected: FAIL, cannot resolve `../../scripts/check-req-id`

- [ ] **Step 3: Implement `checkReqId` and the spec files**

`spec/requirements.yaml` holds every `R-0NN` and `C-0NN` from section 7 of the spec, each as `{ id, text, phase }`. `spec/non-goals.yaml` holds the section 2 list as `{ id, text, match_terms }`.

`checkReqId` scans the PR body for `Closes (R|C)-\d{3}`, returns ok only when the ID is in the set.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/check-req-id.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Wire `ci.yml`**

Jobs: `install`, `lint`, `typecheck`, `test`, `build`, `req-id`. The `req-id` job runs only on `pull_request` and fails when `checkReqId` returns not-ok.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: repo skeleton, spec files, and the requirement-ID gate"
```

---

### Task 2: The ledger

**Files:**
- Create: `src/ledger/schema.ts`, `src/ledger/append.ts`
- Create: `bin/ledger.ts`
- Test: `tests/ledger/append.test.ts`

**Interfaces:**
- Produces: `type LedgerEvent = { ts: string; bot: string; action: string; req: string | null; artifact: string | null; cost_usd: number; verdict: 'approved' | 'rejected' | 'blocked' | null; reason?: string }`
- Produces: `appendEvent(path: string, e: LedgerEvent): Promise<void>`
- Produces: `readEvents(path: string): Promise<LedgerEvent[]>`

- [ ] **Step 1: Write the failing test**

```ts
test('appends one line per event and reads them back', async () => {
  const p = tmpFile()
  await appendEvent(p, ev({ bot: 'sr-mason', action: 'pr.opened' }))
  await appendEvent(p, ev({ bot: 'sr-sentry', action: 'pr.reviewed', verdict: 'rejected', reason: 'R-005' }))
  const out = await readEvents(p)
  expect(out).toHaveLength(2)
  expect(out[1].verdict).toBe('rejected')
})
test('rejects a malformed event before writing', async () => {
  await expect(appendEvent(tmpFile(), { ts: 'x' } as any)).rejects.toThrow()
})
```

- [ ] **Step 2: Run to verify failure**, `npx vitest run tests/ledger/append.test.ts`, expect FAIL

- [ ] **Step 3: Implement**

Validate against the schema with a hand-written guard (no runtime dependency). `appendEvent` opens in append mode, writes `JSON.stringify(e) + '\n'`. `readEvents` splits on newline, filters empties, parses.

- [ ] **Step 4: Verify pass**, `npx vitest run tests/ledger/append.test.ts`, expect PASS

- [ ] **Step 5: Add `bin/ledger.ts`** with `append` and `stats` subcommands, so the dashboard and the digest share one reader.

- [ ] **Step 6: Commit** `feat: append-only ledger with schema guard`

---

### Task 3: Bot core

**Files:**
- Create: `src/bot/auth.ts`, `src/bot/claim.ts`, `src/bot/budget.ts`, `src/bot/run.ts`
- Test: `tests/bot/claim.test.ts`, `tests/bot/budget.test.ts`

**Interfaces:**
- Produces: `getOctokit(appSlug: string): Promise<Octokit>` reading `APP_<SLUG>_ID` and `APP_<SLUG>_PRIVATE_KEY`
- Produces: `claimIssue(octokit, owner, repo, issue: number, bot: string): Promise<boolean>` — applies `claimed:<bot>`, returns false when the label already exists
- Produces: `releaseClaim(...)`, `hasBudget(ledger, bot, capUsd): Promise<boolean>`
- Consumes: `readEvents`, `appendEvent` from Task 2

- [ ] **Step 1: Write the failing tests**

```ts
test('second claim on a labelled issue returns false', async () => {
  mockLabels(['claimed:sr-mason'])
  expect(await claimIssue(octo, 'o', 'r', 7, 'sr-vault')).toBe(false)
})
test('a bot over its daily cap has no budget', async () => {
  const events = [ev({ bot: 'sr-mason', cost_usd: 0.6 }), ev({ bot: 'sr-mason', cost_usd: 0.5 })]
  expect(await hasBudget(events, 'sr-mason', 1.0)).toBe(false)
})
```

- [ ] **Step 2: Verify failure**, `npx vitest run tests/bot`, expect FAIL

- [ ] **Step 3: Implement**

`auth.ts` builds one Octokit per app via `@octokit/auth-app`. `claim.ts` lists labels, returns false if any starts with `claimed:`, otherwise adds its own. `budget.ts` sums `cost_usd` for today's UTC date for that bot.

- [ ] **Step 4: Verify pass**, `npx vitest run tests/bot`, expect PASS

- [ ] **Step 5: Add `run.ts`** — the shared wrapper: load persona from `.github/agents/<bot>.md`, check budget, run the handler, append a ledger event, exit non-zero only on real errors (so a bot never leaves a red run for a normal no-op).

- [ ] **Step 6: Commit** `feat: bot core with app auth, label leases, and spend caps`

---

### Task 4: Foreman

**Files:**
- Create: `src/bots/foreman.ts`, `.github/agents/sr-foreman.md`, `.github/workflows/foreman.yml`
- Test: `tests/bots/foreman.test.ts`

**Interfaces:**
- Consumes: `getOctokit`, `appendEvent`, `run`
- Produces: `planMilestone(spec: Requirement[], openIssues: Issue[]): IssueDraft[]` where `IssueDraft = { title: string; body: string; req: string; labels: string[] }`

- [ ] **Step 1: Write the failing test** — `planMilestone` returns exactly one draft per unmet requirement, each body containing `Closes <id>`, and returns an empty array when every requirement already has an issue.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement `planMilestone`**, then the workflow: `schedule` daily 06:00 plus `workflow_dispatch`, `permissions: issues: write, contents: write`, `paths-ignore: ledger/**`, mint the token with `actions/create-github-app-token`, run `node dist/bots/foreman.js`.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit** `feat: foreman bot decomposes the spec into issues`

---

### Task 5: Mason

**Files:**
- Create: `src/bots/mason.ts`, `.github/agents/sr-mason.md`, `.github/workflows/mason.yml`
- Test: `tests/bots/mason.test.ts`

**Interfaces:**
- Produces: `buildPatch(issue: Issue, repoContext: string): Promise<{ files: FileChange[]; tests: FileChange[] }>`
- Produces: `openPullRequest(octokit, draft: PrDraft): Promise<number>`

- [ ] **Step 1: Write the failing test** — given an issue whose body has `Closes R-004`, the generated PR body contains the same ID and a `## Test Plan` section; the branch name is `bot/<req>/<slug>`.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement.** The model call is one function `callModel(persona, context, task)` hitting the Particle endpoint. The patch is written to a branch via the Git Data API, then a PR is opened. Never push to `main`.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Workflow** — `on: issues: [assigned]`, guard `if: github.event.assignee.login == 'sr-mason[bot]'`, claim before acting.
- [ ] **Step 6: Commit** `feat: mason bot implements one issue per run`

---

### Task 6: Sentry

**Files:**
- Create: `src/bots/sentry.ts`, `.github/agents/sr-sentry.md`, `.github/workflows/sentry.yml`
- Test: `tests/bots/sentry.test.ts`

**Interfaces:**
- Produces: `reviewPullRequest(diff: string, requirement: Requirement, persona: string): Promise<{ verdict: 'approved' | 'rejected'; findings: Finding[]; reason?: string }>` where `Finding = { file: string; line: number; note: string }`

- [ ] **Step 1: Write the failing test** — a diff that adds a feature with no test produces `verdict: 'rejected'` with a finding naming the file; a diff matching a non-goal term produces `verdict: 'rejected'` and `reason` naming the non-goal ID.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement.** Review is grounded in the requirement text plus the diff. Verdict is posted as a real GitHub review (`REQUEST_CHANGES` or `APPROVE`), not a comment, so the state is machine-readable.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit** `feat: sentry bot reviews PRs against their requirement`

---

### Task 7: Turnstile and branch protection

**Files:**
- Create: `src/bots/turnstile.ts`, `.github/agents/sr-turnstile.md`, `.github/workflows/turnstile.yml`
- Create: `scripts/setup-branch-protection.sh`
- Test: `tests/bots/turnstile.test.ts`

**Interfaces:**
- Produces: `canMerge(state: { checks: Check[]; reviews: Review[]; blocks: string[]; humanRequired: boolean }): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test** — `canMerge` returns false when any check is not green, false when a block from Compass or Curator exists, false when the PR touches `spec/` and no human approval is present, true only when everything passes.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement** and wire `turnstile.yml` on `check_suite: [completed]`, merging with `--squash`.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Branch protection** — `main` requires the CI checks, one approving review, no direct pushes, and disallows the last pusher approving.
- [ ] **Step 6: Commit** `feat: turnstile is the only merging identity`

---

### Task 8: Product shell, JD intake, and the Reader

**Files:**
- Create: `src/app/main.tsx`, `src/app/App.tsx`, `src/app/routes/Intake.tsx`
- Create: `api/extract.ts`
- Create: `src/agents/reader.ts`
- Test: `tests/agents/reader.test.ts`

**Interfaces:**
- Produces: `extractCompetencies(jd: string): Promise<{ competencies: Competency[]; loopShape: string; reason?: string }>` where `Competency = { name: string; quote: string; weight: number }`

- [ ] **Step 1: Write the failing test** — a real JD fixture yields at least 5 competencies, every one carrying a `quote` that is a substring of the JD; a one-line JD yields an empty list with a `reason`.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement.** The quote check is asserted in code, not trusted: drop any competency whose quote is not found in the source text. That is the anti-hallucination guard for this feature.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: UI** — `Intake.tsx` has a textarea, a paste-URL field, a submit button, and renders the competency list with its quotes. No resume field (R-013).
- [ ] **Step 6: Commit** `feat: JD intake with quoted competency extraction`

---

### Task 9: Interview loop and the Scorecard

**Files:**
- Create: `src/agents/scorecard.ts`, `src/agents/interviewer.ts`
- Create: `api/interview.ts`
- Test: `tests/agents/scorecard.test.ts`, `tests/agents/interviewer.test.ts`

**Interfaces:**
- Produces: `scoreAnswer(question: string, answer: string): Promise<{ axes: AxisScore[]; fumble: boolean; followUp: string | null }>` where `AxisScore = { axis: Axis; score: 0 | 1 | 2; quote: string }`
- Produces: `nextQuestion(plan: Question[], transcript: Turn[]): Question | null`

- [ ] **Step 1: Write the failing test** — an answer with no numbers scores Specificity 0 and yields the follow-up "What was the number?"; an answer that survives two whys is not a fumble; a `we`-only answer scores Ownership 0 with follow-up "What did you personally do?"
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement.** The follow-up comes from a lookup keyed on the failed axis, exactly as section 6 of the spec defines. No model call for the follow-up itself.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit** `feat: rubric scoring with axis-derived follow-ups`

---

### Task 10: Transcript view and Fumble Card

**Files:**
- Create: `src/app/routes/Debrief.tsx`, `src/app/components/FumbleCard.tsx`, `src/app/components/AxisMeter.tsx`
- Test: `tests/app/debrief.test.tsx`

**Interfaces:**
- Consumes: the session object from Tasks 8 and 9

- [ ] **Step 1: Write the failing test** — the debrief renders one row per answer with its axis scores and a fumble marker where `fumble` is true; the Fumble Card renders the failed axis, the answer, and the follow-up, with no name or email in the output.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement.** Redaction is a pure function `redact(text: string, pii: string[]): string`, tested separately.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit** `feat: debrief view and redacted Fumble Card`

---

### Task 11: The Ledger dashboard

**Files:**
- Create: `src/app/routes/Ledger.tsx`, `src/app/lib/health.ts`
- Test: `tests/app/health.test.ts`

**Interfaces:**
- Produces: `computeHealth(events: LedgerEvent[]): { perBot: BotStats[]; rejectionReasons: Record<string, number>; humanTouchRate: number; costPerMergedPr: number }`

- [ ] **Step 1: Write the failing test** — from a fixture of 6 events with 2 rejections, `rejectionReasons` counts both, `costPerMergedPr` divides total cost by merged PRs, and an empty ledger returns zeros without throwing.
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement** as pure functions, then the view: a live table, an agent status row, and a rejection-reason bar chart.
- [ ] **Step 4: Verify pass**
- [ ] **Step 5: Commit** `feat: live ledger and health board`

---

### Task 12: Oversight digest

**Files:**
- Create: `scripts/digest.ts`

- [ ] **Step 1: Implement** — reads the ledger via `readEvents`, prints the health summary as markdown.
- [ ] **Step 2: Verify** — run it against the fixture ledger, confirm the numbers match `computeHealth`.
- [ ] **Step 3: Register the Hermes cron** — one job, daily, running the script and delivering the digest. Use the `hermes-cron-jobs` skill for the exact invocation rather than guessing.
- [ ] **Step 4: Commit** `feat: daily oversight digest`

---

## Phase 0 done when

- The product is deployed and a real JD produces competencies, an interview, and a scored debrief.
- Four apps exist and their workflows run green on a real PR.
- The Ledger dashboard shows real events, not fixtures.
- `main` is protected and no bot can merge without the deterministic gates.
- One deliberately bad PR is rejected by Sentry and the rejection appears on the health board with a reason code.
# Second Round — Design Spec

**Status:** draft, awaiting owner review
**Date:** 2026-10-10
**Owner:** Harish Kotra
**Repo:** `second-round` (not yet created)

---

## 1. Purpose

Second Round interviews you for the job you actually want, using the real job
description, and then shows you the follow-up question a real interviewer would
have asked after each weak answer.

It is a practice tool. It does not predict hiring outcomes and must never claim
to.

## 2. Non-goals (enforced by the Drift Auditor)

- Not a resume builder.
- Not a job board or application tracker.
- Not a recruiter or hiring-decision tool.
- Not a "robot interviewer" that claims to replace a human interviewer.
- No claim that a high score predicts an offer.
- No storage of transcripts on a server by default.

Any PR whose behaviour matches a line in this list is auto-blocked by the
Gatekeeper. The list is machine-read from `spec/non-goals.yaml`.

## 3. The two fleets

This build has two independent agent systems. Confusing them is the primary
design failure mode.

- **Fleet A, the Panel.** Runtime agents inside the product. They interview the
  user. They are personas with different interview styles.
- **Fleet B, the Crew.** GitHub App bots that build and maintain the product.
  They are personalities with different judgments.

Fleet A is the product. Fleet B is the showcase.

## 4. Fleet B roster — the Crew

Every bot is a separate GitHub App with its own identity, its own persona file
at `.github/agents/<bot>.md`, and least-privilege permissions. Persona files are
public and versioned; changing one requires a PR like any other change.

| Bot | App slug | Persona | Responsibility | Permissions | Trigger | Phase |
|---|---|---|---|---|---|---|
| Foreman | `sr-foreman` | Plans before anyone touches a keyboard. Terse. | Owns `spec/`; opens milestones; decomposes into issues; assigns work | `issues:write`, `contents:write` (spec/) | manual + daily 06:00 | 0 |
| Mason | `sr-mason` | Ships fast, small diffs, hates ceremony. Runs `deepseek-v4.1-flash`. | Implements one assigned issue; opens a PR | `contents:write`, `pull_requests:write` | issue assigned | 0 |
| Vault | `sr-vault` | Reads twice, prefers the boring solution. Runs `glm-5.3-flash`. | Same job as Mason, second model, for head-to-head comparison | same | issue assigned | 1 |
| Sentry | `sr-sentry` | Reviews the requirement before the code. | Reviews every PR against the requirement and the diff; requests changes | `pull_requests:write` | PR opened / synchronized | 0 |
| Compass | `sr-compass` | Asks "why are we building this?" | Drift audit: orphans, gaps, non-goal violations. Can block | `issues:write`, `pull_requests:write` | weekly + PR touching a feature | 1 |
| Curator | `sr-curator` | Allergic to filler. | Slop audit: dead code, duplication, untested paths, placeholders, no-op tests. Can block | `pull_requests:write`, `checks:write` | PR opened + nightly | 1 |
| Turnstile | `sr-turnstile` | Has no opinions, only checks. | The only identity allowed to merge. Merges when every gate passes | `contents:write`, `pull_requests:write` | checks completed | 0 |
| Scribe | `sr-scribe` | Makes it readable. | CHANGELOG, weekly report, ledger narrative, video script. Never touches code | `contents:write` (docs/, ledger/) | daily | 1 |
| Reception | `sr-reception` | Answers before anyone else. | Inbound triage: label, reproduce, ask for missing info, close duplicates | `issues:write` | issue opened | 2 |

Phase 0 registers four apps: Foreman, Mason, Sentry, Turnstile.

## 5. Fleet A roster — the Panel

| Agent | Persona | Responsibility | Phase |
|---|---|---|---|
| Reader | Extracts, never invents | JD to competencies, each with a quoted line from the JD, plus loop shape | 0 |
| Ladder | Builds a difficulty ladder | Competencies to an ordered question plan | 0 |
| Scorecard | Deterministic | 7-axis rubric scoring with a quoted justification per axis | 0 |
| The Recruiter | Friendly, fast, 15 minutes | Fit, motivation, basics | 1 |
| The Boss | Deep on experience | Your actual work, ownership, impact | 1 |
| The Engineer | Probes until you break | Depth, tradeoffs, debugging | 1 |
| The Doubter | Attacks the weakest claim | Adversarial pressure on one claim | 1 |
| The Standard | Calibration | "Would I want to work with this person?" | 1 |
| The Mirror | Shows you what happened | Fumble timeline and rewrites | 1 |
| The Auditor | Audits the scorer | Fairness and consistency check on Scorecard | 2 |

## 6. The rubric (the actual product)

Seven axes, 0 to 2 each, maximum 14. Each axis score must quote the sentence it
is based on. No quote, no score.

| Axis | 0 | 1 | 2 |
|---|---|---|---|
| Answered the question | Answered a different question | Partially | Directly |
| Specificity | No numbers or names | Some | Concrete numbers and artifacts |
| Ownership | All "we" | Mixed | Clear "I did X" |
| Evidence | Bare claim | Vague example | Specific example with outcome |
| Depth | Failed the first "why?" | Survived one | Survived two |
| Tradeoffs | None mentioned | Implied | Explicit what was given up |
| Self-awareness | Defensive or evasive | Neutral | Honest about the gap |

**Fumble** = any axis at 0, or Depth failing at the second "why?".

**Follow-up generation is mechanical, not vibes.** The follow-up question is
derived from the failed axis:

- Specificity 0 to "What was the number?"
- Ownership 0 to "What did you personally do?"
- Evidence 0 to "Can you give me a specific example?"
- Depth 0 to "Why? And then why does that matter?"
- Tradeoffs 0 to "What did you give up to get that?"
- Answered the question 0 to "You answered something else. Let me ask again."

This is why the product feels real: the follow-up is not generated from
imagination, it is generated from the failure.

## 7. Requirements

Machine-readable in `spec/requirements.yaml`. Every PR body must contain
`Closes R-0NN` or `Closes C-0NN`, and CI fails if the ID does not exist.

### Product

- **R-001** Accept a pasted JD or a JD URL.
- **R-002** Extract at least 5 competencies, each with a quoted JD line.
- **R-003** Predict the interview loop shape (stages and rough length).
- **R-004** Conduct a multi-turn interview of at least 12 questions.
- **R-005** Score every answer on the 7-axis rubric with a quoted justification.
- **R-006** Trigger an adaptive follow-up whenever any axis scores 1 or below.
- **R-007** Detect fumbles (any axis 0, or Depth failing the second why).
- **R-008** For every fumble, output the follow-up a real interviewer would ask next, derived from the failed axis.
- **R-009** Render a debrief: transcript, per-answer scores, fumbles, rewrites.
- **R-010** Export a redacted Fumble Card as a shareable image.
- **R-011** Persist sessions and allow resuming one.
- **R-012** Compare scores across sessions for the same competency.
- **R-013** JD-only mode: work with no resume supplied.
- **R-014** Show the rubric and what each axis means to the user.
- **R-015** Never claim to predict hiring outcomes.
- **R-016** Local-first transcripts; sharing is explicit opt-in.
- **R-017** Keyboard-only usable, with accessible labels on every score view.
- **R-018** Voice mode (Phase 3).

### Crew system

- **C-001** `spec/requirements.yaml` is the single source of truth.
- **C-002** CI fails any PR whose body lacks a valid requirement ID.
- **C-003** A PR matching a non-goal is auto-blocked.
- **C-004** Each bot is a separate GitHub App with least-privilege permissions.
- **C-005** Labels are the lease. Two bots cannot claim the same issue.
- **C-006** Every agent action is appended to `ledger/events.ndjson`.
- **C-007** Merge requires lint, typecheck, test, build, and coverage floor to pass.
- **C-008** A drift report is published weekly.
- **C-009** Every rejected PR records a rejection reason code.
- **C-010** Each bot has a daily spend cap; exceeding it pauses the bot.
- **C-011** Changes touching `spec/` require a human approval.
- **C-012** Every persona lives in `.github/agents/<bot>.md` and changes via PR.

## 8. Orchestration

**Correcting the mental model first: the bots do not need to run forever. They
need to react to events and act on a schedule.** "Always running" is the wrong
shape and it costs you a server for nothing.

Three layers, each doing one job:

### 8.1 Fleet runtime — GitHub Actions

Each bot is a workflow that mints its own installation token with the GitHub-owned
action `actions/create-github-app-token`, using the app's client ID (a repo
variable) and private key (a repo secret). No hand-rolled JWT flow.

- Reactive triggers: `issues`, `pull_request`, `pull_request_review`,
  `check_suite` for Mason, Sentry, Turnstile, Reception.
- Scheduled triggers: `schedule` cron for Foreman, Compass, Curator, Scribe.
- `workflow_dispatch` on everything, so any bot can be run by hand.
- `concurrency:` groups so two runs of the same bot never overlap.

Why this and not a server: it is free on a public repo, every run is a public
log, it survives reboots, it needs no uptime, and it is literally how large
OSS projects run their bots today. Anyone can fork the repo and reproduce the
whole system.

**Pitfalls to design around**

- A push made with an app token *does* trigger workflows, unlike a `GITHUB_TOKEN`
  push. Ledger commits must therefore be excluded with `paths-ignore: ledger/**`
  on every bot trigger, or the bots will loop on their own bookkeeping.
- Scheduled workflows are disabled after 60 days of repository inactivity. The
  ledger commits prevent this, which is a second reason the ledger is committed
  rather than stored elsewhere.

### 8.2 Work queue and leases — GitHub itself

No queue service. An issue is claimed by applying a label (`claimed:mason`) and
assigning the bot. That is atomic enough (label creation is a single API call)
and it is public, which is the point.

If the reclaim-on-crash logic becomes painful, the fallback is `hermes kanban`,
which already ships atomic claims, stale-claim reclamation, and failure limits
with a dispatcher. Note it as an option, not the default, because moving the
queue out of GitHub weakens the showcase.

### 8.3 Shared state — the committed ledger

`ledger/events.ndjson`, one JSON object per line, appended by whichever bot acted:

```json
{"ts":"2026-10-10T06:00:12Z","bot":"sr-mason","action":"pr.opened","req":"R-004","artifact":"#42","cost_usd":0.031,"verdict":null}
```

This is the only source for every number on the health board. Nothing is
self-reported. A local SQLite mirror is fine for development; the committed
NDJSON is the record of truth.

### 8.4 Where Hermes fits

Hermes is not the fleet runtime. A Hermes profile is a single-assistant runtime
with its own sessions, skills, and memory; the fleet needs ten GitHub identities
and GitHub-native state. Running the fleet inside Hermes would demo Hermes, not
agent-maintained OSS.

Hermes is used for three things where it genuinely wins:

1. **Oversight.** One cron job that reads the health board and posts a daily
   digest to the owner. This is how a human stays in the loop without watching.
2. **The Scribe's long-form work.** Weekly report and video script, as a cron job
   with the ledger as input.
3. **Local dashboard persistence.** If the live Ledger dashboard runs on the Mac,
   `launchd` keeps it alive across reboots (see the `macos-launchd-services`
   skill).

## 9. Visual proof

Beyond "agents review each other's PRs".

1. **The Ledger.** Live view of `ledger/events.ndjson`. Columns: time, bot with
   avatar, action, requirement, artifact link, verdict, cost.
2. **The Live Org Chart.** Bots as characters with live status (idle, working,
   blocked, rejected) and animated handoff arrows.
3. **The Health Board.** All computed from git and CI: time from issue to first
   response, PRs merged vs rejected per bot, rejection reason histogram, spec
   drift score over time, dead code percent, coverage, mutation score, human
   touch rate.
4. **The Drift Report.** Published weekly. Orphans (built, not specced), gaps
   (specced, not built), non-goal violations caught.
5. **The Rejection Reel.** A montage of real rejections with the reviewer's
   reasoning. Proof the bots actually disagree.
6. **The maintainer simulation.** One week running the crew against the real
   issue backlog of a large project, then published against that project's own
   historical numbers (median time to first response being the headline). Run on
   a fork. Never spam PRs upstream.

## 10. Quality gates

An LLM reviewer is signal, never a gate.

**Deterministic (blocking):** lint, typecheck, unit tests, build, coverage floor,
mutation score floor, requirement-ID check, non-goal check.

**LLM (blocking only as a second opinion):** Sentry review, Curator slop audit,
Compass drift check. Each records a reason code.

**Human (blocking):** anything touching `spec/`, and the final call on any merge
the crew is split on.

## 11. Security and secrets

- Ten private keys live in GitHub Actions secrets and the local keychain. Never in
  the repo.
- Least privilege per app. Only Turnstile merges. Only Foreman writes `spec/`.
  No bot gets both `contents:write` and `workflows:write` unless it must.
- Decide the blast radius of a compromised Builder: it can open PRs, it cannot
  merge, it cannot edit the spec, it cannot edit workflows.
- The product's LLM key is a server-side secret; the client never sees it.

## 12. Privacy

- Transcripts are local by default.
- Fumble Card export is redacted by default.
- A stated retention rule, published in the repo, before any session is stored.
- If a user is practising for a role at their current employer, they will paste
  confidential material. Say plainly what leaves the device.

## 13. Evaluation

- **Rubric validity.** Two or three real interviewers score the same transcripts
  blind. Report agreement. Without this the score is decoration.
- **Panel calibration.** A regression suite of known-strong and known-weak
  answers. The panel must not fail the strong set or pass the weak set.
- **Product efficacy.** Phase 4. Do users who practise improve? Publish the
  answer either way.

## 14. Phases

| Phase | Product | Crew |
|---|---|---|
| 0 | JD intake, one interviewer, rubric, transcript, deployed | Foreman, Mason, Sentry, Turnstile, ledger, CI gate, health board |
| 1 | Full panel of 5 personas, adaptive follow-ups, Fumble Card | Vault, Compass, Curator, Scribe |
| 2 | Session history, competency map, improvement tracking | Reception, maintainer simulation |
| 3 | Voice | Drift Report published weekly |
| 4 | Efficacy benchmark | Rejection Reel and retrospective |

## 15. Open questions

1. Does Phase 0 need voice for the clip, or is text enough?
2. Fork of a large OSS project, or the owner's own repos, for the simulation?
3. Is the rubric agreement study run before or after Phase 1 ships?
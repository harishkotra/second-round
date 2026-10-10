# Second Round

An interview panel that interrogates you against the real job description, then shows you the
follow-up question a real interviewer would have asked after each weak answer.

This repository is two systems living in one place.

**Fleet A, the Panel**, is the product. A set of interviewer personas that read a job description,
interview you adaptively, score every answer on a named rubric, and hand you a debrief with the
exact moment you lost the room.

**Fleet B, the Crew**, is how this repository gets built and maintained. A set of GitHub App bots,
each with its own identity, persona, and permissions, that pick up work from `spec/`, open pull
requests, review each other against the spec, and merge only when a deterministic gate passes.

Fleet A is what you use. Fleet B is what builds it.

## Why the crew exists

Most agent-built projects fail in one of two ways. The agents drift away from what was specified,
or they produce plausible rubbish that nobody catches because an LLM said it looked fine.

Both are addressed mechanically here, not by hoping:

- `spec/requirements.yaml` is the single source of truth. Every pull request must name a requirement
  id from it, and CI fails otherwise.
- `spec/non-goals.yaml` lists what this project explicitly is not. A pull request matching a non-goal
  is blocked.
- An LLM reviewer is signal, never a gate. Merging requires lint, typecheck, tests, build, and
  coverage to pass first.
- Every agent action is appended to `ledger/events.ndjson`, so the health of the project is computed
  from the record rather than self-reported.

## Status

Phase B, the crew foundation. The spec, the requirement-ID gate, CI, the ledger,
the bot core, and Foreman are in place and tested. Mason, Sentry, and Turnstile
are next.

- Design spec: `docs/superpowers/specs/2026-10-10-second-round-design.md`
- Phase 0 plan: `docs/superpowers/plans/2026-10-10-second-round-phase-0.md`

### Where the ledger lives

The record is on a `ledger` branch, not on `main`. `main` is protected and a bot
cannot push to it, which is deliberate. Each bot appends only to its own file
(`ledger/<bot>.ndjson`) and each bot workflow has its own concurrency group, so
two runs of the same bot can never collide. The branch is created automatically
on the first write.

## Working on it

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## Contributing

Every pull request body must contain a line naming a requirement, for example:

```
Closes R-004
```

Run `npm run req-id` to check a body locally before opening the pull request.

---

Built By Harish Kotra — [harishkotra.me](https://harishkotra.me)

Checkout my other builds — [dailybuild.xyz](https://dailybuild.xyz)
# CONVENTIONS.md

Conventions for any agent writing code in this repository. Read this before you
write a line. These rules are enforced by CI, so breaking one fails the pull
request rather than being caught in review.

This file is read by the crew bots at runtime (`src/bot/context.ts`) and injected
into their prompt, so it is part of the build surface: changing it changes what
every bot knows. Change it by pull request.

## What this is

Second Round is an interview-practice product. It is built and maintained by a
crew of GitHub App bots that run in GitHub Actions. Each bot is a separate App
with its own identity, its own permissions and its own ledger file.

## Layout

- `src/bot/` — shared bot infrastructure: GitHub plumbing, the model client, the
  patch parser, the run harness, claim/budget/ledger helpers. Put reusable code here.
- `src/bots/` — one entry point per bot (`mason.ts`, `sentry.ts`, `turnstile.ts`,
  `foreman.ts`). Each ends with an `isEntry` guard so it can be imported in tests.
- `src/ledger/` — the append-only event schema and the health computation.
- `src/spec/` — loads and validates `spec/requirements.yaml`.
- `scripts/` — repo tooling (the linter, the requirement-ID gate).
- `tests/` — mirrors `src/` exactly. A file at `src/bot/foo.ts` is tested at
  `tests/bot/foo.test.ts`.
- `spec/` — the requirements and non-goals. **Never edit this.** Changing what is
  owed is a human decision, and CI blocks it.

## Conventions that will break CI if you ignore them

1. **Relative imports must end in `.js`, even from TypeScript files.** The
   compiler uses `module: NodeNext`. Write `import { x } from '../bot/model.js'`,
   never `'../bot/model'`.
2. **No implicit `any`.** Annotate every callback parameter. `async (url) => {}`
   fails; `async (url: string) => {}` passes.
3. **`noUncheckedIndexedAccess` is on.** Indexing an array or record yields
   `T | undefined`. Handle the `undefined` case; do not assert it away.
4. **`exactOptionalPropertyTypes` is on.** Do not pass `undefined` to an optional
   property. Omit the property instead.
5. **No `any`, no `@ts-ignore`, no `@ts-nocheck`.** The linter rejects all three.
6. **No `TODO`, `FIXME` or `XXX` comments.** The linter rejects them.
7. **No `console.log` in `src/`** except in a bot entry point. Use the `run.log`
   callback, which is the operational log.
8. **No `.only(` in tests.** It would silently skip the rest of the suite.
9. **Every file stays under 400 lines.**
10. **Single quotes, no semicolons, named exports only.** Match the existing
    files rather than your own default style.

## The rule that matters most

**If a requirement changes existing behaviour, edit the existing file.** Do not
add a new module beside it. A new module that nothing imports does not satisfy a
requirement, no matter how good the code is. If you cannot safely edit a file,
say so in `notes` and do not open the pull request as if the work were done.

## Commands

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

All four must pass before a pull request is worth opening.

## Guardrails

- Never push to `main`. Branches only.
- Never merge, and never approve your own pull request.
- Never edit `spec/`.
- The pull request body must contain `Closes <requirement-id>` or CI rejects it.
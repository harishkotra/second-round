# sr-turnstile

**Identity:** `sr-turnstile[bot]`, a GitHub App. Not a user account.
**Runs:** when a check suite completes.
**Writes:** merges. It is the only identity permitted to merge.

## Persona

Has no opinions, only checks. Does not care whether the change is good. Cares
whether every condition is satisfied, and nothing else.

## Responsibility

Merge a pull request when, and only when, every gate passes.

## Hard rules

- Deterministic gates first: lint, typecheck, test, build, coverage. All green,
  or no merge.
- A block from Curator or Compass stops the merge regardless of anything else.
- A pull request touching `spec/` requires a recorded human approval (C-011).
- Never merges its own pull request. Never pushes code. Never writes a review.
- On refusal it records why, so a refusal is auditable rather than mysterious.

## Why it is separate from Sentry

If the reviewer could also merge, a soft review and a merge become the same
action and the gate becomes decorative. Separating the identity that judges from
the identity that merges is the entire reason this bot exists.
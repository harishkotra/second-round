# sr-foreman

**Identity:** `sr-foreman[bot]`, a GitHub App. Not a user account.
**Runs:** daily at 06:00 UTC, or by hand via `workflow_dispatch`.
**Writes:** issues, and `spec/` only when a human has approved it.

## Persona

Plans before anyone touches a keyboard. Terse. Would rather open one correct
issue than ten plausible ones. Has no interest in what is interesting to build,
only in what the spec says is owed.

## Responsibility

Owns `spec/requirements.yaml`. Reads it, compares it against the open issues, and
opens exactly one issue per requirement that has no issue yet. Nothing more.

## Hard rules

- One requirement, one issue. Never two issues for the same requirement id.
- Never invents a requirement. If it is not in `spec/`, it is not work.
- Never opens a pull request, never merges, never edits product code.
- Every issue body carries `Closes <id>` so the requirement stays traceable
  through the pull request that eventually resolves it.
- Does not use a model to decide what the work is. The spec already decided.

## Why it exists

Drift is prevented mechanically, not by hoping. If every unit of work traces to a
requirement id, then work that traces to nothing is visible as work that traces
to nothing.

## Records to the ledger

`issue.opened` with the requirement id and the issue number.
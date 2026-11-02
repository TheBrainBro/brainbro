# Contributing to BrainBro

Issues, pull requests, commits, code and documentation are written in English.

## Issue workflow

Every open issue must have exactly one workflow label:

- `status: pending`: implementation has not started.
- `status: in-progress`: implementation or validation has started, but the issue is not ready to close.
- `status: blocked`: work started and cannot continue until a concrete dependency or decision is resolved. Record the blocker in an issue comment.

An assignment by itself does not mean work has started. Change `status: pending` to
`status: in-progress` when implementation, research or validation actually begins.

Close an issue only when all of its required scope is on `main`. If a pull request
implements only part of an issue, keep the issue open and update its checklist or add
a comment describing what remains.

When choosing work, start from open issues with `status: pending`. Exclude issues with
the `epic` label unless the work is to maintain the epic itself, and use the epic's
unchecked child issues instead.

Useful GitHub searches:

- Next work: `is:issue is:open label:"status: pending" -label:epic`
- Active work: `is:issue is:open label:"status: in-progress"`
- Needs unblocking: `is:issue is:open label:"status: blocked"`

## Pull requests and issue references

Feature and fix pull requests normally target `develop` and use `Refs #123` in the
description. Use `Refs` even when that PR completes the implementation: the issue is
not released until the change reaches `main`.

Release and hotfix pull requests target `main`:

- Put every issue included in the release on a single `Ref #123 #456` line. The release
  script uses this line to build the GitHub release notes.
- Add `Closes #123` for each issue whose complete required scope is included. GitHub
  closes it when the PR reaches `main`.
- Do not add `Closes` for partial work. Leave the issue open, keep or set
  `status: in-progress`, and comment with what shipped and what remains.

Before merging a release, review every issue on the `Ref` line. Confirm that completed
issues appear in `Closes` and partially completed issues still describe their remaining
work. After the release, the open-issue list should contain only unfinished work.

## Development

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(backend): ...`, `fix(frontend): ...`, `chore(infra): ...`.
- Git flow: `main` (releases), `develop` (integration), `feature/*`, `release/*`,
  `hotfix/*`.
- Run `make test` and `make lint` before requesting review. Run the relevant narrower
  checks while iterating.

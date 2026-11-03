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

## Preparing a production release

Use this sequence when promoting the current integration branch to production:

1. Fetch `org` and compare `develop` with `main`. Confirm that the local `develop`
   matches `org/develop`, `main` matches `org/main`, and identify every change that
   has reached `develop` since the latest release. Check the open PRs targeting
   `develop` and the latest CI results before setting the release scope.
2. Review the issues associated with those changes. Include each shipped issue on one
   `Ref #123 #456` line in the release PR. Add `Closes #123` only when the issue's
   complete required scope is in this release; otherwise leave it open and retain its
   in-progress status. Include changes without an issue in the PR description.
3. Choose the next version from the changes since the last release. Create
   `release/x.y.z` from the latest `develop`, merge the latest `main` into it, and
   resolve any conflicts while preserving the release's version as the final version
   in `backend/pyproject.toml`, `frontend/package.json`, and
   `frontend/package-lock.json`. Commit the version update as
   `chore: release x.y.z`.
4. Open a release PR from `release/x.y.z` to `main`. Describe the scope, list issues
   using the required `Ref` and `Closes` lines, and verify the diff and required CI
   checks. Do not merge or deploy without the user's request.
5. When the PR is merged, `.github/workflows/release.yml` runs
   `scripts/release.sh <pr-number>`, which creates tag `vx.y.z` and publishes the
   GitHub Release with notes from the PR. Check that the workflow and release
   succeeded.
6. Production is deployed separately in Portainer: open **Stacks**, select the
   BrainBro stack, and choose **Pull and redeploy** with **Re-pull image and
   redeploy** enabled. The stack tracks `main`. The `migrate` service backs up the
   database before applying pending migrations; it completes before `api` and
   `worker` start. Do not run migrations or restart services separately.
7. Confirm the deployment is healthy in Portainer and that the production app
   responds. Then review the issues on the release PR: fully completed issues should
   have closed through `Closes`; leave partial issues open and document any remaining
   validation (for example, checks that require live production clients).

If a release workflow fails after merge, inspect its run and use
`scripts/release.sh <pr-number>` to retry safely. The script is safe to rerun when
the tag or GitHub Release already exists. A GitHub Release does not itself deploy the
application; Portainer remains a separate manual step.

## Development

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(backend): ...`, `fix(frontend): ...`, `chore(infra): ...`.
- Git flow: `main` (releases), `develop` (integration), `feature/*`, `release/*`,
  `hotfix/*`.
- Run `make test` and `make lint` before requesting review. Run the relevant narrower
  checks while iterating.

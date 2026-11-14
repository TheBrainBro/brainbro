# Maintaining

For maintainers: the issue workflow and how a release is made. Contributing is described in
[CONTRIBUTING.md](../CONTRIBUTING.md). Commands use `origin` for `TheBrainBro/brainbro`.

## Issue workflow

Every open issue has exactly one workflow label:

- `status: pending`: work has not started.
- `status: in-progress`: implementation or validation has started, but the issue is not
  ready to close.
- `status: blocked`: work started and cannot continue until a concrete dependency or
  decision is resolved. The blocker is recorded in an issue comment.

An assignment by itself does not mean work has started: the label changes to
`status: in-progress` when implementation, research or validation begins.

When choosing work, start from open issues with `status: pending`. Leave out issues labeled
`epic`, unless the work is to maintain the epic itself, and use the epic's unchecked child
issues instead.

- Next work: `is:issue is:open label:"status: pending" -label:epic`
- Active work: `is:issue is:open label:"status: in-progress"`
- Needs unblocking: `is:issue is:open label:"status: blocked"`

Pull requests reference issues with `Refs`, never `Closes` or `Fixes`, so GitHub does not
close anything on merge. An issue is closed by hand once all of its required scope is in a
release. If only part of it shipped, it stays open with a comment or checklist saying what
remains.

## Releases

Versions follow `x.y.z`. A release promotes `develop` to `main`; a hotfix fixes `main`
directly.

1. Fetch `origin` and compare `develop` with `main`: every change that reached `develop`
   since the last release, the open pull requests targeting `develop`, and the latest CI
   results.
2. Choose the next version. Create `release/x.y.z` from the latest `develop` and merge the
   latest `main` into it. A hotfix branches as `hotfix/x.y.z` from `main`.
3. Set the version in `backend/pyproject.toml`, `frontend/package.json` and
   `frontend/package-lock.json`, and commit it as `chore: release x.y.z`.
4. Open a pull request to `main`. Its first line lists every issue included, on one line:
   `Ref #123 #456`. The rest of the description, with the scope and any changes without an
   issue, becomes the release notes. Check the diff and the required checks.
5. Merging it runs [`.github/workflows/release.yml`](../.github/workflows/release.yml):
   [`scripts/release.sh`](../scripts/release.sh) tags `vx.y.z` at the merge commit and
   publishes the GitHub Release, with the titles of the issues on the `Ref` line. Then the
   `images` job publishes `brainbro`, `brainbro-embedder` and `brainbro-caddy` to
   `ghcr.io/thebrainbro/` for amd64 and arm64, tagged `x.y.z`, `x.y` and `latest`.
6. Close the issues whose whole scope shipped; comment on the partial ones with what remains.

A release deploys nothing. Each install upgrades on its own
([deployment.md](deployment.md#upgrading)).

### When something fails

- `scripts/release.sh <pr-number>` redoes the tag and the GitHub Release by hand. It is
  safe to rerun: an existing tag or release is left as it is. `DRY_RUN=1` prints the notes
  and changes nothing, `--not-latest` keeps an older line's release from being marked as
  latest, and `REMOTE` changes the remote (default `origin`).
- To publish the images of an existing tag again, run the **Release** workflow by hand
  (**Actions → Release → Run workflow**) with the version, without the `v`.

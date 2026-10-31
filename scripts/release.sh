#!/usr/bin/env bash
# Tag a merged release/x.y.z or hotfix/x.y.z PR and publish its GitHub release.
# Safe to re-run: an existing tag or release is left as it is.
#   scripts/release.sh <pr-number> [--not-latest]
# Needs gh (authenticated) and a git identity for the tag. REMOTE defaults to
# origin; DRY_RUN=1 prints the notes and changes nothing.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

pr=${1:?Usage: scripts/release.sh <pr-number> [--not-latest]}
latest=true
remote=${REMOTE:-origin}
[ "${2:-}" = "--not-latest" ] && latest=false

IFS=$'\t' read -r branch sha merged_at < <(
  gh pr view "$pr" --json headRefName,mergeCommit,mergedAt \
    -q '[.headRefName, .mergeCommit.oid, .mergedAt] | @tsv'
)
[ -n "$sha" ] || { echo "PR #$pr is not merged." >&2; exit 1; }
case "$branch" in
  release/* | hotfix/*) version=${branch#*/} ;;
  *) echo "PR #$pr is not a release or hotfix branch ($branch)." >&2; exit 1 ;;
esac
tag="v$version"
kind=$([ "${branch%%/*}" = hotfix ] && echo Hotfix || echo Release)

git fetch --quiet --tags "$remote"
if [ -n "${DRY_RUN:-}" ]; then
  :
elif git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists."
else
  # Dated at the merge, so tags made later still sort and read correctly.
  GIT_COMMITTER_DATE="$merged_at" git tag -a "$tag" "$sha" -m "$kind $version"
  git push --quiet "$remote" "refs/tags/$tag"
  echo "Tagged $tag at ${sha:0:7}."
fi

if [ -z "${DRY_RUN:-}" ] && gh release view "$tag" >/dev/null 2>&1; then
  echo "Release $tag already exists."
  exit 0
fi

body=$(gh pr view "$pr" --json body -q .body | tr -d '\r')
refs=$(printf '%s\n' "$body" | grep -m1 -E '^Ref ' | grep -oE '#[0-9]+' | tr -d '#' || true)
rest=$(printf '%s\n' "$body" | { grep -v -E '^Ref ' || true; } | sed -e '/./,$!d')
previous=$({ git tag -l 'v*'; echo "$tag"; } | sort -u -r -V | grep -A1 -x "$tag" | sed -n 2p)
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

notes=$(
  if [ -n "$refs" ]; then
    echo "## Issues"
    for n in $refs; do
      echo "- $(gh api "repos/$repo/issues/$n" -q .title) (#$n)"
    done
    echo
  fi
  if [ -n "$rest" ]; then
    printf '%s\n\n' "$rest"
  fi
  echo "$kind PR: #$pr"
  if [ -n "$previous" ]; then
    echo "Full diff: https://github.com/$repo/compare/$previous...$tag"
  fi
)

if [ -n "${DRY_RUN:-}" ]; then
  printf '%s\n' "$notes"
  exit 0
fi

gh release create "$tag" --verify-tag --title "$kind $version" \
  --notes "$notes" --latest="$latest" >/dev/null
echo "Published release $tag."

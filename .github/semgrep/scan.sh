#!/usr/bin/env bash
# Runs the Semgrep scan the CI runs. Locally too, from the repository root,
# once the rules are checked out: git submodule update --init .github/semgrep/rules
#
# Semgrep Community Edition, offline (no network, no account, no metrics),
# with the security rules of the pinned semgrep/semgrep-rules commit for what
# this repository holds. Fails on any finding.
#
# A finding that does not apply is ignored where it is, naming the rule and
# saying why, on the line of the finding or the line before:
#
#   return mark_safe(html)  # nosemgrep: avoid-mark-safe -- sanitized by nh3
#
# Any other nosemgrep comment fails the scan: a bare one would silence every
# rule on that line. Paths that are not scanned are in .semgrepignore.
set -euo pipefail

rules=.github/semgrep/rules
if [[ ! -d "$rules/python" ]]; then
  echo "::error::Semgrep rules missing. Run: git submodule update --init $rules"
  exit 2
fi

ignore_marker='nosem(grep)?'
valid_ignore='nosemgrep: [A-Za-z0-9._-]+(, ?[A-Za-z0-9._-]+)* -- [^[:space:]]'
invalid=$(git grep -nIE "$ignore_marker" -- . ':!.github/semgrep/scan.sh' | grep -vE "$valid_ignore" || true)
if [[ -n "$invalid" ]]; then
  while IFS=: read -r file line _; do
    echo "::error file=$file,line=$line::nosemgrep needs a rule and a reason: # nosemgrep: <rule> -- <why>"
  done <<< "$invalid"
  exit 1
fi

configs=(
  python/django/security
  python/lang/security
  python/requests/security
  javascript/browser/security
  javascript/lang/security
  typescript/lang/security
  typescript/react/security
  dockerfile/security
  yaml/docker-compose/security
  yaml/github-actions/security
)
args=()
for config in "${configs[@]}"; do
  args+=(--config "$rules/$config")
done

# Rules left out, with the reason.
excluded=(
  # Flags every template literal that looks like HTML, wherever it goes. The
  # sinks that matter (innerHTML, insertAdjacentHTML) have their own rules.
  javascript.lang.security.html-in-template-string
)
for rule in "${excluded[@]}"; do
  args+=(--exclude-rule "github.semgrep.rules.$rule")
done

out="${RUNNER_TEMP:-$(mktemp -d)}"
docker build --quiet --tag semgrep .github/semgrep > /dev/null

status=0
docker run --rm --network none \
  --volume "$PWD:/src:ro" --volume "$out:/out" --workdir /src \
  semgrep semgrep scan "${args[@]}" \
  --metrics=off --disable-version-check --error \
  --json-output=/out/semgrep.json || status=$?

if [[ -n "${GITHUB_STEP_SUMMARY:-}" && -f "$out/semgrep.json" ]]; then
  python3 -I "$(dirname "$0")/summary.py" "$out/semgrep.json" >> "$GITHUB_STEP_SUMMARY"
fi
exit "$status"

#!/usr/bin/env bash
# Runs pip-audit with the given arguments, plus one --ignore-vuln for each
# entry in ignore.txt. Each entry must say why it is ignored.
set -euo pipefail

ignore_file="$(dirname "$0")/ignore.txt"
ignore=()
while read -r id rest; do
  [[ -z "$id" || "$id" == \#* ]] && continue
  if [[ ! "$rest" =~ ^#\ *[^[:space:]] ]]; then
    echo "::error file=.github/pip-audit/ignore.txt::$id has no reason after #"
    exit 1
  fi
  ignore+=(--ignore-vuln "$id")
done < "$ignore_file"

exec pip-audit --strict --progress-spinner off ${ignore[@]+"${ignore[@]}"} "$@"

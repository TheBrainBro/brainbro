"""Writes the Semgrep findings as Markdown, for the job summary."""

import json
import sys

PREFIX = "github.semgrep.rules."

with open(sys.argv[1]) as file:
    report = json.load(file)

findings = report["results"]
if not findings:
    print("### Semgrep\n\nNo findings.")
    sys.exit()

print(f"### Semgrep: {len(findings)} finding{'s' if len(findings) > 1 else ''}\n")
print("| Rule | Where | Severity |")
print("| --- | --- | --- |")
for finding in findings:
    rule = finding["check_id"].removeprefix(PREFIX)
    where = f"`{finding['path']}:{finding['start']['line']}`"
    print(f"| `{rule}` | {where} | {finding['extra']['severity']} |")
print(
    "\nDetails in the job log. To ignore one that does not apply: "
    "`# nosemgrep: <rule> -- <why>` on its line."
)

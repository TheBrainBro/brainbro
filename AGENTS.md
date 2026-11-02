# Working in this repository

- Read `CLAUDE.md`, `CONTRIBUTING.md` and `.claude/workflow.md` before changing code.
- Before editing, inspect `git status` and preserve every existing local change. Never stage unrelated files.
- Implement issue work on a `feature/<issue>-<slug>` branch based on the latest `org/develop`. Never commit directly to `develop`.
- For implementation work, completion includes focused checks, conventional commits, pushing the feature branch and opening a PR to `develop`, unless the user explicitly asks for local-only work. Do not merge or deploy unless asked.
- Update the issue and related PR descriptions when required by the repository workflow and the `issue-sync` / `pr-description` skills.
- In the final response, report the branch, commit, PR, checks and any local changes left untouched.

# Auto-Commit After Changes

## Rule

After completing a logical unit of work — whether it's a spec task, a bug fix, a refactor, or any discrete change — **always commit the changes** before moving on to the next step.

## Commit Guidelines

1. **When to commit:** After each completed task or self-contained change. Do not batch multiple unrelated changes into a single commit.
2. **Commit message format:** Use a concise, descriptive message summarizing what was done (e.g., `feat: add Lambda generator`, `fix: correct VPC subnet routing`, `refactor: extract shared validation logic`).
3. **CRITICAL — Single-line commit messages ONLY:** Never use multi-line commit messages. Keep the `-m` argument as a single short line. Multi-line messages break in fish shell and cause the agent to retry infinitely even though the commit already went through. If you need to describe multiple changes, summarize them in one line (e.g., `feat: migrate all AWS icons to July 2025 asset package`). Do NOT add bullet points or line breaks inside the commit message string.
4. **Do not retry commits on shell errors:** If a `git commit` command returns a fish shell error (like `Unknown command`) but the commit message was provided, check `git status` or `git log --oneline -1` first — the commit likely already succeeded. Do NOT retry.
5. **Stage only relevant files:** Use `git add` with specific file paths rather than `git add .` to avoid committing unrelated changes.
6. **Do not push:** Only commit locally. Do not push unless explicitly asked.
7. **Branch safety:** Never commit directly to main/master unless explicitly instructed. If no branch has been specified, ask before creating one.

# Working on sideco

## Always work in a worktree

Several Claude Code sessions often work on this repository at the same time.
Never edit, commit or test in the main clone: create a worktree first.

```bash
git worktree add .claude/worktrees/<name> -b <name> origin/main
```

Work, test and commit there. Rebase on `origin/main`, push the branch and
wait for its CI, then fast-forward `main` and remove the worktree: the steps
are in [CONTRIBUTING.md](CONTRIBUTING.md), which is the reference.

The main clone stays on `main`, clean, so another session can merge into it
at any time.

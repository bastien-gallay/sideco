# Working on sideco

## Always work in a worktree

Several Claude Code sessions often work on this repository at the same time.
Never edit, commit or test in the main clone: create a worktree first.

```bash
git worktree add .claude/worktrees/<name> -b <name> main
```

Work, test and commit there. Merge into `main` with a fast-forward, then
remove the worktree and delete the branch:

```bash
git merge --ff-only <name>
git worktree remove .claude/worktrees/<name>
git branch -d <name>
```

The main clone stays on `main`, clean, so another session can merge into it
at any time.

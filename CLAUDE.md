# Working notes for Claude

## Communication
- Whenever a PR is opened **or** an update is pushed to an existing PR, include
  the PR's link in the reply (e.g. `https://github.com/<owner>/<repo>/pull/<n>`),
  so it's easy to jump to.

## Git workflow
- The usual rhythm here: the previous PR gets **merged**, then later a new change
  is requested. So **before starting any new change, sync with the latest
  `main` first** — don't assume the working branch is still current.
  1. `git fetch origin main`
  2. If `main` advanced (the last PR merged): reset the branch to it —
     `git checkout -B <branch> origin/main` — then make the new change and open a
     **new** PR (a merged PR can't be reused).
  3. If the branch still has unmerged commits beyond the merged history, **rebase
     them onto the new `main`** (`git rebase origin/main`) instead of discarding.
  4. If nothing merged (branch already ahead of an up-to-date `main`), just keep
     working on it — the open PR updates in place.
- The point: never stack new commits on top of already-merged history, and never
  leave a finished change stranded on a stale branch.

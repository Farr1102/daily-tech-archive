#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${DAILY_TECH_REPO_DIR:-/Users/farr/Desktop/code/daily-tech-archive}"
BRANCH="${DAILY_TECH_BRANCH:-main}"
REMOTE="${DAILY_TECH_REMOTE:-origin}"

export PATH="/Users/farr/.nvm/versions/node/v24.18.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"

LOCK_DIR="${TMPDIR:-/tmp}/daily-tech-archive-git-push.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "another push is already running"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

cd "$REPO_DIR"

git remote set-url "$REMOTE" git@github.com:Farr1102/daily-tech-archive.git
git fetch "$REMOTE" "$BRANCH"
git pull --rebase --autostash "$REMOTE" "$BRANCH"

find daily-tech -maxdepth 1 \( -name '*.md' -o -name '*.json' \) ! -name '.push-request.json' -exec git add -- {} +

if git diff --cached --quiet -- daily-tech; then
  echo "no daily-tech changes to commit"
else
  report_date="${DAILY_TECH_REPORT_DATE:-}"
  if [ -z "$report_date" ]; then
    report_date="$(find daily-tech -maxdepth 1 -name '????-??-??.json' -print | sed 's#^daily-tech/##; s#\.json$##' | sort | tail -n 1)"
  fi
  if [ -z "$report_date" ]; then
    report_date="$(date +%F)"
  fi
  git -c user.name='Farr1102' -c user.email='Farr1102@users.noreply.github.com' commit -m "chore: archive daily tech report ${report_date}"
fi

git push "$REMOTE" "$BRANCH"

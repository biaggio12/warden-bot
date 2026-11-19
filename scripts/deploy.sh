#!/usr/bin/env bash
# Production deploy, run on the server by .github/workflows/deploy.yml (or by hand):
#   scripts/deploy.sh <commit-sha>
# Fast-forwards the checkout to the given commit (never rewrites local history), backs up the
# database, then rebuilds and restarts the public stack. Migrations run when php starts.
set -euo pipefail
cd "$(dirname "$0")/.."

sha="${1:?usage: scripts/deploy.sh <commit-sha>}"

echo "==> Fetching $sha"
git fetch --quiet origin main
git merge --ff-only "$sha"

if docker compose ps --status running --quiet database | grep -q .; then
    echo "==> Backing up the database"
    scripts/backup-db.sh
fi

echo "==> Building and starting the stack"
make public-up

echo "==> Removing dangling images"
docker image prune --force >/dev/null

echo "==> Deployed $(git log -1 --format='%h %s')"

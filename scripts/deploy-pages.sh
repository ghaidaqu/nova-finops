#!/usr/bin/env bash
# Build the static prototype and force-push it to the gh-pages branch of origin.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:pages
remote="$(git remote get-url origin)"
cd dist-pages
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. log -1 --format=%an)" -c user.email="$(git -C .. log -1 --format=%ae)" \
  commit -q -m "Deploy $(git -C .. rev-parse --short HEAD)"
git push -q -f "$remote" gh-pages
rm -rf .git
echo "Deployed to https://ghaidaqu.github.io/nova-finops/ (GitHub Pages may take a minute to update)"

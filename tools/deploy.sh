#!/bin/sh
# Build + deploy to Cloudflare Pages project `vestire-listing-studio` (direct upload, advanced mode _worker.js).
# Needs CLOUDFLARE_API_TOKEN. Everything (static files too) is inside _worker.js, so no asset-upload JWT is needed.
set -e
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_ACCOUNT_ID:=77fbb1818ef71a953eb5844745da8cef}"
node tools/build.mjs
cd pages-dist
curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/vestire-listing-studio/deployments" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'manifest={}' -F branch=${PAGES_BRANCH:-main} -F "commit_hash=$(git rev-parse --short HEAD 2>/dev/null || echo local)" -F commit_dirty=true \
  -F "_worker.js=@_worker.js;filename=_worker.js;type=application/javascript+module" \
  -F "_routes.json=@_routes.json;filename=_routes.json;type=application/json"
echo

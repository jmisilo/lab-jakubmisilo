#!/usr/bin/env sh

cd "$(dirname "$0")/../../.." || exit 1

if ! command -v vercel >/dev/null 2>&1; then
  echo "Vercel CLI is required for API development."
  echo "Install it with: pnpm add -g vercel"
  exit 1
fi

if [ -f apps/api/.env.local ]; then
  set -a
  . apps/api/.env.local
  set +a
fi

vercel dev apps/api --listen 8080 --yes

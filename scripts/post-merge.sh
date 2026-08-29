#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run migrate
pnpm exec tsc -b lib/db
pnpm --filter @workspace/api-server run build

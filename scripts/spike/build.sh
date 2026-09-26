#!/bin/sh
# Bundle a spike script the way scripts/shard-runner.ts bundles shards (esbuild, node22, ESM).
set -e
cd "$(dirname "$0")/../.."
mkdir -p dist-spike
for s in "$@"; do
  node_modules/.bin/esbuild "scripts/spike/$s.ts" --bundle --platform=node --format=esm --target=node22 "--outfile=dist-spike/$s.mjs" --log-level=warning --sourcemap
done

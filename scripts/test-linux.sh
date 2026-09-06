#!/bin/sh
set -eu
mkdir -p /work
tar -C /source --exclude=node_modules --exclude=.runtime --exclude=.migration-reference --exclude=.git --exclude=.env --exclude=dist -cf - . | tar -C /work -xf -
cd /work
npm ci --no-audit --no-fund
npm run build
npm run typecheck
npm test
npm pack -w client --pack-destination /tmp
npm install --prefix /tmp/isard-cli /tmp/isard-client-0.1.0.tgz --no-audit --no-fund
/tmp/isard-cli/node_modules/.bin/isard-sync --help
/tmp/isard-cli/node_modules/.bin/isard-submit --help

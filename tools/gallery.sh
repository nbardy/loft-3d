#!/bin/sh
cd "$(dirname "$0")/.." && PATH="$HOME/.nvm/versions/node/v24.3.0/bin:$PATH" pnpm --silent loft gallery "$@"

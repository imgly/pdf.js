#!/bin/sh
# Minimal guardrail: confirm that all imgly source patches are still
# present after a rebase / cherry-pick onto a new upstream tag. Run
# manually before `npx gulp dist`.
set -e
grep -q "imglyPatchVersion" src/display/api.js
grep -q "fillColorSpaceKey" src/core/evaluator.js
grep -q "get colorSpaceResources" src/core/document.js
grep -q "imglyPatchVersion" src/core/worker.js
echo "patches present"

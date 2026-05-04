#!/bin/sh
# Minimal guardrail: confirm that all imgly source patches are still
# present after a rebase / cherry-pick onto a new upstream tag. Run
# manually before `npx gulp dist`.
set -e
# Source patches
grep -q "imglyPatchVersion" src/display/api.js
grep -q "fillColorSpaceKey" src/core/evaluator.js
grep -q "get colorSpaceResources" src/core/document.js
grep -q "imglyPatchVersion" src/core/worker.js
# Build-config patch (otherwise `gulp dist` republishes under the
# upstream `pdfjs-dist` name with Mozilla URLs).
grep -q "@imgly/pdfjs-dist" gulpfile.mjs
grep -q "IMGLY_PATCH_REVISION" gulpfile.mjs
echo "patches present"

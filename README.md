# `@imgly/pdfjs-dist` — fork of mozilla/pdf.js

This repository is a fork of [mozilla/pdf.js](https://github.com/mozilla/pdf.js)
maintained by IMG.LY. It exists solely to surface a small set of additional
fields on `PDFPageProxy` (page boxes, Separation/DeviceN color spaces, raw
CMYK fills) that [`@imgly/pdf-importer`](https://www.npmjs.com/package/@imgly/pdf-importer)
needs and that upstream pdf.js does not expose.

The build output is published to npm as
[`@imgly/pdfjs-dist`](https://www.npmjs.com/package/@imgly/pdfjs-dist).

For upstream documentation see [`README.upstream.md`](./README.upstream.md).

## What the patches do

Four commits, prefix `imgly:`, on each release branch (`imgly/v<upstream>`):

1. **`src/display/api.js`** — add `PDFPageProxy.trimBox`, `bleedBox`,
   `colorSpaceResources`, `imglyPatchVersion` getters reading from
   `_pageInfo`.
2. **`src/core/evaluator.js`** — track `fillColorSpaceKey` and
   `strokeColorSpaceKey` in the operator walker; preserve raw CMYK args
   instead of converting to RGB; emit Separation/DeviceN args with the
   resource key appended so the consumer can resolve the ink name.
3. **`src/core/document.js`** — add `Page.trimBox`, `bleedBox`, and
   `colorSpaceResources` getters. The last one walks `/ColorSpace` and
   evaluates each Separation/DeviceN tint=1 against its alternate space
   via `PDFFunctionFactory`, returning a flat JSON-safe descriptor.
4. **`src/core/worker.js`** — forward the three new page fields plus
   `imglyPatchVersion: 2` across the worker boundary in
   `WorkerMessageHandler.GetPage`.

The version marker (`imglyPatchVersion`) is read by `@imgly/pdf-importer`
at parse time. If it's missing or out of date the importer fails fast
with a loud error rather than producing silently degraded output.

## Repository layout

- `master` — mirror of upstream `mozilla/pdf.js`.
- `imgly/v<upstream>` — release branch. Branched off the upstream tag
  `v<upstream>` with the four `imgly:` commits replayed on top.
- `scripts/check-patches.sh` — minimal grep guardrail; run after every
  rebase to confirm the patched markers still exist in source.

## Per-release runbook

Each new pdf.js version we want to consume:

```sh
git fetch upstream --tags
git checkout -b imgly/v<NEW> v<NEW>
git cherry-pick <first-imgly-commit>..<last-imgly-commit>   # from prev release branch
# Resolve any conflicts (always in src/{display/api,core/evaluator,core/document,core/worker}.js)

./scripts/check-patches.sh

npm install
npx gulp dist
grep -q imglyPatchVersion build/dist/legacy/build/pdf.worker.mjs

cd build/dist
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.name = "@imgly/pdfjs-dist";
  p.version = "<NEW>-imgly.1";
  p.repository = { type: "git", url: "https://github.com/imgly/pdf.js" };
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2));
'
npm publish --access public
```

Then in the `@imgly/pdf-importer` consumer: bump the
`@imgly/pdfjs-dist` dependency to the new version, run the regression
suite.

## When to bump `imglyPatchVersion`

Bump the integer (currently `2` in `src/core/worker.js`) **whenever the
shape of any patched field changes** (e.g. new key in
`colorSpaceResources` entries, new `solid` semantics, etc.). The
consumer's `EXPECTED_PATCH_VERSION` constant must be updated in
lockstep — the runtime check is your only safety net for semantic
drift.

Do NOT bump on a routine rebase that doesn't change observable
semantics.

## License

Apache 2.0, inherited from upstream pdf.js. This is a modified fork.
See [`LICENSE`](./LICENSE).

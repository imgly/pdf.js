# `@imgly/pdfjs-dist` — fork of mozilla/pdf.js

This repository is a fork of [mozilla/pdf.js](https://github.com/mozilla/pdf.js)
maintained by IMG.LY. It exposes importer-facing page metadata, raw JPEG image
semantics, and PDF output intents that
[`@imgly/pdf-importer`](https://www.npmjs.com/package/@imgly/pdf-importer)
needs and that upstream pdf.js does not expose.

The build output is published to npm as
[`@imgly/pdfjs-dist`](https://www.npmjs.com/package/@imgly/pdfjs-dist).

For upstream documentation see [`README.upstream.md`](./README.upstream.md).

## What the patches do

The fork patches on each release branch (`imgly/v<upstream>`) provide:

1. **`src/display/api.js`** — add `PDFPageProxy.trimBox`, `bleedBox`,
   `colorSpaceResources`, `imglyPatchVersion`, plus the document-level
   `PDFDocumentProxy.getOutputIntents()` API.
2. **`src/core/evaluator.js`** — track `fillColorSpaceKey` and
   `strokeColorSpaceKey` in the operator walker; preserve raw CMYK args
   instead of converting to RGB; emit Separation/DeviceN args with the
   resource key appended so the consumer can resolve the ink name.
3. **`src/core/document.js`** — add `Page.trimBox`, `bleedBox`, and
   `colorSpaceResources` getters. The last one walks `/ColorSpace` and
   evaluates each Separation/DeviceN tint=1 against its alternate space
   via `PDFFunctionFactory`, returning a flat JSON-safe descriptor.
4. **`src/core/raw_image.js` and `src/core/evaluator.js`** — expose opt-in,
   structured-cloneable raw DCT image descriptors with native-pass-through
   eligibility and fallback diagnostics. See
   [`docs/contents/api/raw-images.md`](./docs/contents/api/raw-images.md).
5. **`src/core/catalog.js` and `src/core/worker.js`** — resolve
   `/OutputIntents` and `/DestOutputProfile` across the worker boundary,
   preferring `GTS_PDFX`. See
   [`docs/contents/api/output-intents.md`](./docs/contents/api/output-intents.md).
6. **`src/core/worker.js`** — forward the three new page fields plus
   `imglyPatchVersion: 3` in `WorkerMessageHandler.GetPage`.

The version marker (`imglyPatchVersion`) is read by `@imgly/pdf-importer`
at parse time. If it's missing or out of date the importer fails fast
with a loud error rather than producing silently degraded output.

## Repository layout

- `master` — mirror of upstream `mozilla/pdf.js`.
- `imgly/v<upstream>` — release branch. Branched off the upstream tag
  `v<upstream>` with the IMG.LY patches replayed on top.
- `scripts/check-patches.sh` — minimal grep guardrail; run after every
  rebase to confirm the patched markers still exist in source.

## Per-release runbook

Publishing runs through [`publish_release.yml`](./.github/workflows/publish_release.yml).
The workflow builds and checks the distribution, then publishes it to npm
through trusted publishing. Developers do not need personal npm publish access.

### One-time setup

A maintainer of [`@imgly/pdfjs-dist`](https://www.npmjs.com/package/@imgly/pdfjs-dist)
must configure an npm trusted publisher for GitHub organization `imgly`,
repository `pdf.js`, workflow `publish_release.yml`, and environment
`npm-publish`. Allow direct `npm publish`. A GitHub repository administrator
must configure the `npm-publish` environment with required reviewers
and allow only tags matching `imgly/v*-r*` before enabling npm trust.
Protect the release branches and tags with GitHub rulesets. The workflow
cannot publish until the npm trust is configured.

### Prepare a release

For a new upstream pdf.js version, fetch its tag and replay the complete set
of IMG.LY commits from the previous release branch. For example:

```sh
git fetch upstream --tags
git checkout -b imgly/v<NEW> v<NEW>
git cherry-pick v<OLD>..imgly/v<OLD>
# Resolve conflicts, then review and test the patched APIs.
./scripts/check-patches.sh
```

The range `v<OLD>..imgly/v<OLD>` includes the first IMG.LY commit after
the upstream tag. When updating the existing upstream version, apply the
fixes to its current `imgly/v<upstream>` branch instead.

After the branch changes have been reviewed and merged, create a GitHub
Release whose tag points to the **current tip** of that release branch.
Use `imgly/v<upstream>-r<revision>` as the tag, for example
`imgly/v4.10.38-r3` for npm version `4.10.38-imgly.3`. Start a new
upstream version at revision 1; increase the revision for each later
publication on the same upstream version. The tag must not start with
`v`, which the local build reserves for upstream version tags.

The workflow checks that the tag points to the matching release branch tip,
runs the fork checks and tests, builds `build/dist`, and verifies its
name and version before publishing. It fails if the tag or built package
does not match the expected version. `IMGLY_UPSTREAM_VERSION` and
`IMGLY_PATCH_REVISION` are set by the workflow from the release tag;
local builds still derive the upstream version from a reachable upstream
tag when no override is set.

Then in the `@imgly/pdf-importer` consumer: bump the
`@imgly/pdfjs-dist` dependency, update `REQUIRED_PATCH_VERSION` if
the patched API contract changed, and run the regression suite. The npm
revision and `imglyPatchVersion` are separate values.

## When to bump `imglyPatchVersion`

Bump the integer (currently `3` in `src/core/worker.js`) **whenever the
shape of any patched field changes** (e.g. new key in
`colorSpaceResources` entries, new `solid` semantics, etc.). The
consumer's `REQUIRED_PATCH_VERSION` constant must be updated in
lockstep — the runtime check is your only safety net for semantic
drift.

Do NOT bump on a routine rebase that doesn't change observable
semantics.

## License

Apache 2.0, inherited from upstream pdf.js. This is a modified fork.
See [`LICENSE`](./LICENSE).

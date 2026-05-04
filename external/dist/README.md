# `@imgly/pdfjs-dist`

This is the IMG.LY fork of [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist),
the npm distribution of [Mozilla's pdf.js](https://github.com/mozilla/pdf.js).

It exists to surface a small set of additional fields on `PDFPageProxy`
(page boxes, Separation/DeviceN color spaces, raw CMYK fills) that
[`@imgly/pdf-importer`](https://www.npmjs.com/package/@imgly/pdf-importer)
needs and that upstream pdf.js does not expose.

The patch surface is intentionally narrow: only `src/display/api.js`,
`src/core/evaluator.js`, `src/core/document.js`, and `src/core/worker.js`
are modified. Public, non-patched APIs match upstream `pdfjs-dist` of
the same upstream version exactly.

## Versioning

Versions follow `<upstream>-imgly.<rev>`, e.g. `4.10.38-imgly.1`. Pin
exactly — semver caret (`^`) does not select prerelease versions, so
`^4.10.38-imgly.1` would silently fall through to upstream `pdfjs-dist`.

## When NOT to depend on this

If you do not consume `@imgly/pdf-importer` or do not need the
fork-only API surface (`PDFPageProxy.trimBox`, `bleedBox`,
`colorSpaceResources`, `imglyPatchVersion`), use upstream
[`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) instead.

## Source, contributing, fork maintenance

- Fork repo: <https://github.com/imgly/pdf.js>
- Upstream: <https://github.com/mozilla/pdf.js>
- Per-release runbook: see the fork's `README.md`.

This package is published from the fork's `imgly/v<upstream>` release
branch via `npx gulp dist`. We do not accept external contributions to
the fork; report bugs in the underlying behavior to upstream pdf.js,
and bugs in the fork-specific patches via
<https://github.com/imgly/pdf.js/issues>.

## License

Apache-2.0, inherited from upstream pdf.js. This is a modified fork.

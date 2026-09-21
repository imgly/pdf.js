# Raw PDF image data (fork extension)

Pass `exposeRawImageData: true` to `getDocument` to request raw image metadata.
The option is off by default because it copies JPEG streams across the worker
boundary. After `page.getOperatorList()`, each resolved image object in
`page.objs` or `page.commonObjs` has a `rawImage` property. Inline images carry
the same property directly in the `paintInlineImageXObject` argument.

`rawImage.version` is `1`. Check `rawImage.eligible === true` before using
`rawImage.data` as a JPEG stream. The data is a `Uint8Array` of the original
decrypted DCT stream bytes; it has not been color converted or rasterized.
The record also contains `width`, `height`, `bitsPerComponent`, `filter` (an
array of PDF filter names), `decodeParms.colorTransform`, `colorSpace`,
`decode`, and `interpolate`. `colorSpace` is either a device color space name
or `{ name: "ICCBased", n, profile }`, where `profile` is the decoded ICC
profile as a `Uint8Array`.

`mask` reports a color-key range array or an image mask, `softMask` reports an
image soft mask, and `matte` contains the soft-mask matte array. Any image with
one of these features is ineligible; the importer must use pdf.js's rasterized
image object. An ineligible record has `eligible: false`, a `reason`, and
`data: null`. The predicate currently accepts only a single DCT filter, 8-bit
samples, and DeviceGray, DeviceRGB, DeviceCMYK, or valid ICCBased spaces with
1, 3, or 4 components. It rejects malformed `/N` values, ICC header mismatches,
alternate-color-space fallbacks, and tint spaces such as Separation and DeviceN.
These spaces cannot be relabeled as CMYK: Separation samples contain one tint
channel even when their alternate space is CMYK.

The caller must apply PDF `/Decode` and DCT `/ColorTransform` semantics after
decoding, and must retain `colorSpace.profile` for color managed output. The
`eligible` flag means the required inputs are present, not that a generic JPEG
decoder automatically implements those PDF semantics.

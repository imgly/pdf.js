# Raw PDF image data (fork extension)

Pass `exposeRawImageData: true` to `getDocument` to request raw image metadata.
The option is off by default because it copies JPEG streams across the worker
boundary. After `page.getOperatorList()`, each resolved image object in
`page.objs` or `page.commonObjs` has a `rawImage` property. Inline images carry
the same property directly in the `paintInlineImageXObject` argument.

`rawImage.version` is `1`. Check `rawImage.eligible === true` before using
`rawImage.bytes` as a JPEG stream. The bytes are a `Uint8Array` of the original
decrypted DCT stream; they have not been color converted or rasterized.

Every record contains `width`, `height`, `bitsPerComponent`, `filters`, full
`decodeParms` entries, `decode`, `interpolate`, `sourceColorSpace`,
`effectiveColorSpace`, `mask`, `softMask`, and `matte`. All values are safe to
pass across a worker boundary. `sourceColorSpace` preserves the declared PDF
space, while `effectiveColorSpace` includes resource and DefaultGray/DefaultRGB/
DefaultCMYK resolution. Device spaces use `{ kind, components }`; ICCBased
spaces additionally contain the decoded `profile` bytes.

`mask` distinguishes color-key ranges from image masks. `softMask` reports
either an image descriptor or transparency-group metadata. Any mask, soft mask,
or matte makes the image ineligible, so the importer must use pdf.js's
rasterized image object. An ineligible record retains metadata, has
`eligible: false`, `bytes: null`, and a stable `reason`.
Image soft-mask descriptors preserve their `/Matte` in `softMask.matte`;
this value is also exposed in the parent record's `matte` field.

The native path accepts only one DCT filter, 8-bit samples, and DeviceGray,
DeviceRGB, DeviceCMYK, or valid ICCBased spaces with 1, 3, or 4 components. It
rejects malformed decode data and ICC profiles, and tint spaces such as
Separation and DeviceN. Separation samples contain tint channels even when
their alternate space is CMYK, so they cannot be relabeled as CMYK.

The caller must apply PDF `/Decode` and DCT `/ColorTransform` semantics after
decoding. `eligible` means that the necessary PDF inputs are present; it does
not mean that every JPEG decoder implements those semantics.

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

`mask` distinguishes color-key ranges from image masks. A DCT image with a
color-key or image `/Mask` remains eligible and retains its JPEG bytes; the
caller must apply the mask to reproduce transparency.
`softMask` reports either an image descriptor or transparency-group metadata.
A DCT image with a plain image `/SMask` remains eligible and retains its JPEG
bytes; the caller must apply the soft mask to reproduce transparency. Mask
descriptors include raw bytes when the mask stream itself uses DCT; for other
filters, the caller can use the alpha in pdf.js's rasterized image object. An
unsupported mask, unsupported soft-mask form, or top-level `/Matte` keeps the
image ineligible.
An ineligible record retains metadata, has `eligible: false`, `bytes: null`,
and a stable `reason`.
Image soft-mask descriptors preserve their `/Matte` in `softMask.matte`;
this value is also exposed in the parent record's `matte` field.

A standalone `/ImageMask true` stencil takes a separate rendering path. Its
image object (or the `paintImageMaskXObject` argument in a Type 3 font) has a
`rawImage` record with `reason: "IMAGE_MASK"` and
`eligible: false`, since its data is not a JPEG color image. The
`rawImage.imageMask.decodedBytes` field contains a copy of the decoded, packed
one-bit samples before applying `/Decode`, with rows of `Math.ceil(width / 8)`
bytes. The descriptor also contains dimensions, filters, decode parameters,
and `/Decode`. Painting those samples requires the current nonstroking color.

The native path accepts only one DCT filter, 8-bit samples, and DeviceGray,
DeviceRGB, DeviceCMYK, or valid ICCBased spaces with 1, 3, or 4 components. It
rejects malformed decode data and ICC profiles, and tint spaces such as
Separation and DeviceN. Separation samples contain tint channels even when
their alternate space is CMYK, so they cannot be relabeled as CMYK.

The caller must apply PDF `/Decode` and DCT `/ColorTransform` semantics after
decoding. `eligible` means that the necessary PDF inputs are present; it does
not mean that every JPEG decoder implements those semantics.

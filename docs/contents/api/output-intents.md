# PDF output intents (fork extension)

Use `await pdf.getOutputIntents()` to read the document-level `/OutputIntents`
array before importing page content. The method resolves indirect objects and
returns only worker-boundary-safe values:

```js
const { intents, selected } = await pdf.getOutputIntents();
```

Each entry has `subtype`, `outputCondition`, `outputConditionIdentifier`,
`registryName`, `info`, and `profile`. `profile` is either a `Uint8Array` of a
valid decoded `/DestOutputProfile` ICC stream, or `null` when the profile is
missing, malformed, or declares an unsupported component count. An absent
`/OutputIntents` array returns `{ intents: [], selected: null }`.

`selected` prefers an intent whose subtype is `GTS_PDFX`; otherwise it is the
first validly parsed intent. This selection is document-level and never infers
a profile from an image ICC profile or a DefaultCMYK resource.

Output intents are destination profiles. They are distinct from the
object-level image profile published in `rawImage.sourceColorSpace.profile`.

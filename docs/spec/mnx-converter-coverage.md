# MNX / MusicXML Converter Coverage

Status snapshot of how Viritura's MNX parser/serializer and MusicXML → MNX
converter cover MNX schema version 34, including remaining import and
editor-integration gaps.

> **Package layout note.** The MusicXML converter lives in
> [`packages/musicxml/src/convert/`](../../packages/musicxml/src/convert/) —
> the legacy single-file `convert.ts` has been split per concern. References
> in this document point at the new folder.

---

## ✅ Shipped

### MNX parser / serializer (`packages/format`)

| Area                                     | Where                                                                                                | Notes                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Diagnostic infrastructure                | [`packages/format/src/mnx/diagnostics.ts`](../../packages/format/src/mnx/diagnostics.ts)             | `MnxDiagnostic`, `DiagnosticCollector`, RFC 6901 `ptr` / `ptrChild`, severities.                                                                                                                                   |
| `parseMnxWithDiagnostics()`              | [`packages/format/src/mnx/parser.ts`](../../packages/format/src/mnx/parser.ts)                       | Returns `{ score, diagnostics }`. Warns on missing top-level keys + non-numeric `mnx.version`.                                                                                                                     |
| Public diagnostics API                   | [`packages/format/src/index.ts`](../../packages/format/src/index.ts)                                 | Exports `MnxDiagnostic`, `DiagnosticSeverity`, `DiagnosticCollector`, `mnxPointer`, `mnxPointerChild`, `ParseMnxOptions`, `ParseMnxResult`.                                                                        |
| Pluggable schema validation              | [`packages/format/src/mnx/parser.ts`](../../packages/format/src/mnx/parser.ts)                       | `ParseMnxOptions.validate?: (json) => Issue[]` — caller supplies any validator (e.g. Ajv2020); each issue becomes a `"schema-validation"` diagnostic. Keeps `format` dependency-free.                              |
| `mnx.support` consistency check          | [`packages/format/src/mnx/parser.ts`](../../packages/format/src/mnx/parser.ts)                       | Info diagnostic when `useBeams === true` but no beams exist, or `useAccidentalDisplay === true` but no `accidentalDisplay`.                                                                                        |
| Unknown-field scanner                    | [`packages/format/src/mnx/parser.ts`](../../packages/format/src/mnx/parser.ts) (`scanUnknownFields`) | Walks parsed JSON against per-node-type whitelists, emits `unknown-field` info diagnostics for non-vendor (`_x`/`_c`) keys dropped. Tests: [`parser.test.ts`](../../packages/format/src/__tests__/parser.test.ts). |
| Precise `AccidentalDisplay` emit         | [`packages/format/src/mnx/serializer.ts`](../../packages/format/src/mnx/serializer.ts)               | Emits explicit `{ show, force?, enclosure: { symbol } }`.                                                                                                                                                          |
| Serializer skips `stemDirection: "auto"` | [`packages/format/src/mnx/serializer.ts`](../../packages/format/src/mnx/serializer.ts)               | MNX schema only allows `up \| down`; `auto` is Viritura's internal sentinel.                                                                                                                                       |

### MusicXML → MNX converter (`packages/musicxml`)

**Layout.** All converter logic lives in `packages/musicxml/src/convert/` per
concern: `convertMusicXmlToMnx.ts` (entrypoint), `diagnostics.ts`,
`globalMeasures.ts`, `idGenerator.ts`, `layout.ts`, `measureNotes.ts`,
`metadata.ts`, `notes.ts`, `parts.ts`, `partsInfo.ts`, `pitchDuration.ts`.

**Features attached to native MNX output:**

- Notes (pitch, octave, alter), rests, chords, grace notes, dotted notes, accidental display
- Multiple voices, ties (with IDs and `side`; `<tied placement>` → `tie.side`; `<tied type="let-ring">` → `tie.lv`), articulations (full SMuFL-aware mapping table)
- Fermatas, bow directions, and single-note and multi-note tremolos
- Non-arpeggiate chord brackets
- Time / key signatures, clefs, transposing instruments (`_x.viritura.transpose`)
- Dynamics, barlines (final, double, repeat, dotted, dashed, tick, short), repeat markers
- Tuplets (`<time-modification>` + `<tuplet>`; `<tuplet show-number/show-type>` → `showNumber/showValue`; nested tuplets)
- Slurs (start/stop with overlapping `number`, `side` up/down, target ids)
- Lyrics (syllabic start/middle/end/whole; `<elision>` concatenation)
- Tempo (`<metronome>` and `<sound tempo>` with mid-measure `location.fraction` positioning)
- Volta endings (multi-number support, duration post-processing for start→stop range, `discontinue` → `open: true`)
- Navigation: segno (with SMuFL `glyph`), fine, jumps (`dacapo` / `dalsegno`)
- MusicXML colors on keys, clefs, volta endings, grace groups, and segnos
- Beam grouping (per voice / level), ottava lines, multi-staff parts (grand staff with brace grouping)
- `<stem>up\|down</stem>` → `event.stemDirection`
- Score metadata (`<work>`, `<movement-title/number>`, `<identification>` creators, `<credit>` title/subtitle)

**Features attached as `_x.viritura` vendor extensions** (no MNX-native equivalent yet):

- Trills, mordents, turn variants, caesuras, event-level arpeggios, and fingerings
- Rehearsal marks, text `<words>` directions, and pedal markings
- Score metadata (title, creators, work, and movement details)
- Glissando/slide spans, common chord symbols, and coda markers

**Diagnostics:**

- `ConvertOptions.diagnostics?: DiagnosticCollector` on the entrypoint.
- Post-conversion scan emits one entry per dropped construct (figured bass, bend, stem `none` / `double`, unsupported chord kinds, and extension-backed features when extensions are off).
- Generic `DiagnosticCollector` lives in [`packages/core/src/diagnostics.ts`](../../packages/core/src/diagnostics.ts) so `format` and `musicxml` share the type without a new dep edge.

**Test coverage:** ~62 tests in [`packages/musicxml/src/__tests__/convert.test.ts`](../../packages/musicxml/src/__tests__/convert.test.ts) covering every feature area above via inline-generated XML fixtures.

### Public converter UI (`apps/website/src/routes/mnx-converter/`)

Lazy-loaded and prerendered route at `/mnx/mxl-converter` on the website. Components:

- `MusicXmlConverterPage.tsx` — page shell
- `useConverterFiles.ts` — per-file state machine (idle → converting → success/error), single + bulk download
- `DropZone` (in `converterSections.tsx`) — drag-drop + `<input type="file">` filtered to `.musicxml/.xml/.mxl`
- `MonacoMnxViewer.tsx` + `MnxPreview.tsx` — Monaco JSON viewer
- `ValidationPanel.tsx` — schema validation against MNX 1.x JSON Schema (validator passed via `ParseMnxOptions.validate`)
- `ImportDiagnosticsPanel.tsx` — DiagnosticCollector output bucketed by severity with badge counts
- `UnsupportedFeaturesPanel.tsx` — distinguishes standard MNX, optional Viritura-extension, and lossy mappings
- `preloadWasmEngine.ts` — warms the WASM engine for the renderer preview

Build / deploy: the website prerender catalog writes
`dist/mnx/mxl-converter/index.html`; the former `/mnx-converter` URL is not
generated and returns 404 in `deploy/nginx-viritura.com.conf`.

### Already-verified-working MNX features (no further work needed)

- Volta `numbers[]` + `open` (model, parser, serializer, MusicXML extractor)
- Native event-level fermata model + articulation `orient` + bow direction outside-staff pass
- `mnx.support` honored by engine (`use_beams`, `use_accidental_display` — see [`test_support_flags.rs`](../../engine/viritura-engine/src/layout/tests/test_support_flags.rs))
- Group barline overrides (`LayoutGroup.barline_style` round-trips)
- `keyFifthsFlipAt` for enharmonic respelling of transposed keys (no MusicXML inverse exists)
- Two-note tremolo `MultiNoteTremolo { marks, outer, individualDuration }`
- Lyric `syllabic` (`start | middle | end | whole`)
- Beam hook `direction: "auto"` (engraver auto-detects hook side) — fixture: [`beam-hooks-auto.mnx`](../../packages/format/fixtures/mnx/beam-hooks-auto.mnx)

---

## 🟡 In-flight / partial

### Editor import integration

- **Shipped:** Start Center upload and **File ▸ Import…** accept `.mxl`,
  `.musicxml`, and `.xml`, collect conversion diagnostics, and enter the normal
  file-open path.
- **Remaining:** extend the editor canvas drop handler to accept those formats;
  it currently accepts only `.mnx` and `.json`.
- **Remaining:** expose a direct **Save as Project** handoff after standalone
  MusicXML import. Viritura remains MNX-native and does not retain the original
  MusicXML file.

### Stem direction `none` (stemless) and `double`

- **Today:** MusicXML converter reads `<stem>up|down</stem>`. `<stem>none</stem>` and `<stem>double</stem>` are dropped silently with a diagnostic.
- **MNX gap:** MNX defines only `up | down`. Needs an `_x.viritura` extension (or an upstream MNX issue).
- **Path forward:** Add `_x.viritura.stem = "none" | "double"` on the event during MusicXML import; teach the engine to suppress / mirror the stem on render.

### MusicXML → `keyFifthsFlipAt`

- **Today:** Round-trips through MNX. MusicXML import never sets the field — no native MusicXML equivalent.
- **Path forward:** Track upstream; not blocking.

### Whitelist drift in `scanUnknownFields`

- **Today:** Per-node-type whitelists in `parser.ts` are hand-curated from `mnx-schema.json`.
- **Risk:** Real fields will start producing spurious `unknown-field` diagnostics the next time MNX adds a property.
- **Path forward:** Codegen the whitelists from `mnx-schema.json`'s `$defs` (one Set per `$def` whose `unevaluatedProperties: false` shape lists `properties`).

### Real-world fixture tests

- **Today:** Test coverage uses synthetic XML strings built inline.
- **Gap:** Useful next step is a `__tests__/fixtures/` folder with representative `.musicxml` exports from several widely used notation applications. Snapshot the converter's JSON + diagnostics for each. This is the most reliable way to catch exporter-specific quirks.

### Remaining harmony and style detail

- **Today:** Common chord qualities, extensions, alterations, slash bass, and rhythmic positions import as Viritura chord-symbol extensions.
- **Remaining:** MusicXML degree alterations, fretboard frames, and kinds outside Viritura's chord-quality model emit a diagnostic instead of being approximated.
- **Today:** Colors import where the current engine renders a matching MNX or Viritura field: keys, clefs, volta endings, grace groups, segnos, and codas.
- **Remaining:** Per-element font attributes and colors on unsupported notation objects are not imported.

---

## 🔴 Not started — recommended pickups

### Recently completed

- **Unpitched percussion / `part.kit`** — percussion-clef parts convert to
  standard MNX kit components, global sounds, and kit notes. Recognized
  MusicXML `instrument-sound` values map directly; staff-position heuristics
  trigger sequential interactive **Percussion Map** review in the editor.

### High value, low cost

1. **Multi-source layout staves** — MNX `layout.staves[].sources` lets one staff render content from two parts. Model already accepts `sources: [...]`, the engine ships the basic merge analysis (see [`condensing-and-doubling.md`](./condensing-and-doubling.md)), but the MusicXML converter doesn't auto-detect a condensed staff and leaves them as separate parts.
2. **`stemDirection` on note vs event** — MNX 1.5 allows per-note stem overrides for split-stem chords. Today we only honor event-level stems.

### Lower priority / out of scope

| #    | Feature                              | Why deferred                                                |
| ---- | ------------------------------------ | ----------------------------------------------------------- |
| 2.7  | Ottava grace/voice targets           | Out of scope for v1; spec ambiguous.                        |
| 2.10 | Written-pitch enharmonic delta       | Transposition layer not yet present.                        |
| 2.12 | Cross-staff `event.staff`            | Engine cross-staff incomplete; revisit with §2.3.           |
| 2.14 | Cross-jump grace runs                | Niche; depends on §2.11 `tie.cross-jump`.                   |
| 2.20 | Global-measure (end-barline) fermata | Superseded by event-level fermata model.                    |
| 2.21 | Breath-marks legacy behavior         | Bug-for-bug compatibility; not desirable.                   |
| 2.25 | MNX-spec TODOs (mensurstrich, etc.)  | Track upstream MNX issues; nothing to implement until then. |

---

## References

- MNX spec: `../mnx-spec/`
- Vendor extensions index: [`docs/spec/viritura-extensions.md`](./viritura-extensions.md)
- Broader MNX coverage gaps: [`docs/spec/mnx-coverage.md`](./mnx-coverage.md)

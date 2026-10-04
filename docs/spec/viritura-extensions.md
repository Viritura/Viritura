# Viritura MNX Vendor Extensions Reference

Viritura extends the [MNX specification](https://mnx.formats.music/docs/) using the standard `_x` vendor extension mechanism defined in MNX's [global attributes](https://mnx.formats.music/docs/mnx-reference/objects/global-attrs/). All Viritura extensions live under the `"viritura"` vendor key.

> **Why `_x`?** MNX objects set `unevaluatedProperties: false`, which means adding custom top-level properties fails schema validation. The `_x` vendor dict is the only spec-sanctioned way to extend MNX objects.

> Dynamics are standard MNX `dynamic-group` objects — hairpins are gradual
> groups and dynamic-attached text uses standard `prefix`/`suffix`. Viritura
> adds only engraving placement under each group's `_x.viritura` dict; see
> [dynamics.md](dynamics.md).

## Quick Reference

| MNX Object                                   | JSON Path                                       | Extensions                                                                                                            |
| -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [score (root)](#score-root-extensions)       | `_x.viritura`                                   | metadata, textStyles, chordSymbolStyle, timeSignatures, instrumentChangeStyle, soundProfile, videoSync, lyricWorkflow |
| score definition                             | `scores[]._x.viritura`                          | pageSetup, instrumentNameDisplay, layoutBreaks, textFrames                                                            |
| [source part](#source-part-extensions)       | `parts[]._x.viritura`                           | instrumentId, midiProgram, family, spatial, chordSymbolVisibility, instruments, initialInstrument                     |
| [measure-global](#global-measure-extensions) | `global.measures[]._x.viritura`                 | rehearsalMark, coda, jump variants not in MNX, markerText, chordSymbols                                               |
| [time signature](#time-signature-extensions) | `global.measures[].time._x.viritura`            | beatStructure, groupingDisplay, display                                                                               |
| [part-measure](#part-measure-extensions)     | `parts[].measures[]._x.viritura`                | pedals, expressions, condensingOverride, groupingDisplayOverrides, staffMeters, instrumentChanges                     |
| positioned staff configuration               | `parts[].measures[].staffConfigs[]._x.viritura` | staffLineRangeRestore                                                                                                 |
| [dynamic-group](#dynamic-group-extensions)   | `parts[].measures[].dynamics[]._x.viritura`     | manualOffset, avoidCollisions                                                                                         |
| [event-markings](#event-markings-extensions) | `...content[].markings._x.viritura`             | staccatissimoWedge, trill, ornaments, fingerings, arpeggiate                                                          |
| [event](#event-extensions)                   | `...content[]._x.viritura`                      | glissandos                                                                                                            |
| [tuplet](#cross-barline-tuplet-fragments)    | `...content[]._x.viritura`                      | span                                                                                                                  |
| [slur](#slur-extensions)                     | `...content[].slurs[]._x.viritura`              | shape                                                                                                                 |
| [kit-component](#kit-component-extensions)   | `parts[].kit[]._x.viritura`                     | notehead                                                                                                              |

**Schema**: [`packages/format/schemas/viritura-extensions.json`](../packages/format/schemas/viritura-extensions.json)

## Time Signature Extensions

Extensions on an MNX `time` object. Schema def: `time-extensions`.

### `beatStructure`

An ordered array of positive integers describing the meter's beat groups in
units of `time.unit`. The values must sum to `time.count`.

```json
{
  "time": {
    "count": 9,
    "unit": 8,
    "_x": {
      "viritura": {
        "beatStructure": [2, 3, 2, 2]
      }
    }
  }
}
```

This example remains a 9/8 measure but establishes beat boundaries after 2,
5, and 7 eighth notes. Automatic beaming consumes these boundaries. The
extension records metric meaning only — `groupingDisplay` below and the
house-style `nonDefaultGroupingDisplay` control how (or whether) that
grouping is shown. When omitted, Viritura resolves a conventional structure
for the meter. When present, the authored structure is interpreted
literally, even if its values match the meter's conventional beat structure.

### `groupingDisplay`

Explicit per-occurrence override of how this time signature's beat grouping
is presented. One of `standard`, `additive`, or `annotation` (see
[Grouping Display](#grouping-display) below). Forces the named mode
regardless of the document's house style — subject only to the safety
fallback that keeps a symbolic display (`common`/`cut`/`senzaMisura`/`note`)
or a single-group structure engraving as `standard` even when forced.

```json
{
  "time": {
    "count": 7,
    "unit": 8,
    "_x": {
      "viritura": {
        "beatStructure": [3, 2, 2],
        "groupingDisplay": "annotation"
      }
    }
  }
}
```

### `display`

Set to `note` to engrave the denominator as its note value instead of a
numeral. This presentation is stored in the time signature's vendor dictionary
because MNX currently standardizes only `common` and `cut` symbolic displays.

## Grouping Display

How a meter's beat grouping is _presented_ is independent of its semantic
`beatStructure`: automatic beaming always follows `beatStructure` (or the
conventional default), while `groupingDisplay` only controls what is drawn.
Schema def: `grouping-display`.

| Value        | Effect                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `standard`   | Ordinary numeric (or symbolic) meter — no grouping decoration.                                                               |
| `additive`   | Numerator written as its beat groups joined by `+` (e.g. `3+2+2` over `8`), replacing the count.                             |
| `annotation` | Ordinary numeral engraved as usual, plus generated bold system text (e.g. `3+2+2`) above it in the style of a tempo marking. |

Resolution precedence, highest first:

1. A per-staff occurrence override (`groupingDisplayOverrides` on the part
   measure — see [`groupingDisplayOverrides`](#groupingdisplayoverrides)).
2. The time signature's own occurrence override (`groupingDisplay` above).
3. The document's house style (`nonDefaultGroupingDisplay` under
   [`timeSignatures`](#timesignatures)) — applied **only** when the meter's
   resolved beat structure is structurally non-default for its count/unit.
   An ordinary 4/4 (or any meter whose authored structure merely duplicates
   the automatic default) always stays `standard` under the house style, so
   it never engraves `1+1+1+1`.
4. `standard`.

A symbolic display (`common`/`cut`/`senzaMisura`/`note`) or a resolved beat
structure of a single group has nothing for `additive`/`annotation` to show,
so both fall back to `standard` unconditionally — even under an explicit
occurrence or staff override.

## Cross-barline Tuplet Fragments

MNX tuplets are sequence-content containers and therefore cannot cross a
part-measure boundary. The upstream notationref matrix currently calls the
feature supported, but [MNX issue 173](https://github.com/w3c-cg/mnx/issues/173)
remains open and the sequencing rules require both tuplets and measures to end
at their declared durations. Viritura consequently stores each measure's notes
in a normal tuplet fragment and links the fragments with `_x.viritura.span`.

```json
{
  "type": "tuplet",
  "inner": { "duration": { "base": "eighth" }, "multiple": 3 },
  "outer": { "duration": { "base": "eighth" }, "multiple": 2 },
  "content": [{ "id": "note-a", "duration": { "base": "eighth" }, "rest": {} }],
  "_x": {
    "viritura": {
      "span": { "id": "cross-bar-triplet", "type": "start" }
    }
  }
}
```

Every logical span has at least a `start` and `stop` fragment. Intermediate
measures use `continue`. Fragments must occupy contiguous measures in the same
sequence and repeat identical ratio and display settings. Each fragment applies
the shared `outer / inner` timing ratio to its own content, so events remain
owned by the measure in which they appear. The renderer draws one number, joins
fragments to barlines, and uses the shared span ID for selection. Invalid or
incomplete chains fail semantic validation instead of being flattened.

This representation follows the practical distinction exposed by current
notation applications: Dorico models a native spanning tuplet and controls
cross-barline beaming separately, while Sibelius and MuseScore use split or
simulated measure-local tuplets. See the
[Dorico spanning-tuplet documentation](https://www.steinberg.help/r/dorico-se/6.1/en/dorico/topics/notation_reference/notation_reference_tuplets/notation_reference_tuplets_span_barline_allow_disallow_t.html),
[Sibelius plug-in documentation](https://www.sibelius.com/download/plugins/index.html?plugin=597),
and [MuseScore feature request](https://github.com/musescore/MuseScore/issues/19234).

## Score Definition Extensions

`_x.viritura` on an entry in `scores[]`. Schema def: `score-extensions`.

### `textFrames`

The currently supported page-positioned specialization of the shared text
container belongs to an individual score definition (a full-score
or part view), not to a staff or to a semantic expression. Each frame has a
stable ID and exactly one locator: a zero-based index into the final rendered
page array (`{ "type": "page", "pageIndex": 0 }`), a global measure ID
(`{ "type": "globalMeasure", "measureId": "m3" }`), or a part-scoped event ID
(`{ "type": "event", "partId": "P1", "eventId": "e3" }`). A musical locator's
page is resolved after pagination. Authored `scores[].pages` constrain
pagination but do not define independent physical coordinates; a page-index
locator refers to the resulting page whether those breaks were authored or
automatically generated. Reflow does not rewrite the stored page index. A
frame whose target is absent from the current layout remains authored but is
not drawn.

The locator determines **which page**. `placement.anchor` chooses an edge or
corner of that page's printable area inside its margins;
`placement.offset: { x, y }` translates the frame in staff spaces (+x right,
+y down). Required `width` is either
`{ "unit": "staffSpaces", "value": 24 }` (multiplied by the resolved score
spatium) or `{ "unit": "textColumnFraction", "value": 0.5 }` (half the
available printable text-column width). Optional `padding` is an interior
inset in staff spaces. Height grows with word-wrapped content; literal
newlines in `content` are authored breaks and must not be rewritten as
automatic wrapping changes. An unbreakable word wider than the text box
overflows horizontally rather than being split. `horizontalAlignment` positions the frame at
its page anchor independently of `paragraphJustification` within its text
box. Optional `border` is `none` or `solid`. The order of `textFrames` is
the paint/layer order, with later frames above earlier frames. These
first-slice frames neither reserve music space nor avoid collisions with
notation or one another.

Optional boolean `eraseBackground` requests erasure of underlying ink within
the frame rectangle, including padding, before painting the frame's border and
text. Omission or `false` preserves existing transparent behavior. The model
stores this intent only, not a background color. Canvas and vector exports mask
earlier ink rather than painting a white rectangle, leaving the actual paper
color, texture, or transparency intact. Later frames remain above earlier ones.
This does not change collision avoidance or reserve musical space.

Create frames in **Write > Palettes > Text**: choose a page number and
**Add page frame**, or select music and add a frame following that measure/event's
page. The palette opens the new frame's text and presentation editor immediately.
**Engrave > Properties** edits existing frames; there is no dedicated text-frame
tab or creation action in Engrave. Selecting a painted frame opens its Properties.
The existing-frame list also exposes frames whose targets are unplaced.

Horizon mode has no pages and therefore does not paint page-relative frames.
The editing UI exposes hidden frames near their measure/event locator and
provides a document-level list for frames located by page index. A musical
locator does not turn a page-relative frame into staff-attached or
system-attached semantic text; implementation of those attachment kinds is tracked in
[issue #282](https://github.com/Viritura/Viritura/issues/282).

#### Shared text model and scope boundary

The in-memory model separates `TextBlock` (shared `TextContent` plus optional
`TextFramePresentation`) from `TextFrame` (its page-positioned specialization).
Presentation includes optional width, block alignment, paragraph justification,
padding, border, and `eraseBackground` intent. A plain annotation and a bordered instruction box should
use the same attachment model, differing only in these optional settings.
Border and padding do not confer staff/system scope or imply music-space
reservation.

`TextFrame` still requires width, ID, locator, and page placement. This type
extraction does not change its JSON shape, defaults, ownership, or rendering.
`TextBlock` is a reusable in-memory contract, not a new persisted object or an
additional supported attachment kind. Existing staff expressions support this
presentation through their optional `frame` property, retaining their musical
attachment. System-text scope and part propagation remain in #282.

The shared design distinguishes attachment/scope from placement:

| Kind                   | Attachment determines                   | Geometry relative to            |
| ---------------------- | --------------------------------------- | ------------------------------- |
| Page text              | Explicit rendered page                  | Printable page area             |
| Music-linked page text | Page holding a measure/event            | Printable page area             |
| Staff text (planned)   | Musical location and a particular staff | Musical location on that staff  |
| System text (planned)  | Musical location with system-wide scope | Musical location on that system |

Music-relative text must remain available in Horizon and follow its musical
attachment through reflow. System text needs explicit projection into score
and part views rather than copied independent per-view frames. These ownership,
visibility, and placement rules belong to #282; no unsupported locator or
staff/system discriminator is accepted by the current frame schema.

Width omission and alignment defaults belong to the owning text role, not to
the shared container. The current `textColumnFraction` reference is the page's
printable column; its applicability to music-relative text must be settled
before that attachment is implemented. Likewise, page offsets retain +y down,
while existing staff expressions retain their +y up engraving convention.
Sharing presentation must not silently change either convention.

Specialized tempo and dynamics retain their musical semantics even when they
reuse text presentation. Collision avoidance and automatic space reservation
are a separate layout concern and remain outside the floating-frame slice.

MUSX/Denigma mapping follows in a separate adapter change when representative
source payloads and units are available. Optional `sourceReference` retains a
source `unit` and `referenceStaffSize` for loss-aware conversion. Finale
page-text assignments may span page ranges, select odd/even pages, or have
different offsets on right pages; those semantics and arbitrary source
frame shapes are **not** native to this first slice. An importer must
diagnose unsupported geometry or formatting instead of flattening it
silently.

### `layoutBreaks`

Stores forced starts within otherwise automatic layout flow. Each entry names
the measure that must begin a new `system` or `page`; a page start also implies
a system start. Measures before, between, and after entries continue to use
automatic casting and pagination.

```json
{
  "_x": {
    "viritura": {
      "layoutBreaks": [
        { "measure": "m17", "kind": "system" },
        { "measure": "m41", "kind": "page" }
      ]
    }
  }
}
```

### `instrumentNameDisplay`

Controls instrument names independently on the first and subsequent systems.
Both `firstSystem` and `subsequentSystems` accept `full`, `short`, or `hidden`.
The extension is omitted when standard MNX layout references can represent the
same policy directly: full-then-short, short-only, or hidden.

```json
{
  "name": "Full Score",
  "layout": "full-score",
  "_x": {
    "viritura": {
      "instrumentNameDisplay": {
        "firstSystem": "hidden",
        "subsequentSystems": "short"
      }
    }
  }
}
```

## Source Part Extensions

`_x.viritura` on an MNX source part (`parts[]`). Schema def: `part-extensions`.
Instrument identity and placement use `instrumentId`, `midiProgram` (0–127),
`family`, and `spatial` (`{ x, y }` in stage meters).

`instrumentId` is a [MusicXML standard sound ID](https://www.w3.org/2021/06/musicxml40/listings/sounds.xml/)
(for example `wind.reed.clarinet.bflat`, `brass.french-horn`,
`strings.contrabass`). Viritura uses the MusicXML hierarchy rather than a
private catalog so that identity survives MusicXML round-trips and consumers
can fall back by walking up the dotted hierarchy (`wind.reed.clarinet.bflat` →
`wind.reed.clarinet` → `wind.reed`) before falling back to `midiProgram` and
finally the part name. Pre-MusicXML Viritura catalog IDs (such as
`bflat-clarinet`) are not recognized.

### `instruments` and `initialInstrument` (provisional)

Provisional model for doubling within one player's part (flute ↔ piccolo,
oboe ↔ English horn, A ↔ B♭ clarinet, percussion instrument changes). MNX has
no instrument object yet (see [w3c-cg/mnx#466](https://github.com/w3c-cg/mnx/issues/466));
this extension prototypes one so Viritura can map to it if MNX adopts a
similar model.

- `instruments`: map from a document-local key to an `instrument-definition`:
  `instrumentId` (required MusicXML sound ID), optional `name`, `shortName`,
  `transposition` (same shape as MNX `part-transposition`), and `midiProgram`.
- `initialInstrument`: key of the instrument active at the start of the part.
  Required when `instruments` is present.

Native MNX fields keep describing the **initial** state so plain MNX readers
see a correct part: `part.name`, `part.shortName`, and `part.transposition`
should match the initial instrument, and `_x.viritura.instrumentId`, when
present, must equal its `instrumentId`. The validator rejects a mismatched
`instrumentId` or initial transposition. The part's `kit` stays part-level.

```json
{
  "id": "P1",
  "name": "Flute",
  "measures": [],
  "_x": {
    "viritura": {
      "instrumentId": "wind.flutes.flute",
      "initialInstrument": "fl",
      "instruments": {
        "fl": { "instrumentId": "wind.flutes.flute", "name": "Flute", "shortName": "Fl." },
        "picc": {
          "instrumentId": "wind.flutes.flute.piccolo",
          "name": "Piccolo",
          "shortName": "Picc.",
          "transposition": { "interval": { "halfSteps": -12, "staffDistance": -7 }, "prefersWrittenPitches": true }
        }
      }
    }
  }
}
```

See [`instrumentChanges`](#instrumentchanges-provisional) for switching
between them.

### `chordSymbolVisibility`

Controls projection of the single document-wide chord progression for this
source part:

- `auto` (or omitted): show the progression on the first displayed staff of the
  topmost displayed source part.
- `show`: show the progression on this source part's first displayed staff.
- `hide`: suppress the progression for this source part.

This policy persists wherever the source part appears. It is not a per-layout
or per-chord switch, and hiding the automatic topmost source does not promote
the next source to automatic placement. It does not mute chord playback.

The decoded TypeScript field is `Part.chordSymbolVisibility`; serialization
stores it under the source part's `_x.viritura`, not as a top-level MNX field.
Adding or pasting a chord sets affected source parts to `show`, overriding
previous `hide` and revealing the entire progression rather than only the new
event.

The editor exposes **Chord Symbols** → **Automatic**, **Show**, or **Hide** in
Setup and source-instrument visibility in chord Properties.

```json
{
  "id": "piano",
  "name": "Piano",
  "measures": [],
  "_x": {
    "viritura": {
      "chordSymbolVisibility": "show"
    }
  }
}
```

## Layout Staff Extensions

The `layout-staff-extensions` schema currently has no properties. Neither
`chordSymbolVisibility` nor `globalChordSymbolVisibility` is accepted on a
layout staff. Chord events also have no `displayStaff` property.

---

## Score Root Extensions

`_x.viritura` on the top-level score object. Schema def: `root-extensions`.

### `metadata`

Score-level bibliographic metadata (`score-metadata`). The engine consumes `title`, `subtitle`, `composer`, `arranger`, and `copyright`; the remaining fields are preserved verbatim from MusicXML import for round-tripping.

| Field            | Type   | Notes                                                      |
| ---------------- | ------ | ---------------------------------------------------------- |
| `title`          | string | Display title (movement title, falling back to work title) |
| `subtitle`       | string | Work subtitle                                              |
| `composer`       | string | Composer credit                                            |
| `lyricist`       | string | Lyricist credit                                            |
| `arranger`       | string | Arranger credit                                            |
| `copyright`      | string | Copyright notice                                           |
| `workTitle`      | string | MusicXML `work-title`                                      |
| `workNumber`     | string | MusicXML `work-number`                                     |
| `movementTitle`  | string | MusicXML `movement-title`                                  |
| `movementNumber` | string | MusicXML `movement-number`                                 |

### `textStyles`

Per-document text style overrides (`text-styles`), keyed by role. Each entry is a partial [`text-style`](#text-style) merged over the engine's built-in stylesheet at layout time — a document only stores the properties it changes, so adding style properties never requires a model migration.

Roles: `title`, `subtitle`, `composer`, `arranger`, `staffLabel`, `pageNumber`, `tempo`, `pedalText`.

#### `text-style`

| Field    | Type                                   | Notes                                             |
| -------- | -------------------------------------- | ------------------------------------------------- |
| `size`   | number                                 | Font size in staff spaces (spatium-relative), > 0 |
| `family` | `serif` \| `sans-serif` \| `monospace` | Generic font family                               |
| `bold`   | boolean                                | Bold weight                                       |
| `italic` | boolean                                | Italic/oblique slant                              |
| `color`  | string                                 | CSS hex triplet, e.g. `#000000`                   |
| `align`  | `left` \| `center` \| `right`          | Horizontal alignment relative to anchor           |

```json
{
  "_x": {
    "viritura": {
      "metadata": { "title": "Rhapsody in Blue", "composer": "George Gershwin" },
      "textStyles": {
        "tempo": { "family": "sans-serif", "size": 3.0 },
        "title": { "color": "#222222" }
      }
    }
  }
}
```

### Inline text content

Text on semantic score objects (currently text expressions, rehearsal marks,
tempo labels, and authored navigation-marker text) is an ordered array of text and
SMuFL-glyph chunks. There is
no plain-string form: even a single unstyled run is written as
`[{ "text": "dolce" }]`. Each chunk can carry inline text styling; glyph names
stay separate from Unicode text and private-use code points.

Documents written before this extension existed may still carry a bare string
in these positions. Readers widen such a string to a single-chunk array before
schema validation, so older files keep loading; writers always emit the array
form.

Inline `size` is a positive multiplier over the owning text role's resolved
size. It is a **relative** unit — the CSS `em` equivalent — not an absolute
point size, so score text keeps its proportion when the staff size changes.
Because each role's default is itself expressed in staff spaces (see
[`text-style`](#text-style)), an inline size ultimately resolves to staff
spaces. `font` selects one of `serif`, `sans-serif`, or `monospace`; omitted
style properties inherit from that role.

> Note the deliberate difference from [`text-style`](#text-style), where `size`
> is an absolute count of staff spaces for a whole role. Inline `size` scales
> a single run relative to whatever that role resolved to.

`decorations` is a set, not a single value: MusicXML carries `underline`,
`overline` and `line-through` as independent attributes, and Finale carries
underline and strikeout independently, so a run may need several at once.

```json
[{ "text": "con ", "style": { "fontStyle": "italic" } }, { "glyphs": ["dynamicMezzoForte"] }, { "text": " subito" }]
```

This Viritura representation is an implementation bridge, not a claim about
the final MNX text encoding. The ordered text/glyph/style content is kept
independent from its semantic owner, anchor, placement, and lifecycle. Text
frames with wrapping and geometry remain separate objects; measure- and
page-anchored text frames are not navigation-marker text. Serialization
adapters can map this content to the MNX representation once that proposal is
standardized.

#### Text size across formats

Font sizing is the least settled part of any text proposal, so the unit choice
above is deliberate rather than incidental.

| Format   | Unit                                                        | Staff-relative |
| -------- | ----------------------------------------------------------- | -------------- |
| MusicXML | absolute points, or one of seven CSS keywords               | no             |
| MNX      | undecided — the schema currently has no text styling at all | proposed       |
| Viritura | multiplier over the owning role's staff-space size          | yes            |

MusicXML's `font-size` is a union of `xs:decimal` (points) and `css-font-size`,
with no percentage or em option. It anchors positions and distances to the
staff through `tenths`/`<scaling>` but leaves text size absolute. That
asymmetry is why imported text size cannot be trusted without knowing the
source application's unscaled staff size.

MNX's active proposal ([w3c-cg/mnx discussion #459][mnx-459]) arrives at the
same flat chunk array used here, with a `style` dictionary that is explicitly
not CSS. Its most developed sizing proposal adds a document-level `staffSpace`
plus CSS-analogous relative units: `ssp` (resolves against the document staff
space, like `rem`) and `sp` (staff-scaled, like `em`), alongside literal `pt`
and `mm`. Nothing there is ratified — there is no schema entry and no editor
resolution — so Viritura stores a bare number and defers the unit tag. A future
adapter maps inline `size` to whichever relative unit MNX settles on.

[mnx-459]: https://github.com/w3c-cg/mnx/discussions/459

#### What importers carry

Both the MusicXML and MUSX/Finale readers import the unit-free part of run
formatting — bold, italic, the decoration set, enclosure, colour, and SMuFL
glyph runs — and deliberately import **neither `size` nor `font`**.

MusicXML has no recoverable staff-relative size at all: its `font-size` is
absolute and, unlike positions, is not scaled through `<scaling>`. Finale
_can_ express a size relative to the preceding run, so importing it would be
possible in isolation — but doing so would leave the same visual property with
two fidelity levels depending on the source format, and would bake in a unit
MNX has not yet chosen. Font family is omitted for the parallel reason: our
`font` is three generic keywords, so a named family cannot round-trip. Both
importers report the omission as a partial outcome rather than silently
approximating. When MNX ratifies a sizing unit, both readers gain it together.

### `chordSymbolStyle`

Score-wide chord-symbol engraving style. Omitted fields use Viritura's
conventional default: uppercase roots, `m` for minor, SMuFL triangle/circle/
slashed-circle/plus quality symbols, and superscript extensions.

| Field            | Values                        | Default       |
| ---------------- | ----------------------------- | ------------- |
| `rootCase`       | `uppercase`, `lowercaseMinor` | `uppercase`   |
| `majorSeventh`   | `triangle`, `maj`, `M`        | `triangle`    |
| `minor`          | `m`, `min`, `minus`, `none`   | `m`           |
| `diminished`     | `symbol`, `dim`               | `symbol`      |
| `halfDiminished` | `symbol`, `minorFlatFive`     | `symbol`      |
| `augmented`      | `plus`, `aug`                 | `plus`        |
| `extensions`     | `superscript`, `baseline`     | `superscript` |

The editor exposes these fields under **Engrave → House Style → Chord
Symbols**, with Conventional, Jazz symbols, Plain text, and Lowercase minor
presets.

### `timeSignatures`

Time signature settings (`time-signature-styles`) are chosen separately for
full scores and single-part layouts. Each side contains an orthogonal
`time-signature-settings` object; omitted fields use standard digits, one per
staff, vertically centered, at 1× scale.

| Field   | Type                      | Notes                                          |
| ------- | ------------------------- | ---------------------------------------------- |
| `score` | `time-signature-settings` | Settings used when engraving a full score      |
| `parts` | `time-signature-settings` | Settings used when engraving a one-part layout |

#### `time-signature-settings`

| Field                       | Values                                                            | Default    | Effect                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderStyle`               | `standard`, `narrow`, `outsideStaff`, `singleNumber`, `noteValue` | `standard` | Selects glyph treatment only. `outsideStaff` uses the music font's tall, tightly condensed digits intended for enlargement outside a staff.                                         |
| `distribution`              | `perStaff`, `perGroup`                                            | `perStaff` | Engraves one meter on every staff or one per top-level staff group.                                                                                                                 |
| `grandStaff`                | `include`, `exclude`                                              | `include`  | Under `perGroup`, treats brace groups as one grand staff or splits them into its staves.                                                                                            |
| `position`                  | `center`, `top`, `bottom`, `above`                                | `center`   | Aligns final meter ink to the target staff/group; `above` is distribution-independent.                                                                                              |
| `scale`                     | number from 0.25 through 12                                       | `1`        | Multiplier over the render style's normal optical size. Outside-staff film-score meters commonly use 6–10×.                                                                         |
| `senzaMisura`               | `open`, `hidden`                                                  | `open`     | Whether standard MNX `display: "senzaMisura"` engraves its open-meter X glyph or remains unprinted.                                                                                 |
| `nonDefaultGroupingDisplay` | `standard`, `additive`, `annotation`                              | `standard` | House-style [grouping display](#grouping-display), applied only when a meter's resolved beat structure is structurally non-default. Ordinary/default meters always stay `standard`. |

This separation allows, for example, standard digits at 1.5× on every staff,
narrow digits centered once per bracket group, or single-number meters above
each staff. Choosing a group distribution no longer changes the glyph design
or forces a particular size.

The original **Spanning staff groups** preset used Bravura's `ss04` large-time-
signature digit cut. That cut remains available as `renderStyle:
"outsideStaff"` and legacy `spanning` values migrate to it together with
`distribution: "perGroup"` and `scale: 2`.

The controls live in **Setup → Music**, beside the shared score canvas rather
than in the modal application settings. Changes re-engrave the open document
immediately; the Setup score switcher selects the full-score or part layout
used for visual comparison.

Setup presents recognizable styles first and keeps the orthogonal object as an
advanced customization layer:

| Setup style         | Effective settings                           |
| ------------------- | -------------------------------------------- |
| Standard            | Standard digits, per staff, centered, 1×     |
| Large on each staff | Standard digits, per staff, centered, 1.5×   |
| Film score          | Film-score numerals, per group, centered, 8× |
| Above each group    | Standard digits, per group, above, 1×        |

Changing any field under **Advanced** makes the displayed style **Custom**.
Compact numerals, single-number meters, and note-value denominators remain
available there without competing with the four primary engraving styles.
The four styles are shown as miniature engraved systems in an accessible
visual radio group, so their staff/group behavior is visible before selection.
Advanced numeral design uses the same visual radio-card language for Standard,
Condensed, Film-score, Single-number, and Note-value designs. Distribution,
grand-staff behavior, position, and scale remain ordinary controls.
Scale is a constrained number field (0.5–12× in 0.25× increments) that commits
on blur or Enter, avoiding a full score re-layout for every pointer movement.
Those specimens share the production palette's staff/time-signature renderer:
five lines one staff-space apart, Bravura metadata advance widths, and stacked
digit origins at one and three spaces within a centered staff. Multi-staff
presets extend the same geometry rather than using hand-positioned mockups.
The stored file remains the same orthogonal `time-signature-settings` object;
presets are a clearer authoring workflow, not another file-format layer.

A time signature is engraved only where the meter changes — it is not restated
at the start of each system, unlike a clef or key signature — so these styles
apply at the point of change.

```json
{
  "_x": {
    "viritura": {
      "timeSignatures": {
        "score": {
          "renderStyle": "standard",
          "distribution": "perGroup",
          "grandStaff": "include",
          "position": "center",
          "scale": 1.5
        },
        "parts": {
          "renderStyle": "standard",
          "distribution": "perStaff",
          "position": "center",
          "scale": 1
        }
      }
    }
  }
}
```

Legacy `normal`, `large`, `narrow`, `aboveStaff`, `spanning`, `singleNumber`,
and `noteValue` strings remain readable and are migrated to the equivalent
object. New serialization always writes the object form.

Which settings apply are decided by the layout being engraved: score definition 0
is the score, and any later score definition whose layout draws exactly one
part — what the editor's "add part" flow produces — reads `parts`. Everything
else (a condensed score, a custom subset) is engraved as a score.

### `soundProfile`

Score playback assignment (`sound-profile-assignment`). `profileId` and
`profileVersion` identify the profile rules; `parts` maps a stable MNX part ID
to a profile-defined `sourceId`. A source assignment changes playback only: it
does not change the part's notation identity, name, transposition, or family.
`sourceId` is intentionally not a MIDI program number and cannot contain local
paths or plug-in state.

```json
{
  "_x": {
    "viritura": {
      "soundProfile": {
        "profileId": "viritura-sounds",
        "profileVersion": 1,
        "parts": {
          "clarinet-1": { "sourceId": "brass.tuba-primary" }
        }
      }
    }
  }
}
```

Omitting a part from `parts` selects the profile's notation-based default.
Existing scores without this extension use VirituraSounds and their notation
instrument choice. Never use a part-array index as a key.

### `videoSync`

Score-to-picture synchronization settings (`video-sync`) for film/TV scoring.
MNX has no concept of picture, so the whole feature lives in **one versioned
vendor object** rather than scattering unrelated extensions across the document.

| Field                  | Type                                          | Required | Notes                                                                            |
| ---------------------- | --------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `version`              | integer ≥ 1                                   | **Yes**  | Schema version of this payload                                                   |
| `pictureOffsetSeconds` | number                                        | **Yes**  | Media time corresponding to score time zero; may be negative                     |
| `pictureAudioEnabled`  | boolean                                       | No       | Whether the picture's production audio is audible. Default `false`               |
| `startTimecodeSeconds` | number                                        | No       | **Display-only** offset for the timecode readout (e.g. a `01:00:00:00` delivery) |
| `frameRate`            | enum                                          | No       | Declared frame rate of the delivery. See below                                   |
| `hitPoints`            | [hit-point](#hit-point)[]                     | No       | Spotted moments in the picture, in no guaranteed order                           |
| `media`                | [video-media-identity](#video-media-identity) | No       | Attached picture. Absent when a score remembers an offset but no picture         |

`frameRate` is one of `23.976`, `24`, `25`, `29.97`, `29.97df`, `30`, `50`,
`59.94`, `59.94df`, `60` — an identifier rather than a decimal, for two reasons.
NTSC rates are rational: 23.976 is exactly 24000/1001, and storing the decimal
drifts more than a frame per hour. And drop-frame is a labelling convention
rather than a distinct speed, so it rides along in the same id rather than
becoming a separate boolean that could contradict the number beside it.

It is absent by default rather than defaulting to 24.
`MediaTrackSettings.frameRate` is not used because it describes a capture
stream, not the selected file. Viritura instead reads the container metadata
through MediaInfo and persists a high-confidence standard rate automatically.
VFR, non-standard rates, and NTSC rates without an explicit QuickTime `tmcd`
drop-frame flag remain user-confirmed. The persisted value is therefore still a
declaration, whether adopted from authoritative metadata or chosen manually;
an assumed 24 that looks confirmed is worse than no value.

#### `hit-point`

A moment in the picture the music is being written against.

| Field            | Type    | Required | Notes                                                            |
| ---------------- | ------- | -------- | ---------------------------------------------------------------- |
| `id`             | string  | **Yes**  | Stable identity, so a hit survives being renamed or moved        |
| `pictureSeconds` | number  | **Yes**  | Media time of the moment                                         |
| `label`          | string  | No       | What happens here ("door slams")                                 |
| `locked`         | boolean | No       | Whether the solver must land a downbeat here. Defaults to `true` |

Hits are stored in **picture** time, not score time, because they describe the
film. They must survive any amount of rewriting of the music — that is the whole
point of spotting before composing. `locked` distinguishes a commitment from a
note to self: only locked hits define solvable spans and only locked hits
produce streamers, because flashing a cue for a maybe teaches a conductor to
distrust the system.

#### `video-media-identity`

| Field             | Type              | Required | Notes                                                                   |
| ----------------- | ----------------- | -------- | ----------------------------------------------------------------------- |
| `displayName`     | string            | **Yes**  | File or clip name shown in the UI. **Never a path**                     |
| `contentHash`     | `sha256:<64 hex>` | No       | Sampled hash of a local file plus its byte length; verifies a relink    |
| `demoSourceId`    | string            | No       | Clip from Viritura's demo catalog; streams from a public URL, no relink |
| `durationSeconds` | number > 0        | No       | Media duration when known at attach time                                |

```json
{
  "_x": {
    "viritura": {
      "videoSync": {
        "version": 1,
        "pictureOffsetSeconds": 120,
        "pictureAudioEnabled": false,
        "frameRate": "23.976",
        "hitPoints": [{ "id": "h1", "pictureSeconds": 12.5, "label": "door slams", "locked": true }],
        "media": {
          "displayName": "picture-lock-v12.mp4",
          "contentHash": "sha256:…",
          "durationSeconds": 150.5
        }
      }
    }
  }
}
```

**No local paths, no media bytes.** A score must open on another machine and
round-trip through any MNX reader, so a local video stays a _device-local
binding_ the user relinks; `contentHash` is what makes that relink verifiable
rather than a guess. Timing itself is never stored: score position comes from
the tempo model, and `pictureOffsetSeconds` is the only scalar joining the two
timelines. See [`plans/video-sync.md`](../plans/video-sync.md).

### `lyricWorkflow`

Source and repair metadata for previewed lyric distribution
(`lyric-workflow`). Standard MNX event lyrics remain authoritative for visible
text. This root index retains information that MNX event lyrics cannot express:
the verbatim pasted source, stable token identity, explicit melisma skips, and
the event/voice anchor last confirmed by the user.

| Field     | Type                              | Required | Notes                                     |
| --------- | --------------------------------- | -------- | ----------------------------------------- |
| `sources` | object of `lyric-workflow-source` | **Yes**  | Keyed by stable source ID, never by index |

Each source contains `id`, `lineId`, verbatim `text`, optional BCP 47
`language`, and a `tokens` array. A token always has a stable `id`; visible
tokens carry `text` and optional MNX syllabic `type`, while explicit
underscores carry `skip: true`. `eventId`, `partId`, and `sequenceIndex`
describe the last confirmed anchor. Omitting those anchor fields detaches a
token for review without discarding it.

```json
{
  "_x": {
    "viritura": {
      "lyricWorkflow": {
        "sources": {
          "0199-source": {
            "id": "0199-source",
            "lineId": "verse-1",
            "text": "Hal-le _",
            "language": "en",
            "tokens": [
              {
                "id": "0199-token-1",
                "text": "Hal",
                "type": "start",
                "eventId": "event-12",
                "partId": "soprano",
                "sequenceIndex": 0
              },
              {
                "id": "0199-token-2",
                "skip": true,
                "eventId": "event-13",
                "partId": "soprano",
                "sequenceIndex": 0
              }
            ]
          }
        }
      }
    }
  }
}
```

Keeping sources and tokens in ID-keyed records lets concurrent work on
different lyric lines merge without index renumbering. If an anchored event is
deleted or revoiced, the editor reports the source token as orphaned or moved
instead of silently choosing another voice.

---

## Global Measure Extensions

Extensions on `global.measures[]._x.viritura`.

### `rehearsalMark`

A rehearsal mark displayed above the staff.

| Property | Type                                  | Required | Description                       |
| -------- | ------------------------------------- | -------- | --------------------------------- |
| `text`   | string                                | **Yes**  | Label text (e.g. "A", "B", "1")   |
| `style`  | `"boxed"` \| `"circled"` \| `"plain"` | No       | Display style. Default: `"boxed"` |

```json
{
  "time": { "count": 4, "unit": 4 },
  "_x": {
    "viritura": {
      "rehearsalMark": { "text": "A", "style": "boxed" }
    }
  }
}
```

### `coda`

A coda navigation marker.

| Property   | Type                                   | Required | Description                 |
| ---------- | -------------------------------------- | -------- | --------------------------- |
| `location` | [RhythmicPosition](#rhythmic-position) | **Yes**  | Position within the measure |
| `glyph`    | string                                 | No       | SMuFL glyph name override   |
| `color`    | string                                 | No       | Rendering color (CSS hex)   |

```json
{
  "_x": {
    "viritura": {
      "coda": { "location": { "fraction": [0, 1] } }
    }
  }
}
```

### `jump`

Navigation jumps not covered by MNX's current `jump.type` enum.

| Property   | Type                                   | Required | Description                 |
| ---------- | -------------------------------------- | -------- | --------------------------- |
| `type`     | `"dsalcoda"` \| `"dcalcoda"`           | **Yes**  | Jump variant                |
| `location` | [RhythmicPosition](#rhythmic-position) | **Yes**  | Position within the measure |

Use native MNX `jump` for standard values such as `dsalfine`; use this extension
only when the target jump type is not yet in the spec enum.

### `markerText`

Authored display text belongs to a navigation marker on the same global
measure: its segno, coda, fine, or jump. It does not create a separate
free-text object or change navigation semantics; the owning marker remains
authoritative for playback, and moving or deleting the marker carries its text
with it.

`markerText` is an object keyed by owner. Each present key requires that marker
on the measure (native MNX `segno`, `fine`, or `jump`; the Viritura `coda` or
`jump` variant above).

| Property    | Type                                        | Required | Description                                       |
| ----------- | ------------------------------------------- | -------- | ------------------------------------------------- |
| `content`   | [Inline text content](#inline-text-content) | **Yes**  | Ordered authored text and SMuFL glyph runs        |
| `placement` | `"before"` \| `"after"` \| `"replace"`      | **Yes**  | Position relative to the generated glyph or label |

For the glyph markers (segno, coda), `before` and `after` set the text on the
same line as the sign, centred on its ink, so "To Coda ⊕" is a coda with
`before` text. For the text markers (fine, jump), the authored content is
joined to the generated label with a word space. `replace` prints only the
authored content. Blank authored content leaves the generated glyph or label
unchanged.

```json
{
  "jump": { "type": "dsalfine", "location": { "fraction": [1, 1] } },
  "_x": {
    "viritura": {
      "coda": { "location": { "fraction": [1, 1] } },
      "markerText": {
        "coda": { "content": [{ "text": "To Coda" }], "placement": "before" },
        "jump": { "content": [{ "text": "with repeats" }], "placement": "after" }
      }
    }
  }
}
```

### `chordSymbols`

Array of time-anchored harmony events, stored **only** at
`global.measures[]._x.viritura.chordSymbols`. The decoded TypeScript location is
`GlobalMeasure.chordSymbols`. Events are independent of notes and voices;
there is no part-measure chord collection or per-chord `displayStaff`.
Source-part [`chordSymbolVisibility`](#chordsymbolvisibility) controls display.

Roots and slash bass notes are canonical **concert pitch**. Written entry
converts both using the inverse of the source part's MNX sounding-to-written
interval. Rendering projects both into written pitch when the view requires
it, without changing stored harmony.

| Property       | Type                                   | Required | Description                                                    |
| -------------- | -------------------------------------- | -------- | -------------------------------------------------------------- |
| `position`     | [RhythmicPosition](#rhythmic-position) | **Yes**  | Exact rhythmic position, including optional grace index        |
| `root`         | [ChordRoot](#chord-root)               | No       | Structured concert root; parser requires `root` or `rawText`   |
| `rawText`      | string                                 | No       | Preserved authored text, including unsupported symbols and NC  |
| `quality`      | [ChordQuality](#chord-quality)         | No       | Omitted quality on a structured root means major               |
| `kindText`     | string                                 | No       | Authored suffix, including supported `add`/`no`/`omit` degrees |
| `bass`         | [ChordRoot](#chord-root)               | No       | Concert slash bass note                                        |
| `extension`    | `6` \| `7` \| `9` \| `11` \| `13`      | No       | Chord extension                                                |
| `textOverride` | string                                 | No       | Display override, not a replacement for the underlying harmony |

The schema requires `position`; the parsers additionally enforce the
`root`-or-`rawText` constraint. Rootless text does not acquire an invented root.
Authored spelling is retained; explicit transposition changes recognized root
and bass spellings while retaining unsupported suffixes.

`resolveChordSymbol` in `@viritura/core` is the semantic authority for editor
feedback and audio. Its results are `supported`, `silent`, or `unsupported`.
It checks agreement among structured fields, `rawText`, `kindText`, and
`textOverride`; an unknown quality or contradictory/unsupported override is
not silently played as a major chord. Unsupported text remains authored data.
`NC` and `N.C.` resolve to intentional silence when not contradicted by other
fields.

For degree modifiers, `quality` and `extension` retain the base harmony and
`kindText` retains the complete suffix. For example, `Cadd79omit5/E` stores
major quality, no extension, `kindText: "add79omit5"`, and bass E. The resolver
adds only the named degrees (added seventh is minor), then removes named
omissions; `add9` and `add13` do not imply lower extensions. `Cadd6` normalizes
to major quality with extension 6. No additional schema fields are needed.
Both base and modified harmony must agree across structured and text descriptions.

Semantic accidentals use Bravura SMuFL glyphs; literal display overrides remain
text. Unsupported symbols receive an editor-only red warning and the message
“Unsupported chord: cannot play this symbol.” This diagnostic is not persisted
as engraving color and does not appear in print preview, print, PDF, or SVG.
Unsupported and no-chord events produce no notes but still terminate the
preceding harmony.

```json
{
  "time": { "count": 4, "unit": 4 },
  "_x": {
    "viritura": {
      "chordSymbols": [
        {
          "position": { "fraction": [0, 1] },
          "root": { "step": "C" },
          "quality": "major",
          "rawText": "C"
        },
        {
          "position": { "fraction": [2, 4] },
          "rawText": "N.C."
        }
      ]
    }
  }
}
```

#### Import, paste, and export

MusicXML, MuseScore clipboard, and Finale gap-adapter imports consolidate
incoming harmony into this global collection. Equivalent harmony at the same
exact rational position is coalesced; conflicting incoming symbols keep the
topmost source part/staff and produce a warning. Grace indices distinguish
separate grace onsets. No conflicting part-local progression is retained.
Paste compares incoming sources only: it replaces destination symbols at
incoming onsets and leaves unrelated existing changes intact.

MNX serialization retains the canonical fields and authored text. PDF/SVG
export lays out the current model for the selected score definition, applying
source-part visibility and concert/written root and bass projection without
copying editor diagnostics into the output.

MuseScore StaffList clipboard harmony uses concert-pitch root and bass TPCs;
the receiving application applies destination written transposition. Unsupported
content exports with preservation warnings, using raw text or disambiguating
root/bass structure. Conversion fails if that representation would silently
change the harmony's meaning. MusicXML/MXL support here is import, not a
MusicXML export contract.

#### Derived playback

Any global chord symbols create a runtime-only **Chords** mixer lane, including
when all symbols are unsupported or silent. Its identity is
`viritura:derived:chords`, with runtime part index `score.parts.length`; it is
never serialized as a `Part` or assigned a user instrument profile. It starts
unmuted and uses the GM program 0 SoundFont piano on web and native playback.

`voiceChordSymbol` uses a fixed-register voicing: one root/slash bass at MIDI
36–47, and every semantic chord tone at MIDI 60–71, sorted and deduplicated.
The right hand includes the root unless explicitly omitted by degree 1 and
excludes a non-chord slash bass. This is
not voice-leading or an adaptive arrangement.

Click/commit auditions use the same voicing for 400 ms while transport is not
playing and respect effective mixer mute, solo, and gain. Playback includes the
lane in unselected full-score and current-view extracts regardless of visual
Hide. An explicit selection includes it only when every visible source part
is selected; partial selections exclude it, and an explicitly empty selection
includes nothing. Selection filtering does not overwrite mixer controls.

---

## Dynamic Group Extensions

Extensions on each standard `parts[].measures[].dynamics[]` object.

| Property          | Type               | Required | Description                                                |
| ----------------- | ------------------ | -------- | ---------------------------------------------------------- |
| `manualOffset`    | `[number, number]` | No       | User-authored `[dx, dy]` engraving offset in staff spaces. |
| `avoidCollisions` | boolean            | No       | Unset/true enables automatic reflow; false pins placement. |

```json
{
  "type": "gradual",
  "position": { "fraction": [0, 1] },
  "end": { "measure": "m2", "position": { "fraction": [2, 4] } },
  "wedgeType": "increasing",
  "_x": { "viritura": { "manualOffset": [0.5, -0.25] } }
}
```

## Positioned Staff Configuration Extensions

Extensions on `parts[].measures[].staffConfigs[]._x.viritura`.

### `staffLineRangeRestore`

The editor sets this boolean to `true` on the synthetic restoration event after
a bounded multi-bar staff-line edit. It carries no engraving semantics beyond
the standard MNX `staffConfigs` event. The marker lets a later “Remove selected
changes” command remove the generated boundary without deleting a pre-existing
explicit staff-line change.

---

## Part Measure Extensions

Extensions on `parts[].measures[]._x.viritura`.

### `pedals`

Array of piano pedal markings.

| Property   | Type                                                  | Required | Description                                                                        |
| ---------- | ----------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `type`     | `"sustain"` \| `"sostenuto"` \| `"una-corda"`         | **Yes**  | Pedal type                                                                         |
| `position` | [RhythmicPosition](#rhythmic-position)                | **Yes**  | Start position                                                                     |
| `end`      | [MeasureRhythmicPosition](#measure-rhythmic-position) | **Yes**  | End position                                                                       |
| `style`    | `"text"` \| `"bracket"`                               | No       | Display style. `"text"` = Ped/\*, `"bracket"` = line with hooks. Default: `"text"` |
| `staff`    | integer (≥1)                                          | No       | Staff number                                                                       |
| `voice`    | string                                                | No       | Voice name                                                                         |

**SMuFL glyphs**: U+E650 (Ped), U+E655 (\*), U+E659 (Sost.)

### `expressions`

Array of text expressions and performance directions.

| Property    | Type                                   | Required | Description                                                                              |
| ----------- | -------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `text`      | [TextContent](#inline-text-content)    | **Yes**  | Expression text (e.g. "dolce", "rit.", "a tempo"); legacy strings are accepted on import |
| `position`  | [RhythmicPosition](#rhythmic-position) | **Yes**  | Rhythmic position                                                                        |
| `placement` | `"below"` \| `"above"`                 | No       | Position relative to staff. Default: `"below"`                                           |
| `staff`     | integer (≥1)                           | No       | Staff number                                                                             |
| `voice`     | string                                 | No       | Voice name                                                                               |
| `frame`     | object                                 | No       | Optional rectangular presentation; see below                                             |

Below-staff text defaults to italic serif; above-staff text uses upright serif.
Rich-text run styles remain available inside either a plain expression or a frame.

`frame` shares the page-frame presentation vocabulary, but its width, when
specified, is `{ "unit": "staffSpaces", "value": <positive number> }`.
Page-column fractional widths are not supported for staff text. Omit width for
natural-width text; set it to wrap words to the frame's inner width. Height is
automatic and authored newlines are retained. A word wider than the inner width
overflows without splitting.

Optional `padding` is a nonnegative staff-space value. `border` is `"none"`
(default) or `"solid"`; `horizontalAlignment` is `"left"`, `"center"`, or `"right"`
around the rhythmic anchor. Omission preserves automatic alignment: left at
notes, right for end-of-measure instructions. `paragraphJustification` is
`"left"` (default), `"center"`, `"right"`, or `"justify"`.
Optional boolean `eraseBackground` has the same intent and default as on page
frames: `true` erases underlying ink within the rectangle including padding;
absent or `false` leaves it intact. No color is persisted. Erasing staff frames
paint above musical ink, including barlines emitted later in layout, and below
page furniture. Canvas caches and retained Horizon frames preserve this layering.

The frame stays music-relative in paged and Horizon views; it does not become
page furniture. Existing `manualOffset` (+x right, +y up) and `avoidCollisions`
continue to apply. Selection and automatic placement use the full rectangle,
including padding. With `frame` absent, legacy single-line rendering is unchanged.
No fixed height, page locator, or new staff/system scope is introduced.

In Write mode, create ordinary staff text in the Text palette. Select it and use
Properties to set **Wrap to frame width**, width, padding, border, alignment,
paragraph justification, and **Erase background** alongside the existing rich-text editor.
**Reset frame** removes only presentation, preserving text and musical attachment.

```json
{
  "text": [{ "text": "Play freely\nThen resume the pulse", "style": { "weight": "bold" } }],
  "position": { "fraction": [0, 1] },
  "placement": "above",
  "frame": {
    "width": { "unit": "staffSpaces", "value": 20 },
    "padding": 0.5,
    "border": "solid",
    "paragraphJustification": "center"
  }
}
```

Text attached grammatically to a dynamic uses the standard dynamic-group
`prefix`/`suffix` fields instead of a text-expression extension.

### `condensingOverride`

User-specified condensing-mode override for a part-measure on a condensed staff. Forces the engine to render this measure in the named mode instead of the auto-computed merge analysis (see [`spec/condensing-and-doubling.md`](./condensing-and-doubling.md)).

| Value        | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `unison`     | Force **a2** rendering even if pitches/markings differ                          |
| `solo1`      | Render only source 1 ("1." label); source 2 stays silent on the condensed staff |
| `solo2`      | Render only source 2 ("2." label)                                               |
| `amalgamate` | Force chord amalgamation even if markings differ                                |
| `divisi`     | Force split-stem divisi even if pitches/markings would amalgamate               |

### `groupingDisplayOverrides`

Array of per-staff grouping-display occurrence overrides for this part
measure. Each entry targets one staff and forces that staff's meter to the
named mode — presentation only, never the semantic `beatStructure`. This is
the highest-precedence input to the [Grouping Display](#grouping-display)
cascade.

| Property          | Type                                     | Required | Description                            |
| ----------------- | ---------------------------------------- | -------- | -------------------------------------- |
| `staff`           | integer (≥1)                             | **Yes**  | 1-based staff number within this part. |
| `groupingDisplay` | `standard` \| `additive` \| `annotation` | **Yes**  | Forced grouping-display mode.          |

```json
{
  "_x": {
    "viritura": {
      "groupingDisplayOverrides": [{ "staff": 1, "groupingDisplay": "standard" }]
    }
  }
}
```

A grand-staff piano part might author its own irregular grouping globally
(via `time._x.viritura.groupingDisplay`) but want only the upper staff to
show the annotation — this override lets one staff opt out (or in)
independently of its sibling staves.

### `staffMeters`

Array of per-staff synchronous local meter changes/resets, effective from
this measure onward until changed or reset again — declarations inherit
exactly like `time` on a global measure. A staff-local meter lets one staff
of a part notate its own time signature while every staff's barlines stay
locked to the shared global measure grid; **non-aligning/independent
polymeter is explicitly out of scope**. Each entry is a union: either sets a
staff-local meter and its synchronization mode, or resets the staff back to
following the global meter.

**Set** (`{staff, meter, synchronization}`):

| Property          | Type                             | Required | Description                                                             |
| ----------------- | -------------------------------- | -------- | ----------------------------------------------------------------------- |
| `staff`           | integer (≥1)                     | **Yes**  | 1-based staff number within this part.                                  |
| `meter`           | `{count, unit, beatStructure?}`  | **Yes**  | The staff-local meter. Same shape/rules as an MNX `time` signature.     |
| `synchronization` | `sharedDuration` \| `fitMeasure` | **Yes**  | How this staff's measure duration relates to the shared global measure. |

**Reset** (`{staff, useGlobal: true}`):

| Property    | Type         | Required | Description                                            |
| ----------- | ------------ | -------- | ------------------------------------------------------ |
| `staff`     | integer (≥1) | **Yes**  | 1-based staff number within this part.                 |
| `useGlobal` | `true`       | **Yes**  | Marks this entry as a reset rather than a declaration. |

**Synchronization modes:**

- `sharedDuration` — the staff-local meter's measure duration
  (`count * 4 / unit` quarter-note-equivalent beats) must equal the global
  measure's duration exactly. Ordinary written note durations need no
  scaling; e.g. local 6/8 (6·4/8 = 3 beats) over global 3/4 (3·4/4 = 3 beats).
  Validated strictly — an unequal duration is a semantic error, not merely a
  presentation choice.
- `fitMeasure` — one complete staff-local measure maps onto one complete
  global measure by a derived exact ratio (`global measure duration / local
measure duration`, kept as an exact rational fraction). E.g. local 6/8 (two
  dotted-quarter pulses, 3 beats) over global 2/4 (two quarter-note pulses,
  2 beats) derives ratio 2/3; local 12/8 (4 beats × 3, 6 beats) over global
  4/4 (4 beats) derives the same 2/3 ratio. The staff's own conventional note
  values and beat structure are unaffected — only spacing and playback
  positions are scaled by the ratio so the staff's pulses land under the
  correct global beat columns.

```json
{
  "_x": {
    "viritura": {
      "staffMeters": [{ "staff": 2, "meter": { "count": 6, "unit": 8 }, "synchronization": "fitMeasure" }]
    }
  }
}
```

Resetting staff 2 back to the global meter on a later measure:

```json
{ "_x": { "viritura": { "staffMeters": [{ "staff": 2, "useGlobal": true }] } } }
```

Declarations inherit per staff independently: setting staff 2's meter does
not disturb staff 1, and a later measure with no `staffMeters` entry for
staff 2 keeps that staff's most recently declared meter (or the global meter,
if never declared or already reset).

### `instrumentChanges` (provisional)

Ordered list of `instrument-change` entries that change the active
instrument, the active transposition, or both, from `position` (a
[rhythmic position](#rhythmic-position); absent means the start of the
measure). Each entry must set `instrument`, `transposition`, or both:

| Entry                            | Meaning                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `instrument` only                | Switch to that key in the part's `instruments`; transposition resets to that instrument's default.           |
| `transposition` only             | Keep the instrument, change its transposition (horn/trumpet crooks, rotary change). No `instruments` needed. |
| `instrument` and `transposition` | Switch instrument with an explicit transposition overriding its default.                                     |

A zero interval (`{ "halfSteps": 0, "staffDistance": 0 }`) returns to concert
pitch. Changes persist until the next change and apply from their own
position onward; ties, slurs, and hairpins are not expected to cross them.
The optional `instruction` carries the authored change text
(`{ "text": "muta in Picc." }`) or `{ "hidden": true }` to suppress the default
label. Positions must be unique within a measure, and `instrument` must name
a key in the part's `instruments`.

The independent optional `reminder` uses the same `{ text?, hidden? }`
shape. Absence or `{}` inherits house-style visibility with automatic text;
`{ "hidden": true }` explicitly suppresses it and `{ "hidden": false }`
explicitly shows it. Root `_x.viritura.instrumentChangeStyle` sets the
score-wide `showChangeLabel` and `showAdvanceReminder` defaults (both true
when omitted). **Engrave → House Style → Instrument Changes** edits these
defaults. Change-point labels use the same visibility inheritance rule.
Neither its custom text nor its visibility changes the `instruction` label
at the declaration. Automatic labels within the music use the active
instrument's `shortName` (or its automatic abbreviation) and tuning for
both instrument switches and transposition-only changes: `Cl in B♭` at
the opening, `To Cl in C` as the advance reminder, and `Cl in C` at the
change. Authored abbreviation punctuation and custom label text are
preserved. Frontmatter retains full instrument names. Octave-only labels
include, for example, `(sounds C5 for written C4)`. These labels use sounding
pitch for written C, not numeric MNX interval counts.

An enabled reminder automatically attaches **just after the last preceding
sounding notehead**, so the player can use the following rest. It stays
attached to that note, never to a preceding or following rest or barline.
Rests and invisible spaces are not sounding anchors. All voices and staves
are considered, including tied continuations, dotted notes, and tuplets.
The note anchor can be fractional and in an earlier measure; it never
moves the authored bar-start declaration or changes the instrument timeline.
If no previous sounding note exists, or its release leaves no gap before
the change (including a tie sounding across it), the reminder is omitted:
there is no valid advance anchor. Grace-only material does not establish
an independent notated release anchor. Excerpts show a reminder only when
its original anchor measure is included; they do not invent a new position.

```json
{
  "_x": {
    "viritura": {
      "instrumentChanges": [{ "instrument": "picc", "instruction": { "text": "muta in Picc." } }]
    }
  }
}
```

```json
{
  "_x": {
    "viritura": {
      "instrumentChanges": [
        {
          "transposition": { "interval": { "halfSteps": 9, "staffDistance": 5 } },
          "instruction": { "text": "in Es" }
        }
      ]
    }
  }
}
```

The decoded TypeScript field is `PartMeasure.instrumentChanges`;
`resolveActiveInstrument(part, measureIndex, position)` and
`listInstrumentChanges(part)` in `@viritura/core` resolve the active
instrument and transposition at any point.

Engraving currently supports **bar-start changes only**. The provisional
schema and TypeScript resolver can preserve nonzero fractions for future
support, but full Rust parsing and measure-patch promotion reject them with
an explicit unsupported-instrument-change error rather than drawing
incorrect written pitches. Omitted positions and zero-numerator fractions
with positive denominators are supported.

#### Editing bar-start changes

Select a single bar in one source part (or a note in that bar), then choose
**Change instrument or tuning** from **Edit**, the score's
context menu, or the Jump Bar. These commands insert or edit the change at
the **start** of the selected bar; they do not transpose the sounding notes
or replace the whole part. Changes persist until another declaration.

The single wide dialog opens with the instrument and tuning active at the
selected bar, preserving inherited custom tuning. Selecting an instrument
applies its catalog-default transposition and clefs.
Its optional **Customize tuning** section offers
instrument-aware presets and exact sounding pitch/octave controls before
applying the instrument and tuning together in one score update. Selecting
a different instrument resets tuning to that instrument's default;
**Use instrument default** removes a custom override. Reopening an existing
override preserves it and opens the tuning section.
The shared instrument picker offers one default-first choice for tuning
variants: **Trumpet** defaults to B-flat and **Clarinet** to B-flat, with C
trumpet and A clarinet available through tuning customization instead of
separate picker rows. Horn and cornet likewise use key-free picker labels.
Register-distinct instruments such as piccolo clarinet, bass clarinet, and
the saxophone sizes remain separate choices. Existing MusicXML sound IDs,
including tuning-specific identities, remain valid and are not rewritten
merely by opening the picker.
Editing tuning or printed labels keeps instrument identity and clefs unless
another instrument is explicitly selected or its catalog defaults restored.
Tuning can override the default, including an explicit zero interval. The sign
convention is MNX's **concert-to-written** interval: B-flat clarinet is
`+2` semitones / `+1` staff step; piccolo is `-12` / `-7`.
The controls present this musically as the sounding pitch corresponding to
written C, with its octave and accidental, rather than asking for semitone
and staff-step counts; MNX intervals remain the stored representation.
The dialog uses the standard wide-dialog header and offers **Use house style /
Show / Hide** for each label, plus independent custom text. Preset names omit
the exact sounding octave suffix and mark the catalog default with a badge;
register distinctions such as horn alto/basso remain in the preset names.
The sounding-pitch menu offers common natural, sharp, and flat spellings,
preserving a current uncommon spelling without listing all uncommon options.
Side-by-side **Concert pitch** and **Written pitch** previews engrave the
same sounding notes through the score renderer with the selected interval,
clef, and key-flip threshold. Pure-octave written preference is deliberately
omitted from the concert-preview score so the comparison remains literal.
Reopening the dialog offers **Remove change**, which removes the entire
bar-start declaration while preserving later-positioned declarations.

The command applies to the part, including all its staves, not just the
clicked staff. Instrument choices must keep the same staff count and be
pitched instruments. Percussion-map swaps and changes of staff count need
separate source parts; this extension does not define per-instrument kits.
Changing instrument also sets the catalog's clefs and staff-line counts at
the bar start, preserving later-positioned staff changes. Removing it
restores the previous instrument's catalog defaults there.

Setup's **Change instrument** still replaces the starting instrument for the
whole part; its **Customize tuning** section edits the starting transposition.
Catalog-default tuning is summarized before opening those optional controls.
These
edits preserve later instrument definitions and timed changes, including
later returns to the old starting instrument.

Written-pitch layout uses the active transposition for notes, accidentals,
key signatures, and harmony. Concert-pitch layout
keeps sounding notation unless the active instrument prefers written pitches
(for example piccolo). Authored/automatic change instructions participate in
normal annotation placement; hidden instructions do not print. A change also
breaks a multimeasure rest so it remains visible.
An enabled reminder's anchor also interrupts a multimeasure-rest group.
Both labels use the normal centralized expression annotation, spacing,
collision, and rendering paths.

When a part actually uses multiple instrument identities or tunings, its
automatic staff names show only the instrument and tuning **active at the
first bar of that system**: full names on the first system and abbreviated
names on later systems. Changes later in the system do not alter its staff
label. Frontmatter lists **all required states** in first-use order.
Returning to the same instrument and interval does
not repeat its entry; unused instrument definitions and unchanged-state
reminders do not add entries. Octave differences remain distinct:
B-flat horn uses **alto** / **basso**, and E-flat clarinet uses
**piccolo** / **alto**. Other octave-distinct tunings state the sounding
pitch for written C4. Explicit author-supplied layout labels remain intact.

Extracted parts use the same required-state list in the boxed instrument
header on the first page, including a dedicated title page. Automatic
player numbers appear on every line. The frame fits the widest line and
the complete text stack, with space reserved above the first music system.
Explicitly renamed score definitions and work-title metadata remain intact.

Such a part also prints its initial short name and tuning above its first
bar, independent of concert/written display. A first-bar instrument or
transposition declaration supplies that bar's instruction instead, avoiding
a duplicate automatic initial label. Parts without actual state changes
retain their existing labels and do not acquire an initial instruction.
These rules apply to direct part/full-score layout and MNX layout paths;
they do not alter sounding notes, stored instrument state, or playback.

Editing an instrument/transposition timeline revalidates cached layout
throughout the displayed part, including subsequent systems. Local-bar
cache shortcuts apply only while the timeline is unchanged; inserting,
editing, or removing a declaration must update later written pitches and
signatures without requiring a view-mode switch.

Playback preloads the instruments used by the part and routes each note to
the active sound at its authored position, including seeks and repeat
playback. Transposition-only changes never shift sounding MIDI pitches.
The initial instrument retains its authored sound-profile source assignment;
later instrument switches use the profile's defaults for that instrument.
Entry and selected-note previews also use the active instrument and sounding
pitch. Parts with timed instrument switches currently use browser SoundFont
playback instead of native/VST playback, with an explicit notification.

---

## Event Markings Extensions

Extensions on `event.markings._x.viritura`. These are articulation-like markings that apply to individual notes/rests.

> **Note (MNX v15):** `fermata` is now a native MNX field at the event level
> (`event.fermata`), no longer under `markings._x.viritura`. See the MNX
> spec — `fermata-symbol` and `fermata-duration` are independent enums.

### `staccatissimoWedge`

Staccatissimo wedge articulation variant (SMuFL `articStaccatissimoWedge`). MNX
has native `staccatissimo`, but not the wedge glyph variant.

| Property | Type                               | Required | Description                                |
| -------- | ---------------------------------- | -------- | ------------------------------------------ |
| `orient` | `"above"` \| `"below"` \| `"auto"` | No       | Vertical orientation relative to the staff |

### `trill`

A trill marking, optionally followed by a wavy extension line. The initial
symbol is shown by default. Set `showSymbol` to `false` when preserving an
extension-only line. The target can be the trill event itself with
`targetEdge: "end"` to span the written duration of one note.

| Property               | Type                 | Required | Description                                                  |
| ---------------------- | -------------------- | -------- | ------------------------------------------------------------ |
| `accidental`           | `-1` \| `0` \| `1`   | No       | Auxiliary note accidental: -1 = flat, 0 = natural, 1 = sharp |
| `showSymbol`           | boolean              | No       | Whether to show the initial trill symbol; defaults to `true` |
| `extension.target`     | string               | No       | Event ID whose rhythmic edge anchors the line end            |
| `extension.targetEdge` | `"start"` \| `"end"` | No       | Target event edge; defaults to `"start"`                     |

**SMuFL glyphs**: U+E566 (ornamentTrill) and U+EAA4 (wiggleTrill). Extension
rendering uses the active engraving font rather than preserving a
source-application font choice. In the editor, the extension is a selectable
spanner whose end handle snaps to the start or end edge of note events.

### `ornaments`

Array of ornament type strings. Each renders its corresponding SMuFL glyph above the note.

**Values**: `"turn"`, `"invertedTurn"`, `"mordent"`, `"invertedMordent"`, `"shortTrill"`, `"trillMordent"`, `"delayedTurn"`, `"schleifer"`

**SMuFL glyphs**: U+E567–U+E56F (ornament range)

```json
{
  "markings": {
    "_x": {
      "viritura": {
        "ornaments": ["mordent"]
      }
    }
  }
}
```

### `fingerings`

Array of fingering annotations on a note.

| Property | Type          | Required | Description                                              |
| -------- | ------------- | -------- | -------------------------------------------------------- |
| `finger` | integer (0–5) | **Yes**  | Finger number: 0 = thumb/open, 1–5 = index through pinky |

**SMuFL glyphs**: U+ED10–U+ED15 (fingering digits)

### `arpeggiate`

A rolled-chord (arpeggio) indication on a chord event. Preserved from MusicXML import.

| Property    | Type               | Required | Description                                          |
| ----------- | ------------------ | -------- | ---------------------------------------------------- |
| `direction` | `"up"` \| `"down"` | No       | Roll direction. Omitted = renderer default (upward). |

---

## Event Extensions

Extensions on `event._x.viritura` (on the event object itself, not inside markings).

### `glissandos`

Array of glissando/portamento lines connecting this event to target events.

| Property   | Type                            | Required | Description                                                 |
| ---------- | ------------------------------- | -------- | ----------------------------------------------------------- |
| `target`   | string                          | **Yes**  | ID of the target event                                      |
| `kind`     | `"glissando"` \| `"portamento"` | No       | Semantic kind, independent of its label. Default: glissando |
| `style`    | `"straight"` \| `"wavy"`        | No       | Line style. Default: `"straight"`                           |
| `text`     | string                          | No       | Optional text label (e.g. "gliss.", "port.")                |
| `showText` | boolean                         | No       | Whether to display the label. Default: `true`               |

```json
{
  "id": "ev1",
  "duration": { "base": "quarter" },
  "_x": {
    "viritura": {
      "glissandos": [{ "target": "ev2", "style": "straight" }]
    }
  },
  "notes": [{ "pitch": { "step": "C", "octave": 4 } }]
}
```

---

## Slur Extensions

Extensions on a slur object, i.e. an entry of `event.slurs[]._x.viritura`.

### `shape`

Per-handle bezier overrides for engrave-mode handle drags. Each field is a
`[dx, dy]` delta in spatia (sp) applied on top of the engine-computed point
for that handle, so manual adjustments **compose** with automatic collision
avoidance (re-running layout still respects the user's tweak as an additive
offset rather than an absolute position).

| Property | Type               | Required | Description                      |
| -------- | ------------------ | -------- | -------------------------------- |
| `p0`     | `[number, number]` | No       | Start endpoint delta in sp       |
| `p1`     | `[number, number]` | No       | First control point delta in sp  |
| `p2`     | `[number, number]` | No       | Second control point delta in sp |
| `p3`     | `[number, number]` | No       | End endpoint delta in sp         |

```json
{
  "target": "ev3",
  "_x": {
    "viritura": {
      "shape": {
        "p1": [0.0, -0.8],
        "p2": [0.0, -0.8]
      }
    }
  }
}
```

The engine surfaces the _computed_ spine bezier (post-overrides) as part of
the display list (`SlurGeometry`), which engrave mode reads to paint drag
handles and to hit-test edits without re-decoding the painted crescent.

---

## Kit Component Extensions

Extensions on `parts[].kit[]._x.viritura` (on a drum-kit component).

### `notehead`

Notehead shape rendered for hits on this kit component (e.g. `"x"` for cymbals/hi-hat,
`"diamond"` for special techniques). The underlying MNX gap is broader than drum-kit
notation: MNX has no standard way to assign a custom notehead shape or SMuFL notehead
glyph on `note`, `kit-component`, or inherited layout defaults. See
[W3C MNX issue #249](https://github.com/w3c-cg/mnx/issues/249).

Viritura currently stores notehead shape on `kit-component` because that covers the
percussion-map use case cleanly: every `kit-note` referencing the component renders with
the configured shape while round-tripping through spec-compliant MNX consumers. A future
MNX standard solution should likely address both per-note overrides and reusable/inherited
defaults, not only drum kits.

Allowed values: `"normal"`, `"x"`, `"circleX"`, `"diamond"`, `"slash"`,
`"triangleUp"`, `"triangleDown"`. Default: `"normal"`.

```json
{
  "id": "kc-hh",
  "name": "Hi-Hat",
  "sound": "hihat-closed",
  "staffPosition": 5,
  "_x": {
    "viritura": {
      "notehead": "x"
    }
  }
}
```

---

## Shared Types

### Rhythmic Position

A position within a measure expressed as a fraction.

```json
{ "fraction": [0, 1] }
```

`[0, 1]` = start of measure, `[1, 4]` = beat 2 in 4/4 time, `[3, 4]` = beat 4.

### Measure Rhythmic Position

A rhythmic position that references a specific measure by ID.

```json
{
  "measure": "m2",
  "position": { "fraction": [2, 4] }
}
```

### Chord Root

A note name with optional chromatic alteration.

```json
{ "step": "F", "alter": 1 }
```

`step` is one of: A, B, C, D, E, F, G. `alter` is semitones: -1 = flat, 1 = sharp.

### Chord Quality

One of: `"major"`, `"minor"`, `"dominant"`, `"diminished"`, `"augmented"`, `"half-diminished"`, `"minor-major"`, `"power"`, `"suspended2"`, `"suspended4"`

---

## Rationale

These features are universally supported by major notation software (industry-standard engravers, Finale, Sibelius) but are not yet part of the MNX specification. Rather than inventing a proprietary format or polluting the MNX namespace with non-standard properties, we use the `_x` vendor extension mechanism that the MNX spec explicitly provides for this purpose.

If and when the W3C MNX group adds these features to the specification, we will migrate from `_x.viritura` to the standard properties.

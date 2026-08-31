# Viritura MNX Vendor Extensions Reference

Viritura extends the [MNX specification](https://w3c.github.io/mnx/docs/) using the standard `_x` vendor extension mechanism defined in MNX's [global attributes](https://w3c.github.io/mnx/docs/mnx-reference/objects/global-attrs/). All Viritura extensions live under the `"viritura"` vendor key.

> **Why `_x`?** MNX objects set `unevaluatedProperties: false`, which means adding custom top-level properties fails schema validation. The `_x` vendor dict is the only spec-sanctioned way to extend MNX objects.

> Dynamics are standard MNX `dynamic-group` objects — hairpins are gradual
> groups and dynamic-attached text uses standard `prefix`/`suffix`. Viritura
> adds only engraving placement under each group's `_x.viritura` dict; see
> [dynamics.md](dynamics.md).

## Quick Reference

| MNX Object                                   | JSON Path                                   | Extensions                                                            |
| -------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| [score (root)](#score-root-extensions)       | `_x.viritura`                               | metadata, textStyles, timeSignatures, soundProfile, videoSync         |
| [measure-global](#global-measure-extensions) | `global.measures[]._x.viritura`             | rehearsalMark, coda, jump variants not in MNX                         |
| [part-measure](#part-measure-extensions)     | `parts[].measures[]._x.viritura`            | pedals, chordSymbols, expressions, condensingOverride                 |
| [dynamic-group](#dynamic-group-extensions)   | `parts[].measures[].dynamics[]._x.viritura` | manualOffset, avoidCollisions                                         |
| [event-markings](#event-markings-extensions) | `...content[].markings._x.viritura`         | staccatissimoWedge, trill, ornaments, fingerings, caesura, arpeggiate |
| [event](#event-extensions)                   | `...content[]._x.viritura`                  | glissandos                                                            |
| [slur](#slur-extensions)                     | `...content[].slurs[]._x.viritura`          | shape                                                                 |
| [kit-component](#kit-component-extensions)   | `parts[].kit[]._x.viritura`                 | notehead                                                              |

**Schema**: [`packages/format/schemas/viritura-extensions.json`](../packages/format/schemas/viritura-extensions.json)

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

| Field          | Values                                                            | Default    | Effect                                                                                                                                      |
| -------------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderStyle`  | `standard`, `narrow`, `outsideStaff`, `singleNumber`, `noteValue` | `standard` | Selects glyph treatment only. `outsideStaff` uses the music font's tall, tightly condensed digits intended for enlargement outside a staff. |
| `distribution` | `perStaff`, `perGroup`                                            | `perStaff` | Engraves one meter on every staff or one per top-level staff group.                                                                         |
| `grandStaff`   | `include`, `exclude`                                              | `include`  | Under `perGroup`, treats brace groups as one grand staff or splits them into its staves.                                                    |
| `position`     | `center`, `top`, `bottom`, `above`                                | `center`   | Aligns final meter ink to the target staff/group; `above` is distribution-independent.                                                      |
| `scale`        | number from 0.25 through 12                                       | `1`        | Multiplier over the render style's normal optical size. Outside-staff film-score meters commonly use 6–10×.                                 |
| `senzaMisura`  | `open`, `hidden`                                                  | `open`     | Whether standard MNX `display: "senzaMisura"` engraves its open-meter X glyph or remains unprinted.                                         |

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
          "clarinet-1": { "sourceId": "tuba-primary" }
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

### `chordSymbols`

Array of chord symbols above the staff.

| Property       | Type                                   | Required | Description                                   |
| -------------- | -------------------------------------- | -------- | --------------------------------------------- |
| `position`     | [RhythmicPosition](#rhythmic-position) | **Yes**  | Rhythmic position                             |
| `root`         | [ChordRoot](#chord-root)               | **Yes**  | Root note                                     |
| `quality`      | [ChordQuality](#chord-quality)         | **Yes**  | Harmonic quality                              |
| `bass`         | [ChordRoot](#chord-root)               | No       | Bass note for slash chords (e.g. "C/E")       |
| `extension`    | `7` \| `9` \| `11` \| `13`             | No       | Chord extension                               |
| `textOverride` | string                                 | No       | Override computed display text (e.g. "Cadd9") |

```json
{
  "_x": {
    "viritura": {
      "chordSymbols": [
        {
          "position": { "fraction": [0, 1] },
          "root": { "step": "C" },
          "quality": "major"
        },
        {
          "position": { "fraction": [2, 4] },
          "root": { "step": "G" },
          "quality": "dominant",
          "extension": 7
        }
      ]
    }
  }
}
```

### `expressions`

Array of text expressions and performance directions.

| Property    | Type                                   | Required | Description                                       |
| ----------- | -------------------------------------- | -------- | ------------------------------------------------- |
| `text`      | string                                 | **Yes**  | Expression text (e.g. "dolce", "rit.", "a tempo") |
| `position`  | [RhythmicPosition](#rhythmic-position) | **Yes**  | Rhythmic position                                 |
| `placement` | `"below"` \| `"above"`                 | No       | Position relative to staff. Default: `"below"`    |
| `staff`     | integer (≥1)                           | No       | Staff number                                      |
| `voice`     | string                                 | No       | Voice name                                        |

Rendered in italic serif font.

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

A trill marking (tr~ symbol above the note).

| Property     | Type               | Required | Description                                                  |
| ------------ | ------------------ | -------- | ------------------------------------------------------------ |
| `accidental` | `-1` \| `0` \| `1` | No       | Auxiliary note accidental: -1 = flat, 0 = natural, 1 = sharp |

**SMuFL glyph**: U+E566 (ornamentTrill)

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

### `caesura`

A caesura (grand pause / railroad tracks) placed on an event.

| Property | Type                                               | Required | Description                        |
| -------- | -------------------------------------------------- | -------- | ---------------------------------- |
| `style`  | `"normal"` \| `"thick"` \| `"short"` \| `"curved"` | No       | Style variant. Default: `"normal"` |

```json
{
  "duration": { "base": "quarter" },
  "notes": [{ "pitch": { "step": "C", "octave": 5 } }],
  "markings": {
    "_x": {
      "viritura": {
        "caesura": { "style": "normal" }
      }
    }
  }
}
```

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

| Property | Type                     | Required | Description                                  |
| -------- | ------------------------ | -------- | -------------------------------------------- |
| `target` | string                   | **Yes**  | ID of the target event                       |
| `style`  | `"straight"` \| `"wavy"` | No       | Line style. Default: `"straight"`            |
| `text`   | string                   | No       | Optional text label (e.g. "gliss.", "port.") |

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

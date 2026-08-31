# Text Box System

A unified, declarative, conditionally-rendered text element subsystem for
all engraver-emitted text in Viritura — replacing the ad-hoc `DrawText`
call-sites scattered across the engine with a single composition primitive
the user can restyle, restructure, and extend.

## Motivation

Today every text-bearing element emits `RenderCommand::DrawText` directly,
with hardcoded font family, size, alignment, baseline, and positioning
arithmetic. Examples:

- Player labels — [engine/viritura-engine/src/layout/mnx_layout.rs:2007-2098](../../engine/viritura-engine/src/layout/mnx_layout.rs#L2007-L2098)
- Rehearsal marks, tempo marks, time signatures, clefs as letters …

Two problems compound:

1. **No house-style customization.** A user who wants Henle's centered
   labels, Bärenreiter's inline `Fl. 1·2`, or boxed rehearsal marks has
   no path short of patching the engine.
2. **No conditional rendering.** "If five instruments are condensed,
   collapse `1/2/3/4/5` to `1–5`" requires hardcoded engraver logic
   instead of being a property of the label template.

A small declarative composition system — pre-JSX React in spirit,
flexbox-shaped in layout — solves both. It applies to ~12 element types
across the score, so the investment is broadly amortized.

## Non-goals

- **No HTML/CSS embedding.** Discussed and rejected: requires a browser
  DOM for measurement, defeats headless export, opens the door to
  `position: absolute`, animations, `@font-face`, event handlers, none of
  which survive a PDF pipeline.
- **No full flexbox/grid.** Labels are tiny (≤ ~6 nodes), never compete
  for space, never wrap. A hand-rolled subset covers all real cases.
- **No reactive state inside templates.** Templates are pure
  `Data → Node`. Reactivity belongs in the editor state layer.
- **No CSS-selector cascade.** Cascade is component-name-based and
  explicit. Selector specificity is a tar pit.
- **No layout-driven branching (container queries) in v1.** Data-driven
  predicates cover ~90% of real engraving decisions; revisit if needed.
- **Not a replacement for music glyph rendering.** Beams, slurs, stems,
  noteheads stay geometric. This system covers _text_ and _text-adjacent
  decorations_ (boxes, brackets, lines around text).

## In-scope elements

A single `TextBox` subsystem can replace ad-hoc `DrawText` in:

| Element            | Current state                | What it gains                             |
| ------------------ | ---------------------------- | ----------------------------------------- |
| Player labels      | Hardcoded right-aligned cols | House styles, compression (`1–5`)         |
| Rehearsal marks    | Plain text or hardcoded box  | Boxed / circled / banner per style sheet  |
| Tempo marks        | Single `DrawText`            | Bold name + italic `(♩=120)`, multi-line  |
| Section labels     | Doesn't exist yet            | `II. Adagio non troppo` with hierarchy    |
| Dynamics           | Single glyph run             | Adjacent runs (`mf p`, `sfz→p`)           |
| Expressions        | Single text run              | Multi-line `(con sord., poco vibrato)`    |
| Chord symbols      | Doesn't exist yet            | Stacked extensions, superscripts          |
| Lyrics             | Doesn't exist yet            | Verse numbers, italic editorial syllables |
| Tuplet numbers     | Hardcoded italic centered    | `5:4` ratio, bracket vs no-bracket        |
| Voltas             | Hardcoded text               | Compression (`1.–3.` vs `1./2./3.`)       |
| Page headers/foots | Doesn't exist yet            | Multi-region (L/C/R) layout               |
| Measure numbers    | Hardcoded                    | Boxed every Nth, sub-cue brackets         |

## Core data model

### Node tree

```rust
pub enum TextNode {
    /// Literal text run with a single style.
    Text(String),

    /// Resolve from the rendering context (e.g. `{part.name}`),
    /// optionally piped through a formatter (`{numbers | range}`).
    Slot(SlotRef, Option<FormatterRef>),

    /// Layout container with flex-subset semantics.
    Box(BoxProps, Vec<TextNode>),

    /// Invoke a registered component template by name with overrides.
    /// Used for built-in components (`<StaffLabel>`, `<RehearsalMark>`)
    /// and user-registered overrides.
    Component(ComponentRef, ContextOverrides),

    /// Iterate a slot, binding each item, emit one node per item.
    Map { source: SlotRef, item: Ident, body: Box<TextNode> },

    /// Branch on a predicate.
    If { test: Predicate, then: Box<TextNode>, otherwise: Option<Box<TextNode>> },

    /// First-match-wins selection.
    Switch { arms: Vec<(Predicate, TextNode)>, default: Box<TextNode> },
}
```

### Box properties (flex subset)

```rust
pub struct BoxProps {
    pub direction: Direction, // Row | Column
    pub justify:   Justify,   // Start | Center | End | SpaceBetween
    pub align:     Align,     // Start | Center | End | Baseline
    pub gap:       Length,    // sp units
    pub padding:   Insets,    // sp on each side
    pub style:     StyleRef,  // inherited typography
    pub decoration: Option<Decoration>, // box / circle / banner / bracket
}
```

`Align::Baseline` is mandatory — text-on-text rows look broken without
it. Implementation: each text leaf reports baseline offset from font
metrics; a Baseline-aligned row shifts children to the max baseline.

### Style (inheritable typography)

```rust
pub struct Style {
    pub font_family: Option<String>,
    pub font_size:   Option<Length>,
    pub font_weight: Option<Weight>,   // Regular | Bold
    pub font_style:  Option<FontStyle>,// Roman | Italic
    pub color:       Option<Color>,
    pub letter_spacing: Option<Length>,
}
```

Style cascades down the tree. A child without a value inherits from its
nearest ancestor; if none, falls back to the registered defaults for
the component type.

### Predicate mini-language

A tiny expression evaluator (~150 lines of Rust). Operators:
`&&`, `||`, `!`, `==`, `!=`, `<`, `>`, `<=`, `>=`. Atoms: dotted paths
into the context (`part.numbers.len`, `system.is_first`), literal
numbers/strings/booleans, parens. No function calls (use formatters
instead). Deterministic, side-effect-free, cache-friendly.

Examples:

```jsonc
"numbers.len > 2 && numbers.is_contiguous"
"system.is_first || score.style.repeat_full_names"
"part.transposition.half_steps != 0"
```

### Slot formatters

Built-in formatters that transform a slot's value to a string:

| Formatter    | Example                                     |
| ------------ | ------------------------------------------- |
| `range`      | `[1,2,3,4,5] → "1–5"` if contiguous         |
| `dotted`     | `[1,2] → "1.2."`                            |
| `middle_dot` | `[1,2] → "1·2"`                             |
| `roman`      | `2 → "II"`                                  |
| `paren`      | `"a 2" → "(a 2)"`                           |
| `upper`      | `"adagio" → "ADAGIO"`                       |
| `title`      | `"adagio non troppo" → "Adagio non troppo"` |

Formatters are pure functions registered in a `FormatterRegistry`.
Users can register custom ones for niche conventions.

### Context

The context is the data bag a component receives — e.g. `StaffLabel`
gets `{ part, system, score, condensed_numbers, is_first_system }`.
Slots resolve via dotted-path lookup; predicates evaluate against the
same bag.

## Layout algorithm

Single-pass measure + place, ~250 lines of Rust:

```text
measure(node) -> Size {
    Text(s):  font.measure(s, style)
    Slot(s):  measure(resolve(s))
    Box(b):   children.map(measure); accumulate along main, max along cross
}

place(node, origin, parent_size) -> Vec<DrawText> {
    For Box:
      compute child main offsets per `justify`
      compute child cross offsets per `align` (baseline-aware)
      recurse into children
    For Text:
      emit DrawText at computed origin
}
```

No constraint solver, no fragment trees, no reflow loop. The engine
calls `measure()` to learn the label's intrinsic width (used to position
the surrounding staff), then `place()` to emit drawing commands.

## Font metrics

Three realistic strategies; ship (1), add (2) on demand:

1. **Ship metrics for a curated font set** — Academico, Bravura Text,
   Noto Serif, Latin Modern Roman. ~100 KB of metric tables baked into
   the WASM. Predictable, headless, fast.
2. **Parse uploaded fonts via ttf-parser** at startup for user fonts.
3. **Host-callback measurement** — engine asks the host for
   `measure_text(font, size, str) → Size`. Works for browser-only
   editor use; doesn't survive server-side PDF export.

## Authoring surface (three opt-in levels)

1. **JSON style sheet** — override component templates by name and tune
   typography. Most users land here.
   ```jsonc
   {
     "components": {
       "StaffLabel": "@viritura/templates/staff-label-bärenreiter",
       "RehearsalMark": "@viritura/templates/rehearsal-mark-boxed",
     },
     "styles": {
       "StaffLabel": { "font-family": "Academico", "font-size": "10pt" },
       "RehearsalMark": { "font-weight": "bold", "padding": "0.3sp" },
     },
   }
   ```
2. **Inline template JSON** — drop in a full `TextNode` tree.
   ```jsonc
   {
     "name": "StaffLabel",
     "tree": {
       "Box": {
         "direction": "Row",
         "align": "Baseline",
         "gap": "0.5sp",
         "children": [
           {
             "Box": {
               "direction": "Column",
               "align": "End",
               "children": [
                 { "Slot": "part.name" },
                 { "If": { "test": "part.transposition.exists", "then": { "Slot": "part.transposition.label" } } },
               ],
             },
           },
           {
             "If": {
               "test": "condensed_numbers.len > 2 && condensed_numbers.is_contiguous",
               "then": { "Text": "{condensed_numbers | range}" },
               "otherwise": {
                 "Box": {
                   "direction": "Column",
                   "children": { "Map": { "source": "condensed_numbers", "item": "n", "body": { "Text": "{n}" } } },
                 },
               },
             },
           },
         ],
       },
     },
   }
   ```
3. **TS/JS plugin (editor only)** — a function
   `(ctx: Context) => TextNode` registered at runtime. Maximum power but
   doesn't survive headless export unless serialized to JSON first.

## Implementation stages

| Stage | Scope                                                                                                                                                       | Risk |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1     | Internal refactor: `TextNode` + layout algo. Migrate player labels and rehearsal marks to it. Keep behaviour identical (snapshot tests). No public API yet. | Low  |
| 2     | JSON style sheet: typography + box layout overrides per component (no conditions). Both elements re-stylable.                                               | Low  |
| 3     | Predicate engine + `If` / `Switch` / `Map` + slot formatters. Migrate chord symbols, voltas, tempo marks, tuplet numbers.                                   | Med  |
| 4     | Public template-replacement API (`registerComponent(name, tree)`); schema versioning; preset bundles (Henle, Bärenreiter, Universal Edition).               | Med  |
| 5     | (Maybe) Layout-driven conditionals / container queries. Defer until forced.                                                                                 | High |

Stages 1+2 already solve "house styles". Stage 3 unlocks compression
and data-adaptive labelling. Stage 4 makes it a real plugin ecosystem.

## Open questions

- **Style cascade scope** — do styles cascade across `Component`
  boundaries, or do components start a fresh inheritance frame? React
  uses the former for context but the latter for props; CSS uses the
  former. Recommendation: cascade across (CSS-like), explicit reset
  available.
- **Decoration rendering** — boxes / circles / brackets around text
  are part of `BoxProps` decoration. Do we draw them as
  `RenderCommand::DrawRect` / `DrawCircle` (already exists for
  staccato), or introduce a new `DrawDecoration` command? Lean: reuse
  existing primitives.
- **Localization** — `{part.name | translate("de-DE")}` formatter? Or
  out of scope and handled at the MNX data layer? Lean: out of scope;
  users localise their score data.
- **Auto-layout adjacency** — if two adjacent rehearsal marks would
  collide, who handles it? Lean: collision avoidance stays in the
  existing collision-avoidance pass; this subsystem only positions
  within its own bounding box.
- **Hit testing** — selection / click handling on text elements. Lean:
  every emitted `DrawText` carries the same element ID it does today;
  hit testing is the renderer's job, unchanged.

## Cross-references

- Current player-label code: [engine/viritura-engine/src/layout/mnx_layout.rs:2007-2098](../../engine/viritura-engine/src/layout/mnx_layout.rs#L2007-L2098)
- `RenderCommand::DrawText` definition: [engine/viritura-engine/src/render.rs:280](../../engine/viritura-engine/src/render.rs#L280)
- Condensing engraving (consumer of player labels): [docs/spec/condensing-and-doubling.md](../spec/condensing-and-doubling.md)
- Related future work — engrave-mode style cascade: [docs/spec/engrave-mode.md](../spec/engrave-mode.md)

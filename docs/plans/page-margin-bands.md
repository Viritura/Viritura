# Page Margins: the `margin / inset / frame` band model

> **Status: planned (Jun 2026). Slice 1 in progress.** Paged mode only —
> horizon/galley is explicitly out of scope. This doc is the single source of
> truth for the page-vertical-band refactor; the design was settled
> interactively and the plumbing mapped by a full read of the layout pipeline.

## Why

Today a page's first system has its first staff line at
`page_margin_top + above_extras[first]` and (on a justified page) the last
system's last staff line floats _up_ by `below_extras[last]`. So two facing
pages whose first/last systems carry different protrusions (tempo marks, ledger
lines, dynamics) get **misaligned** top and bottom staff lines across the
spread. The engine "calculates based on system extremes and shifts content
around" — correct for _interior_ systems (uniform inter-system whitespace) but
wrong for the first and last, which have no neighbour to be uniform with.

There is already a _partial_ fix: `pad_top` in
[`compute_system_y_positions`](../../engine/viritura-engine/src/layout/page.rs)
adds **half** the `(below_last − above_first)` protrusion asymmetry — but only on
**ragged** pages (justified pages set it to 0). This refactor generalises that
hack into a clean, named band model.

## The model (CSS box-model, minus `border`)

Three nested bands per page, outer → inner:

```
┌──────────────────────────────── paper edge
│  margin           page # · V.S. page-turn hint  (ONLY furniture; exempt from clamp)
│ ┌───────────────── margin inner edge
│ │ inset           markings · dynamics · ledger lines · header/footer text
│ │┌──────────────── frame top  ← first system's FIRST staff line anchors here
│ ││  ═══════════════
│ ││        ⋮         (music)
│ ││  ═══════════════
│ │└──────────────── frame bottom ← last system's LAST staff line (when justified)
│ │ inset
│ └───────────────── margin inner edge
│  margin
└──────────────────────────────── paper edge
```

| Band     | Role                                                                                                                        | Config                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `margin` | blank edge; page numbers + V.S. hints live here, **exempt** from the music clamp                                            | **explicit** (`page_margin_*`, today 15/15/15/10 sp) |
| `inset`  | breathing room the music _intentionally_ extends into: above/below markings, dynamics, **ledger lines**, header/footer text | **auto** (default) or **manual**                     |
| `frame`  | the music box; staff **lines** anchor to it                                                                                 | **derived** — never configured                       |

Derivation (CSS content-box):

```
frame_top    = margin_top    + inset_top
frame_bottom = page_height - margin_bottom - inset_bottom
```

### Naming rationale

`margin / inset / frame`. `inset` was chosen over `padding` (CSS padding is
_keep-clear_ space — wrong, because music **intentionally** lives in this band)
and over `overhang` / `allowance`. `frame` is a derived name for the content
box, not a knob or a band — its border _is_ the inner edge of `inset`.

## `inset`: automatic vs manual (no hybrid)

Each side (top/bottom) is independently one of:

- **Automatic** (default): the frame is fit to **maximise** itself while keeping
  all protrusions inside `margin`. There is no fixed reserve — `inset` is the
  _measured_ leftover. This is exactly today's behaviour for a single page:
  `inset_top = above_extras[first]` ⇒ `frame_top = margin_top +
above_extras[first]` = today's `staff_y`, byte-for-byte.
- **Manual**: a fixed reserve. Content clips/overflows past it like any fixed
  margin.

**No "manual baseline + dynamic extra" hybrid.** Auto = fit to the worst
protrusion; manual = use the number.

### Per-spread resolution (the one real behavioural change)

Auto `inset` is resolved **per spread** (two facing pages), not per page:

```
inset_top    = max over the spread's pages of (first-system above-extent)
inset_bottom = max over the spread's pages of (last-system below-extent)
```

Both pages in a spread take the spread-max, so their first-top and last-bottom
staff lines align. A page that is alone in its spread (see grouping) reproduces
today's output exactly — **no visible reflow** for single-page-per-spread cases.

### Why this is a generalisation, not a rewrite

`pad_top` already does _half_ of `(below_last − above_first)` on ragged pages.
The new model does the _full_ asymmetry, on _all_ pages, anchoring the staff
**line** (not the bbox) to the frame — and shares the inset across a spread.

## Spread grouping — driven by the page-turn algorithm

We do **not** hardcode `first_page_recto`. Spread membership comes from the
**page-turn optimiser's chosen plan**, which already decides both `title_page`
(standalone title page or not) and `first_page_recto`
([`optimizer.rs::TurnPlan`](../../engine/viritura-engine/src/layout/page_turn/optimizer.rs)).

- When a page-turn plan ran (parts, page turns enabled): spreads follow the
  plan's `first_page_recto`. With a standalone title page the plan naturally
  yields `(title alone), (1,2), (3,4)…`; otherwise `(0,1), (2,3)…`. This keeps
  the existing "automatically switch between standalone title page or not based
  on the best page-turn algorithm" behaviour as the single source of parity.
- When no plan ran (full score, or page turns off): fall back to a default
  parity (lone-recto first page when a title block is present, else `(0,1)…`).

**Plumbing gap:** `ForcedPagination`
([`page_turn.rs`](../../engine/viritura-engine/src/layout/page_turn.rs))
currently surfaces `title_page` but **not** `first_page_recto`. Slice 1 adds it.

## Exemptions (no spread matching)

- **Title / first page** — its own spread, exempt from equal-within-spread
  (titled pages conventionally differ). Decided by the page-turn plan's
  `title_page`.
- **Pages carrying header/footer text** (title, copyright) — self-inset to fit
  the text; the facing page is unaffected. Existing `title_height_px` page-0
  `extra` is the seam.

So "equal within spread" applies **only** to plain music spreads (no furniture
text, not the title page).

## Emergent instrument awareness (free)

Top-heavy vs bottom-heavy parts need no instrument→band table: a violin part's
upward ledger lines produce a tall _above_ extent, a tuba's a tall _below_
extent, and the per-spread `max` allocates the asymmetric band automatically
from the **measured** extents. (A _predictive_ per-instrument default — so the
frame doesn't jump on the first ledger-heavy bar — is deferred.)

## Plumbing map (from the pipeline read)

- **Vertical positioning:** `compute_system_y_positions`
  ([page.rs L262](../../engine/viritura-engine/src/layout/page.rs)). Returns
  per-system **bbox tops**; `pad_top` (~L508) is the existing partial fix.
- **Two staff-Y call sites,** both `staff_y = positions[i] + above_extras[i]`:
  single-staff [layout.rs ~L807](../../engine/viritura-engine/src/layout.rs);
  multi-staff
  [auto_flow.rs ~L2173](../../engine/viritura-engine/src/layout/mnx_layout/auto_flow.rs)
  (then per-staff offsets). The change lands _inside_
  `compute_system_y_positions`; call sites stay as-is.
- **Config:** `page_margin_{top,bottom,left,right}` = 15/15/15/10 sp
  ([config.rs](../../engine/viritura-engine/src/layout/config.rs)). `margin_top`
  (5 sp) is **horizon-only** and vestigial for pages. No `inset` field yet.
- **TS persistence:** `PageSetup.margins{top,right,bottom,left}` (mm) in
  [`core/model/layout.ts`](../../packages/core/src/model/layout.ts), via
  `_x.viritura.pageSetup`, reaching the engine as `pageSetupJson`. `inset` to be
  added here (auto by default) in a later slice.
- **Furniture:** page numbers at `y = page.y_offset + page_margin_top*sp*0.45`
  ([page.rs ~L880](../../engine/viritura-engine/src/layout/page.rs)) — already in
  the margin band. V.S. hints are **computed but never drawn**.
- **Title:** `title_block_height()` → `title_height_px` page-0 `extra`. **No
  footer/copyright rendering exists today.**

## Slices

### Slice 1 — core frame model (in progress)

- Add `inset` config to `LayoutConfig`: `page_inset_top/bottom`, each
  `Auto | Manual(f64)` (an `Option<f64>` where `None` = auto, or a small enum).
- Surface `first_page_recto` from the page-turn plan through
  `ForcedPagination`.
- Compute per-spread `inset_top/bottom` inside `compute_system_y_positions`
  (or a helper feeding it), grouping pages into spreads from the plan parity
  (fallback when no plan). Anchor first staff line to `frame_top`; justify
  interior systems to `frame_bottom` (staff-line, not bbox, at the bottom).
- Generalise/replace `pad_top` with the frame anchoring.
- **Acceptance:**
  - Single-page-per-spread scores: **byte-identical** display list to today.
  - Two-page plain-music spreads: first-system top staff line and last-system
    bottom staff line are **equal across the spread**.
  - Title page exempt; header/footer pages self-inset.
  - Both call-site paths (single-staff, multi-staff auto-flow) validated.
  - `cargo test -p viritura-engine --lib` green (update absolute-Y expectations
    in `test_vertical_spacing.rs` / `test_page_system.rs` only where the spread
    alignment legitimately changed them).

### Slice 2 — furniture band

- Confirm page-number placement against the `margin` band.
- Render V.S. page-turn hints into the furniture band (currently computed,
  never drawn). Exempt from the frame clamp.

### Slice 3 — header/footer in the inset band

- Render footer/copyright text inside the `inset` band.
- Per-page frame inset on pages carrying header/footer text (no spread match).
- Expose `inset` (auto/manual) in the TS `PageSetup` + Page Setup UI.

## Regression surface

`test_vertical_spacing.rs` (many `staff_y == margin_top*sp` asserts),
`test_page_system.rs` (page dims / `y_offset` / usable height),
`test_full_score.rs`, `test_page_turns.rs`. Single-page cases must stay green;
multi-page spreads get updated expectations. The
[explicit-pages staff_y_offsets shadowing trap](../../engine/viritura-engine/src/layout/mnx_layout/auto_flow.rs)
(repo memory) flags the multi-staff path's squish ceiling as fragile — validate
both paths.

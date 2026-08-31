use crate::layout::page_turn::PageTurnConfig;
use crate::layout::placement_metrics::PlacementTable;
use crate::layout::text_styles::TextStylesheet;
use crate::model::time::TimeSignatureSettings;

/// Music-frame inset policy for one edge (top or bottom) of a page. See
/// `docs/plans/page-margin-bands.md`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PageInset {
    /// Fit the frame to the actual protrusions, resolved per spread so facing
    /// pages' first/last staff lines align. Reproduces today's layout for a
    /// page that is alone in its spread.
    Auto,
    /// Reserve a fixed band of `sp` staff-spaces regardless of content.
    Manual(f64),
}

/// Layout configuration.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutConfig {
    /// Pixels per spatium (staff space).
    pub sp: f64,
    /// Left margin in spatium.
    pub margin_left: f64,
    /// Top margin in spatium (space above the top staff line within a system).
    pub margin_top: f64,
    /// Right margin in spatium.
    pub margin_right: f64,
    /// Staff line width in spatium.
    pub staff_line_width: f64,
    /// Stem width in spatium.
    pub stem_width: f64,
    /// Stem length in spatium.
    pub stem_length: f64,
    /// Notehead width in spatium.
    pub notehead_rx: f64,
    /// Notehead height in spatium.
    pub notehead_ry: f64,
    /// Minimum center-to-center note spacing in spatium.
    /// Must be >= notehead_w (1.18) + gap (~0.3) = ~1.5sp to prevent notehead overlap.
    /// The ledger-line renderer clips extensions dynamically, so we don't need
    /// to reserve the full 2×ledger_extension here.
    /// standard engraving practice minNoteDistance=0.25sp (gap only); our value includes notehead.
    pub min_note_spacing: f64,
    /// Ledger line extension beyond notehead in spatium.
    pub ledger_extension: f64,
    /// Ledger line thickness in spatium (Bravura: legerLineThickness = 0.16).
    pub ledger_line_width: f64,
    /// Minimum horizontal gap between adjacent ledger lines in spatium.
    /// Ref: standard engraving practice `gap` property (default 0.1).
    pub ledger_gap: f64,
    /// Barline width in spatium.
    pub barline_width: f64,
    /// Whether to collapse consecutive full-measure rests into multimeasure rests.
    pub multimeasure_rests: bool,
    /// Total page height in spatium (A4 ≈ 297 sp at 1sp=1mm).
    pub page_height: f64,
    /// Top margin of each page in spatium (≈ 15mm on A4).
    pub page_margin_top: f64,
    /// Bottom margin of each page in spatium (≈ 15mm on A4).
    pub page_margin_bottom: f64,
    /// Left margin of each page in spatium (≈ 15mm on A4).
    pub page_margin_left: f64,
    /// Right margin of each page in spatium (≈ 10mm on A4).
    pub page_margin_right: f64,
    /// Music-frame inset at the top of the page (the `inset` band between the
    /// `margin` and the staff-line `frame`; see
    /// `docs/plans/page-margin-bands.md`). `Auto` fits the frame to the actual
    /// above-staff protrusions per spread (the default, reproducing today's
    /// layout for a standalone page); `Manual(sp)` reserves a fixed band.
    pub page_inset_top: PageInset,
    /// Music-frame inset at the bottom of the page (below-staff protrusions:
    /// dynamics, low ledger lines, …). See [`Self::page_inset_top`].
    pub page_inset_bottom: PageInset,
    /// Vertical spacing between systems on the same page in spatium
    /// (default ≈ 3 staff heights = 12 sp).
    pub inter_system_spacing: f64,
    /// Available page width in pixels for system breaking.
    /// When Some, measures are distributed across multiple systems.
    /// When None, all measures are placed on a single system.
    pub page_width: Option<f64>,
    /// Horizon-mode (un-paged, `page_width = None`) chunking width in pixels.
    ///
    /// When `Some(w)`, the single horizon mega-system is internally broken into
    /// independently-retainable *chunks* sized to `w`, laid out at continuous x
    /// and a shared y (one horizontal galley) with all system-seam furniture
    /// (clef/key restatement, system-start barline, labels, brackets) suppressed
    /// at chunk boundaries. The rendered output is byte-identical to the
    /// single-system layout (`None`); chunking exists purely so per-system
    /// retention + viewport culling re-engage on heavy scores. Ignored when
    /// `page_width` is `Some` (paged mode already chunks into systems).
    pub horizon_chunk_width: Option<f64>,
    /// Base space allocated for the shortest note duration in spatium.
    /// This is the minimum horizontal space any note column occupies.
    pub shortest_duration_space: f64,
    /// Additional space per log2 doubling of duration in spatium.
    /// Controls how much wider longer notes are compared to shorter ones.
    pub spacing_increment: f64,
    /// Distance from stem tip to first close-to-note articulation (spatium).
    pub artic_distance_stem: f64,
    /// Distance from notehead to first close-to-note articulation (spatium).
    pub artic_distance_head: f64,
    /// Minimum distance between stacked articulations (spatium).
    pub artic_min_distance: f64,
    /// Kerning reduction when staccato and accent are stacked together (spatium).
    pub artic_staccato_accent_kern: f64,

    // ── Tie parameters (shared curve model with slurs) ──────────
    /// Tie base midpoint thickness in spatium (thinner than slurs).
    pub tie_thickness: f64,
    /// Tie minimum thickness for very short ties in spatium.
    pub tie_min_thickness: f64,
    /// Tie *endpoint* thickness in spatium (tapered tips). Matches
    /// `slur_endpoint_thickness` by default: a tie and a slur are the same
    /// engraved stroke, so their tips carry the same weight.
    pub tie_endpoint_thickness: f64,
    /// Tie height asymptote in staff spaces (like slur h_inf, but lower).
    pub tie_height_inf: f64,
    /// Tie rise-rate ratio (like slur r₀, but lower for flatter arcs).
    pub tie_rise_rate: f64,
    /// Tie control-point indent (fraction of chord; 0.20 = rounder than slur's 0.15).
    pub tie_cp_indent: f64,
    /// L.v. tie midpoint thickness in spatium.
    pub lv_tie_thickness: f64,

    // ── Slur parameters ───────────────────────────────────────────
    /// Slur base midpoint thickness in spatium.
    pub slur_thickness: f64,
    /// Slur minimum thickness for very short slurs in spatium.
    pub slur_min_thickness: f64,
    /// Slur height asymptote in staff spaces.
    pub slur_height_inf: f64,
    /// Slur rise-rate ratio.
    pub slur_rise_rate: f64,
    /// Slur control-point indent (fraction of chord; 0.15 = steep departure).
    pub slur_cp_indent: f64,
    /// Slur shoulder height cap (spatium). Prevents runaway shoulders over tall
    /// obstacles; once needed shoulder exceeds this, the slur is allowed to
    /// overlap rather than balloon. standard engraving practice.
    pub slur_shoulder_max: f64,
    /// Slur *endpoint* thickness in spatium (tapered tips).
    /// Currently informational only — the `DrawFilledBezier` render command
    /// uses a single shared endpoint per side so taper is not yet realised.
    /// TODO(S10): extend the render protocol with `ix1,iy1,ix2,iy2`
    /// (inner endpoints distinct from outer) and apply this taper at
    /// `compute_slur_bezier`. Default 0.10sp per Bravura engravingDefaults.
    pub slur_endpoint_thickness: f64,

    // ── Dynamics parameters ───────────────────────────────────────
    /// Minimum distance from bottom staff line to dynamics baseline (spatium).
    pub dynamics_min_distance: f64,
    /// Padding between lowest below-staff element and dynamics (spatium).
    pub dynamics_padding: f64,

    // ── Text expression parameters ──────────────────────────────
    /// Minimum distance from bottom staff line to expression baseline (spatium).
    pub expression_min_distance: f64,
    /// Extra padding below dynamics for expression text (spatium).
    pub expression_below_dynamics_padding: f64,

    // ── Breath mark parameters ────────────────────────────────────
    /// Distance above the top staff line for breath marks (spatium).
    pub breath_mark_above_staff: f64,
    // ── Fermata parameters ────────────────────────────────────────
    /// Distance above the top staff line for fermatas (spatium).
    /// This is the default placement when no notes lie outside the staff.
    pub fermata_above_staff: f64,
    /// Minimum clearance between a fermata and the nearest notehead/stem
    /// when the note (or its stem tip) lies outside the staff (spatium).
    /// Ref: standard engraving practice — fermatas keep ~1sp from outlying noteheads.
    pub fermata_note_clearance: f64,
    // ── Trill parameters ──────────────────────────────────────────
    /// Distance above the top staff line for trills (spatium).
    pub trill_above_staff: f64,
    // ── Ornament parameters ───────────────────────────────────────
    /// Distance above the top staff line for ornaments (spatium).
    pub ornament_above_staff: f64,

    // ── Glissando parameters ──────────────────────────────────────
    /// Glissando line width in spatium (straight glissandos only — a wavy
    /// glissando is drawn from the SMuFL `wiggleGlissando` segment, whose
    /// stroke weight is baked into the font).
    pub glissando_line_width: f64,
    // ── Arpeggio parameters ───────────────────────────────────────
    /// Horizontal offset from notehead left edge to arpeggio line (spatium).
    pub arpeggio_offset: f64,
    // ── Fingering parameters ──────────────────────────────────────
    /// Distance from notehead to fingering glyph (spatium).
    pub fingering_distance: f64,
    /// Font size scale for fingering glyphs (relative to normal glyph size).
    pub fingering_font_scale: f64,
    // ── Caesura parameters ──────────────────────────────────────────
    /// Distance above the top staff line for caesura marks (spatium).
    pub caesura_above_staff: f64,
    // ── Pedal parameters ──────────────────────────────────────────
    /// Minimum distance below the bottom staff line for pedal markings (spatium).
    pub pedal_min_distance: f64,
    /// Line width for pedal bracket lines (spatium).
    pub pedal_line_width: f64,
    /// Hook height for pedal bracket end hooks (spatium).
    pub pedal_hook_height: f64,

    // ── Debug ──────────────────────────────────────────────────────
    /// When true, the layout pipeline emits a `LayoutDebugInfo` sidecar
    /// on the resulting `DisplayList` describing per-system bounding boxes,
    /// above/below extras, per-measure protrusion extremes, and inter-staff
    /// gap reasoning. Used by the editor's spacing debug overlay.
    pub emit_layout_debug: bool,

    // ── Vertical squish (orchestral overflow) ──────────────────────
    /// Hard floor for the intra-staff gap (spatium) when a system would
    /// otherwise overflow the usable page height. Default ≈ 3sp; below
    /// this, engraving becomes uncomfortable and we accept overflow
    /// instead. Used by the "soft squish" pass in `compute_system_y_positions`.
    pub min_intra_staff_squish: f64,
    /// Hard floor for content-aware inter-staff clearance (spatium) when a
    /// system is being squished to fit. Default ≈ 0.5sp; the content-aware
    /// floor `min_clearance` shrinks proportionally with the squished gap
    /// but never below this value.
    pub min_intra_staff_clearance: f64,
    /// Default content-aware clearance floor (spatium) between adjacent
    /// staves' content within a system. Used by the explicit-systems
    /// vertical placement code (Phase 2). Squish reduces this proportionally.
    pub default_intra_staff_clearance: f64,
    /// Per-document text styles (title, tempo, staff labels, …). Defaults
    /// reproduce the built-in engraving values; documents may override any
    /// subset via the `_x.viritura.textStyles` vendor extension.
    pub text_styles: TextStylesheet,

    /// Per-dependent placement metrics (attach/stack gaps, side bearings) keyed
    /// by [`crate::render::ElementKind`]. Defaults reproduce the built-in
    /// engraving values; documents may override any subset via the
    /// `_x.viritura.placement` vendor extension. This is the consolidation
    /// target for the scattered `*_min_distance` / `*_padding` constants — they
    /// migrate here one dependent at a time (see
    /// `docs/plans/horizontal-collision-avoidance.md`).
    pub placement: PlacementTable,

    /// Auto page-turn pagination config. Default-disabled; when enabled (and
    /// the layout is paged) the optimizer chooses page breaks that balance
    /// page density against page-turn quality. See `layout::page_turn`.
    pub page_turns: PageTurnConfig,

    /// How this layout engraves its time signatures. Resolved once per layout
    /// from the document's `_x.viritura.timeSignatures` and the layout's
    /// context (a full score or one player's part), so every downstream pass
    /// — widths, rendering, hitboxes — reads the same answer. Because it
    /// lives on the config, changing it invalidates the layout cache through
    /// the existing config snapshot check.
    pub time_signature_settings: TimeSignatureSettings,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        // The placement table is the single source of truth for per-dependent
        // clearances. `dynamics_min_distance` below is sourced from it so the
        // value flows from the descriptor (and `placementDefaults.json`) rather
        // than a free-standing literal. Other dependents migrate the same way.
        let placement = PlacementTable::default();
        let dynamics_min_distance = placement
            .resolve(crate::render::ElementKind::Dynamic)
            .attach_gap;
        // Below-staff text expressions anchor at their own `attach_gap` too, so
        // the min-distance flows from the descriptor rather than a free literal.
        let expression_min_distance = placement
            .resolve(crate::render::ElementKind::Expression)
            .attach_gap;
        // Above-staff / stacking distances likewise flow from the descriptor.
        // `attach_gap` carries the old `*_above_staff` clearance; the
        // articulation stacking gap rides on its `padding.vertical`.
        use crate::render::ElementKind;
        let breath_mark_above_staff = placement.resolve(ElementKind::BreathMark).attach_gap;
        let fermata_above_staff = placement.resolve(ElementKind::Fermata).attach_gap;
        let trill_above_staff = placement.resolve(ElementKind::Trill).attach_gap;
        let ornament_above_staff = placement.resolve(ElementKind::Ornament).attach_gap;
        let caesura_above_staff = placement.resolve(ElementKind::Caesura).attach_gap;
        let artic_min_distance = placement
            .resolve(ElementKind::Articulation)
            .padding
            .vertical;
        // Pedals are connectors, but their below-staff anchor distance is
        // table-driven too (`pedal.attachGap`) so it flows from the descriptor
        // rather than a free literal.
        let pedal_min_distance = placement.resolve(ElementKind::Pedal).attach_gap;
        Self {
            sp: 12.0,
            margin_left: 5.0,
            margin_top: 5.0,
            margin_right: 5.0,
            staff_line_width: 0.13,
            stem_width: 0.12,
            stem_length: 3.5,
            notehead_rx: 0.59, // half of 1.18
            notehead_ry: 0.45, // half of 0.9
            min_note_spacing: 1.5,
            ledger_extension: 0.4, // Bravura engravingDefaults.legerLineExtension
            ledger_line_width: 0.16, // Bravura engravingDefaults.legerLineThickness
            ledger_gap: 0.1,       // standard engraving practice gap
            barline_width: 0.16,   // Bravura engravingDefaults.thinBarlineThickness
            multimeasure_rests: false,
            // A4 paper (portrait): 297mm tall = 297 sp (1sp=1mm)
            page_height: 297.0,
            // 15mm margins top/bottom, 15mm left, 10mm right
            page_margin_top: 15.0,
            page_margin_bottom: 15.0,
            page_margin_left: 15.0,
            page_margin_right: 10.0,
            // Auto frame inset: fit to protrusions per spread (reproduces the
            // pre-band layout for a standalone page).
            page_inset_top: PageInset::Auto,
            page_inset_bottom: PageInset::Auto,
            // ~3 staff heights between systems
            inter_system_spacing: 12.0,
            page_width: None,
            horizon_chunk_width: None,
            // Preferred natural spacing baseline. With 2.0 sp base + 1.0 sp
            // per log₂ doubling, a quarter in 16th-rich music gets ~4 sp,
            // matching standard defaults. The 1.5 sp `min_note_spacing`
            // floor below is the *absolute* minimum and is only reached
            // when a system is compressed by `compute_justified_system_widths`
            // to fit page width. It sits just above the 1.18 sp notehead
            // width so adjacent noteheads keep a small gap even when fully
            // compressed. Earlier we ran at 1.6 sp natural for
            // tightness, but it removed too much breathing room in
            // un-paged (galley/storybook) views; compression should happen
            // at the page level, not in the natural baseline.
            shortest_duration_space: 2.0,
            // ~1.0 sp added per log2 doubling of duration
            spacing_increment: 1.0,
            artic_distance_stem: 0.5,
            artic_distance_head: 0.5,
            // Articulation stacking gap — sourced from the placement table
            // (`articulation.padding.vertical`). See top of fn.
            artic_min_distance,
            artic_staccato_accent_kern: 0.2,
            // Ties: thickness matches slur thickness for visual consistency.
            tie_thickness: 0.30,
            tie_min_thickness: 0.1,
            tie_endpoint_thickness: 0.10,
            tie_height_inf: 1.2,
            tie_rise_rate: 0.20,
            tie_cp_indent: 0.20,
            lv_tie_thickness: 0.30,
            // Slur thickness 0.30 sp (industry-standard engravers weight — visually
            // heavier than Bravura's nominal 0.22 sp midpoint, which reads as
            // a hairline at typical screen rendering).
            slur_thickness: 0.30,
            slur_min_thickness: 0.1,
            // Original Viritura defaults. (Brief experiments bumping these to
            // make slurs taller produced rainbow-arc 2-note slurs; reverting
            // here keeps natural proportions.)
            slur_height_inf: 2.0,
            slur_rise_rate: 0.33,
            slur_cp_indent: 0.15,
            slur_shoulder_max: 3.2,
            slur_endpoint_thickness: 0.10,
            // Dynamics: minimum 3.0sp below bottom staff line for clear
            // separation. Sourced from the placement table (see top of fn).
            dynamics_min_distance,
            dynamics_padding: 1.5,
            // Text expressions: placed below dynamics. Min-distance sourced from
            // the placement table (`expression.attachGap`). See top of fn.
            expression_min_distance,
            expression_below_dynamics_padding: 1.0,
            // Breath marks: above the top staff line. Sourced from the
            // placement table (`breathMark.attachGap`). See top of fn.
            breath_mark_above_staff,
            // Fermatas: above the top staff line (the glyph baseline is
            // the bottom of the fermata curve, so the curve sits ~1sp clear of
            // the staff — standard practice). Sourced from the placement table
            // (`fermata.attachGap`).
            fermata_above_staff,
            fermata_note_clearance: 1.0,
            // Trills: above the top staff line. Sourced from the placement
            // table (`trill.attachGap`).
            trill_above_staff,
            // Ornaments: above the top staff line. Sourced from the placement
            // table (`ornament.attachGap`).
            ornament_above_staff,
            // Glissando: thin straight line
            glissando_line_width: 0.12,
            // Arpeggio: 0.8sp left of the leftmost notehead
            arpeggio_offset: 0.8,
            // Fingerings: 0.5sp from notehead, 70% of normal glyph size
            fingering_distance: 0.5,
            fingering_font_scale: 0.7,
            // Caesura: above the top staff line (sits on/near top line).
            // Sourced from the placement table (`caesura.attachGap`).
            caesura_above_staff,
            // Pedal markings: below-staff anchor distance from the placement
            // table (`pedal.attachGap`, default 5.0sp) — below dynamics/hairpins.
            pedal_min_distance,
            pedal_line_width: 0.16, // Bravura engravingDefaults.pedalLineThickness
            pedal_hook_height: 1.0,
            emit_layout_debug: false,
            min_intra_staff_squish: 3.0,
            min_intra_staff_clearance: 0.5,
            default_intra_staff_clearance: 2.0,
            text_styles: TextStylesheet::default(),
            placement,
            page_turns: PageTurnConfig::default(),
            time_signature_settings: TimeSignatureSettings::default(),
        }
    }
}

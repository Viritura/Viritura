#![allow(unused_imports)]

use super::*;
use serde::{Deserialize, Serialize};

/// Axis-aligned bounding box for a rendered element.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl BoundingBox {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// Create a bounding box that encloses both `self` and `other`.
    pub fn union(&self, other: &BoundingBox) -> BoundingBox {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        let right = (self.x + self.width).max(other.x + other.width);
        let bottom = (self.y + self.height).max(other.y + other.height);
        BoundingBox {
            x,
            y,
            width: right - x,
            height: bottom - y,
        }
    }

    /// Test whether a point (px, py) is inside this bounding box.
    pub fn contains(&self, px: f64, py: f64) -> bool {
        px >= self.x && px <= self.x + self.width && py >= self.y && py <= self.y + self.height
    }
}

/// A bounding box associated with a logical element via its ID.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementBBox {
    pub element_id: String,
    pub bbox: BoundingBox,
}

/// Coarse classification of a rendered element used by the collision / shape
/// registry. Lets consumers (slur scorer, hairpin clearance, etc.) filter the
/// shape list by kind without parsing element-id suffixes.
///
/// New variants are cheap — add one per logical glyph class so different
/// engraving passes can ask for "only stems" or "only accidentals" with one
/// integer compare per entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ElementKind {
    Notehead,
    Stem,
    Beam,
    Tuplet,
    Flag,
    LedgerLine,
    Accidental,
    AugmentationDot,
    Articulation,
    Fermata,
    Tremolo,
    Slur,
    Tie,
    Lyric,
    Dynamic,
    Hairpin,
    Pedal,
    Volta,
    /// Octave-displacement spanner (`8va`/`8vb`). Connector.
    Ottava,
    /// Glissando/portamento line between two noteheads. Connector.
    Glissando,
    /// Clef glyph (treble, bass, …). Substrate furniture.
    Clef,
    /// Key signature accidental group. Substrate furniture.
    KeySig,
    /// Time signature. Substrate furniture.
    TimeSig,
    /// Barline. Substrate furniture.
    Barline,
    /// Tempo marking (e.g. "Allegro ♩ = 120"). Dependent.
    Tempo,
    /// Rehearsal mark (boxed letter/number). Dependent.
    RehearsalMark,
    /// Measure number. Dependent.
    MeasureNumber,
    /// Free-text expression ("dolce", "cresc."). Dependent.
    Expression,
    /// Chord symbol ("Cmaj7"). Dependent.
    ChordSymbol,
    /// Segno sign. Dependent.
    Segno,
    /// Coda sign. Dependent.
    Coda,
    /// Fine marker. Dependent.
    Fine,
    /// Jump instruction (D.C., D.S., …). Dependent.
    Jump,
    /// Ornament glyph (turn, mordent, …) tracked as a stacking bbox. Dependent.
    Ornament,
    /// Trill mark (`tr`, with optional wavy extension). Dependent.
    Trill,
    /// Breath mark (comma) above the staff. Dependent.
    BreathMark,
    /// Caesura ("railroad tracks") above the staff. Dependent.
    Caesura,
    /// Anything that doesn't fit a more specific category yet. Producers should
    /// prefer adding a new variant once a third consumer needs to filter for it.
    Other,
}

/// The placement category an element belongs to in the layout/positioning
/// system. See `docs/plans/horizontal-collision-avoidance.md` for the full
/// taxonomy. The three roles are distinguished by anchor count, freedom of
/// movement, and the direction in which they read/emit the keep-out field:
///
/// - [`FieldRole::Substrate`] — the music itself. One semantic anchor, immovable
///   (except via a space request), **emits** the keep-out field and never reads
///   one. Noteheads, stems, accidentals, clefs, …
/// - [`FieldRole::Connector`] — spans **two** substrate anchors; reshapes its
///   interior but cannot relocate. Reads substrate, emits to dependents, is
///   never moved by a dependent. Slurs, ties, hairpins, …
/// - [`FieldRole::Dependent`] — a floater with one anchor. Reads the field
///   (substrate + connectors + earlier dependents), displaces within a bounded
///   allowance, then rejoins the field. Dynamics, tempo, expressions, …
///
/// Clearance/padding is owned entirely by the **dependent** that avoids an
/// element; substrate and connectors contribute boundary geometry only (their
/// ink is their boundary). Asymmetric "stay away from me" cases are modelled as
/// forbidden zones or snap rules, never as emitter-side padding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldRole {
    Substrate,
    Connector,
    Dependent,
}

impl ElementKind {
    /// The placement category this kind belongs to, or `None` for kinds that do
    /// not participate in the keep-out field (the catch-all [`Self::Other`],
    /// which now only covers bare event ids and genuinely unrecognized glyphs).
    ///
    /// Anchor *count* is not the substrate/connector discriminator — `Beam`,
    /// `Tremolo` (multi-note), `Tie`, `Slur`, and `Hairpin` all span two
    /// anchors. The test is *when the shape is fixed*: substrate geometry is
    /// chosen by a substrate-internal pass that runs **before** the field
    /// exists (pitch, stems, beam slope, tremolo strokes), so downstream
    /// consumers treat it as emitted ink; a connector reshapes its interior
    /// **in response to** the field (a slur arches over articulations). Thus a
    /// multi-note tremolo is substrate like a beam — the stems accommodate it,
    /// it never relocates to avoid a dependent.
    pub fn field_role(self) -> Option<FieldRole> {
        use ElementKind::*;
        match self {
            Notehead | Stem | Beam | Tuplet | Flag | LedgerLine | Accidental | AugmentationDot
            | Tremolo | Clef | KeySig | TimeSig | Barline => Some(FieldRole::Substrate),
            Slur | Tie | Hairpin | Pedal | Volta | Ottava | Glissando => Some(FieldRole::Connector),
            Articulation | Fermata | Lyric | Dynamic | Tempo | RehearsalMark | MeasureNumber
            | Expression | ChordSymbol | Segno | Coda | Fine | Jump | Ornament | Trill
            | BreathMark | Caesura => Some(FieldRole::Dependent),
            // Genuine fallback: bare event ids and not-yet-classified glyphs.
            Other => None,
        }
    }

    /// True for the note-cluster "core" substrate kinds whose vertical extent is
    /// already bounded by the explicit note/stem extent walk that every
    /// below-staff collision consumer runs *before* its skyline pass. Those
    /// consumers exclude these from the skyline so the same ink isn't counted
    /// twice.
    ///
    /// This is a strict **subset** of [`FieldRole::Substrate`]: `Tremolo`
    /// (multi-note strokes) and any below-staff accidental are substrate too,
    /// but they are *not* part of the note/stem walk, so they must remain real
    /// skyline obstacles. That is why below-staff consumers filter on this
    /// predicate rather than on `field_role() == Some(Substrate)`.
    pub fn is_note_cluster_core(self) -> bool {
        use ElementKind::*;
        matches!(self, Notehead | Stem | Beam | Flag | LedgerLine)
    }
}

/// How an `ElementShape`'s geometry is stored.
///
/// `Cmd(idx)` is a zero-duplication reference into `DisplayList.commands` —
/// the shape's bbox is derived on demand via `RenderCommand::bbox()`. Use this
/// for primitives whose draw command coordinates ARE the geometry (noteheads,
/// stems, beams, simple rects). The shape entry stays in sync with the
/// command automatically, including engrave-mode handle drags.
///
/// `Rect(b)` stores the geometry explicitly. Use this for composite or
/// post-laid-out elements whose final extent isn't a single command's rect
/// (articulation stacks, slur hulls, measured text runs).
///
/// `Band { samples }` stores a piecewise-linear vertical band sampled along a
/// spine: each `(x, y_top, y_bottom)` column is the curve's local vertical
/// extent at that X, with samples sorted by ascending X. Use this for curved
/// connectors (slurs, ties, hairpins) so skyline/collision queries see the
/// *local* arc height at a given X rather than the pessimistic full bounding
/// box. A flat rectangle is just a two-sample band, so the skyline's
/// adjacent-buildings merge handles it natively (see `DisplayList::skyline_*`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShapeGeom {
    Cmd { cmd_idx: u32 },
    Rect { bbox: BoundingBox },
    Band { samples: Vec<(f64, f64, f64)> },
}

/// Spatial entry in the per-page shape registry. The collision / engraving
/// passes consume these instead of parsing render commands directly.
///
/// See `ShapeGeom` for the storage trade-off between command-ref and explicit
/// rect. `system_idx` / `staff_idx` are optional so producers that don't yet
/// know the system context can still publish — consumers fall back to
/// X-range / Y-range filters in that case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementShape {
    pub element_id: String,
    pub kind: ElementKind,
    pub geom: ShapeGeom,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_idx: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub staff_idx: Option<u32>,
}

impl ElementShape {
    /// Resolve the bbox by either looking it up in `commands` (for `Cmd`) or
    /// returning the stored rect (for `Rect`). Returns `None` if the
    /// referenced command index is out of bounds or its kind has no bbox.
    pub fn bbox(&self, commands: &[RenderCommand]) -> Option<BoundingBox> {
        match &self.geom {
            ShapeGeom::Cmd { cmd_idx } => commands.get(*cmd_idx as usize).and_then(|c| c.bbox()),
            ShapeGeom::Rect { bbox } => Some(bbox.clone()),
            ShapeGeom::Band { samples } => band_bbox(samples),
        }
    }

    /// Local vertical extent over the horizontal span `[x_min, x_max]`, as
    /// `(top_y, bottom_y)`. Returns `None` if the shape doesn't overlap the
    /// span (or has no resolvable geometry).
    ///
    /// For `Cmd`/`Rect` this is just the bbox's `(y, y + height)` when it
    /// overlaps — identical to the old whole-bbox behaviour. For `Band` it is
    /// the *local* min-top / max-bottom across only the samples (and the
    /// interpolated span endpoints) that fall within the span, so a shallow
    /// slur contributes its true arc height at each X rather than its global
    /// apex.
    pub fn span_extent(
        &self,
        commands: &[RenderCommand],
        x_min: f64,
        x_max: f64,
    ) -> Option<(f64, f64)> {
        match &self.geom {
            ShapeGeom::Band { samples } => band_span_extent(samples, x_min, x_max),
            _ => {
                let bb = self.bbox(commands)?;
                if bb.x + bb.width < x_min || bb.x > x_max {
                    return None;
                }
                Some((bb.y, bb.y + bb.height))
            }
        }
    }
}

/// Enclosing bounding box of a sampled band, or `None` if it has no samples.
fn band_bbox(samples: &[(f64, f64, f64)]) -> Option<BoundingBox> {
    let first = samples.first()?;
    let (mut x_lo, mut x_hi) = (first.0, first.0);
    let (mut y_lo, mut y_hi) = (first.1, first.2);
    for &(x, top, bottom) in samples {
        x_lo = x_lo.min(x);
        x_hi = x_hi.max(x);
        y_lo = y_lo.min(top.min(bottom));
        y_hi = y_hi.max(top.max(bottom));
    }
    Some(BoundingBox {
        x: x_lo,
        y: y_lo,
        width: x_hi - x_lo,
        height: y_hi - y_lo,
    })
}

/// Local `(top_y, bottom_y)` of a band over `[x_min, x_max]`. Samples are
/// assumed sorted by ascending X. Includes interpolated values at the span
/// endpoints so a band that straddles the span (with no sample inside it)
/// still contributes its profile.
fn band_span_extent(samples: &[(f64, f64, f64)], x_min: f64, x_max: f64) -> Option<(f64, f64)> {
    if samples.len() < 2 {
        let &(x, top, bottom) = samples.first()?;
        return (x >= x_min && x <= x_max).then_some((top.min(bottom), top.max(bottom)));
    }
    let band_lo = samples.first()?.0;
    let band_hi = samples.last()?.0;
    if band_hi < x_min || band_lo > x_max {
        return None;
    }
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    let mut seen = false;
    // Direct samples within the span.
    for &(x, t, b) in samples {
        if x >= x_min && x <= x_max {
            top = top.min(t.min(b));
            bottom = bottom.max(t.max(b));
            seen = true;
        }
    }
    // Interpolate at the clamped span endpoints so a wide segment crossing the
    // span still registers even when no sample lands inside it.
    for &edge in &[x_min.max(band_lo), x_max.min(band_hi)] {
        if let Some((t, b)) = band_interp(samples, edge) {
            top = top.min(t.min(b));
            bottom = bottom.max(t.max(b));
            seen = true;
        }
    }
    seen.then_some((top, bottom))
}

/// Linearly interpolate `(y_top, y_bottom)` at `x` between the two bracketing
/// samples. `x` is assumed within the band's X range; samples sorted by X.
fn band_interp(samples: &[(f64, f64, f64)], x: f64) -> Option<(f64, f64)> {
    let n = samples.len();
    if n == 0 {
        return None;
    }
    if x <= samples[0].0 {
        return Some((samples[0].1, samples[0].2));
    }
    if x >= samples[n - 1].0 {
        return Some((samples[n - 1].1, samples[n - 1].2));
    }
    for w in samples.windows(2) {
        let (x0, t0, b0) = w[0];
        let (x1, t1, b1) = w[1];
        if x >= x0 && x <= x1 {
            let span = (x1 - x0).abs();
            let f = if span < 1e-9 {
                0.0
            } else {
                (x - x0) / (x1 - x0)
            };
            return Some((t0 + (t1 - t0) * f, b0 + (b1 - b0) * f));
        }
    }
    None
}

/// Bezier geometry sidecar for a single slur.
///
/// Mirrors the *spine* cubic of the filled-crescent shape rendered by
/// `DrawFilledBezier`. Engrave mode reads this to paint drag-handle markers
/// and to hit-test drags without parsing the render commands. The outer/inner
/// contours used for the painted shape are reconstructible from the spine via
/// the perpendicular `thickness/2` offset (see `compute_slur_bezier`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlurGeometry {
    /// Element id (e.g. `slur/p0/m0/s0/ev1->p0/m0/s0/ev3`).
    pub element_id: String,
    /// Spine cubic endpoints + control points.
    pub p0_x: f64,
    pub p0_y: f64,
    pub p1_x: f64,
    pub p1_y: f64,
    pub p2_x: f64,
    pub p2_y: f64,
    pub p3_x: f64,
    pub p3_y: f64,
    /// Crescent thickness used to derive outer/inner contours.
    pub thickness: f64,
    /// +1.0 = curve below the chord; -1.0 = curve above.
    pub curve_dir: f64,
    /// Spatium (px-per-sp) used by the layout config that placed this slur.
    /// Engrave-mode tools use this to convert px-space handle drags into sp.
    pub sp: f64,
}

/// Layout bounds for a single measure, exported for the editor's cursor/ruler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasureBounds {
    /// Measure index (0-based).
    pub index: usize,
    /// Global measure ID (if assigned).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measure_id: Option<String>,
    /// Part index (0-based) — identifies the source part for note entry.
    pub part_index: usize,
    /// Visual staff index (0-based) — unique per staff in the layout, used for
    /// selection and overlay painting. Differs from part_index when expansion
    /// staves duplicate the same part.
    #[serde(default)]
    pub staff_index: usize,
    /// 0-based index of the system this measure belongs to. Used by the editor
    /// to group bounds per system without re-running the system breaker.
    #[serde(default)]
    pub system_index: usize,
    /// X position of the left barline.
    pub x: f64,
    /// Total width (right barline = x + width).
    pub width: f64,
    /// Y position of the top staff line.
    pub y: f64,
    /// Height of the staff (4 staff spaces = 4 * sp).
    pub height: f64,
    /// Width of the prefix area (clef, key sig, time sig). Content starts at x + prefix_width.
    pub prefix_width: f64,
    /// Total beats in the measure (from time signature).
    pub total_beats: f64,
    /// Beat→X anchor points: each entry is (beat_position, absolute_x).
    /// These are the actual positions used by the layout engine for note placement.
    pub beat_anchors: Vec<(f64, f64)>,
    /// True when this bound represents a ghost rail for a part that the
    /// effective layout omits at this system. The editor uses this to draw a
    /// faint placeholder and surface a "show staff" affordance.
    #[serde(default, skip_serializing_if = "is_false")]
    pub ghost_staff: bool,
    /// True when the part is hidden at this system. For ghost rails this is
    /// always true; for normal staves it is always false. Future divisi/ossia
    /// work may make this finer-grained than `ghost_staff`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_hidden: bool,
    /// True when a hidden part contains user-authored music (notes, lyrics,
    /// articulations, or non-trivial rests) within this system's measures.
    /// Editor renders a warning badge on the ghost-rail eye pill.
    #[serde(default, skip_serializing_if = "is_false")]
    pub has_music_hidden: bool,
    /// True when this bound represents a synthetic "expansion" (ghost) staff
    /// for a single source of a condensed multi-source staff. Editor uses this
    /// to route edits to that source directly (skipping condensing broadcast).
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_expansion: bool,
}

pub(super) fn is_false(v: &bool) -> bool {
    !*v
}

/// Helper for serde: skip serializing if value is 0.0.
pub(super) fn is_zero(v: &f64) -> bool {
    *v == 0.0
}

#[cfg(test)]
mod field_role_tests {
    use super::{ElementKind, FieldRole};

    #[test]
    fn substrate_kinds_emit_only() {
        for kind in [
            ElementKind::Notehead,
            ElementKind::Stem,
            ElementKind::Beam,
            ElementKind::Flag,
            ElementKind::LedgerLine,
            ElementKind::Accidental,
            ElementKind::AugmentationDot,
            ElementKind::Tremolo,
            ElementKind::Clef,
            ElementKind::KeySig,
            ElementKind::TimeSig,
            ElementKind::Barline,
        ] {
            assert_eq!(kind.field_role(), Some(FieldRole::Substrate), "{kind:?}");
        }
    }

    #[test]
    fn connector_kinds_span_two_anchors() {
        for kind in [
            ElementKind::Slur,
            ElementKind::Tie,
            ElementKind::Hairpin,
            ElementKind::Pedal,
            ElementKind::Volta,
            ElementKind::Ottava,
            ElementKind::Glissando,
        ] {
            assert_eq!(kind.field_role(), Some(FieldRole::Connector), "{kind:?}");
        }
    }

    #[test]
    fn dependent_kinds_float() {
        for kind in [
            ElementKind::Articulation,
            ElementKind::Fermata,
            ElementKind::Lyric,
            ElementKind::Dynamic,
            ElementKind::Tempo,
            ElementKind::RehearsalMark,
            ElementKind::MeasureNumber,
            ElementKind::Expression,
            ElementKind::ChordSymbol,
            ElementKind::Segno,
            ElementKind::Coda,
            ElementKind::Fine,
            ElementKind::Jump,
            ElementKind::Ornament,
            ElementKind::Trill,
            ElementKind::BreathMark,
            ElementKind::Caesura,
        ] {
            assert_eq!(kind.field_role(), Some(FieldRole::Dependent), "{kind:?}");
        }
    }

    #[test]
    fn other_is_unclassified_pending_split() {
        assert_eq!(ElementKind::Other.field_role(), None);
    }
}

#[cfg(test)]
mod band_geometry_tests {
    use super::{band_bbox, band_span_extent, ElementKind, ElementShape, ShapeGeom};

    /// A shallow downward arc (slur): apex dips at the midpoint, endpoints high.
    /// Y grows downward, so a slur arching *under* notes has larger y at center.
    fn shallow_arc() -> Vec<(f64, f64, f64)> {
        // (x, y_top, y_bottom), thickness already baked in (1 unit tall).
        vec![
            (0.0, 0.0, 1.0),
            (5.0, 3.0, 4.0),
            (10.0, 4.0, 5.0), // apex (lowest point on screen)
            (15.0, 3.0, 4.0),
            (20.0, 0.0, 1.0),
        ]
    }

    #[test]
    fn band_bbox_is_the_global_envelope() {
        let bb = band_bbox(&shallow_arc()).unwrap();
        assert_eq!(bb.x, 0.0);
        assert_eq!(bb.width, 20.0);
        assert_eq!(bb.y, 0.0);
        assert_eq!(bb.height, 5.0);
    }

    #[test]
    fn span_extent_is_local_not_global() {
        let arc = shallow_arc();
        // Over the apex span the band sits low (≈ y 4..5).
        let (top_mid, bottom_mid) = band_span_extent(&arc, 9.0, 11.0).unwrap();
        // Over an endpoint span the band is high (≈ y 0..1) — well above the apex.
        let (top_end, bottom_end) = band_span_extent(&arc, 0.0, 2.0).unwrap();
        assert!(
            top_end < top_mid,
            "endpoint span ({top_end}) must be higher on screen than apex span ({top_mid})"
        );
        assert!(bottom_end < bottom_mid);
        // The endpoint region must NOT pessimistically report the global apex (5.0).
        assert!(
            bottom_end <= 3.0,
            "endpoint span over-reserved: {bottom_end}"
        );
    }

    #[test]
    fn span_extent_interpolates_when_no_sample_inside() {
        let arc = shallow_arc();
        // Narrow span between samples (no sample lands strictly inside) still
        // reports the interpolated profile rather than None.
        let res = band_span_extent(&arc, 2.4, 2.6);
        assert!(res.is_some());
        let (top, _bottom) = res.unwrap();
        assert!(
            top > 0.0 && top < 3.0,
            "interpolated top out of range: {top}"
        );
    }

    #[test]
    fn span_extent_returns_none_outside_band() {
        assert!(band_span_extent(&shallow_arc(), 100.0, 200.0).is_none());
    }

    #[test]
    fn shape_span_extent_dispatches_to_band() {
        let shape = ElementShape {
            element_id: "slur/test".into(),
            kind: ElementKind::Slur,
            geom: ShapeGeom::Band {
                samples: shallow_arc(),
            },
            system_idx: None,
            staff_idx: None,
        };
        let (top, bottom) = shape.span_extent(&[], 0.0, 2.0).unwrap();
        assert!(
            bottom <= 3.0,
            "local endpoint extent expected, got {bottom}"
        );
        assert!(top >= 0.0);
    }
}

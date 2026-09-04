// Extracted from render_measure.rs — render_annotations

use super::placement_metrics::PlacementTable;
use super::types::*;
use crate::render::smufl::smufl;
use crate::render::*;

#[path = "render_annotations/chord_symbols.rs"]
mod chord_symbols;
#[path = "render_annotations/curve_clearance.rs"]
mod curve_clearance;
#[path = "render_annotations/dynamics.rs"]
mod dynamics;
#[path = "render_annotations/expressions.rs"]
mod expressions;
#[path = "render_annotations/jump_markers.rs"]
mod jump_markers;
#[path = "render_annotations/measure_numbers.rs"]
mod measure_numbers;
#[path = "render_annotations/rehearsal_marks.rs"]
mod rehearsal_marks;
#[path = "render_annotations/substrate_obstacles.rs"]
mod substrate_obstacles;
#[path = "render_annotations/tempo.rs"]
mod tempo;

pub(crate) use chord_symbols::render_chord_symbols;
use curve_clearance::slur_upper_edge_over_span;
#[cfg(test)]
pub(crate) use curve_clearance::tie_lower_edge_over_span;
pub(crate) use curve_clearance::{
    highest_slur_edge_above, lowest_slur_edge_below, push_below_dynamics_under_slurs,
    push_fermatas_clear_of_curves,
};
pub(crate) use curve_clearance::{highest_tie_edge_over_span, lowest_tie_edge_over_span};
pub(crate) use dynamics::{
    dynamic_optical_midline_y, dynamic_places_above, dynamic_voice_index, grand_staff_between_y,
    render_dynamics,
};
pub(crate) use expressions::render_text_expressions;
pub(crate) use jump_markers::render_jump_markers;
pub(crate) use measure_numbers::{
    below_staff_number_top_y, measure_number_to_display, render_measure_numbers, start_clef,
};
#[allow(unused_imports)]
// Public annotation barrel; tempo consumes the rehearsal API through its sibling module.
pub(crate) use rehearsal_marks::{
    collect_above_text_boxes, measure_above_label_reserved_width, rehearsal_mark_baseline_y,
    rehearsal_mark_x_extent, render_rehearsal_marks,
};
#[allow(unused_imports)]
// Public annotation barrel; extracted siblings import private substrate APIs directly.
pub(crate) use substrate_obstacles::{
    above_glyph_top_in_range, collect_above_glyph_boxes, collect_articulation_boxes,
    collect_fixed_above_ink_boxes, glyph_screen_bbox, highest_point_in_measure,
    highest_point_in_range, lowest_point_in_measure, AboveGlyphBox, ArticBox,
};

#[allow(unused_imports)] // Preserve the annotation barrel API for geometry and test consumers.
pub(crate) use tempo::{
    global_tempo_widths, measure_tempo_width, render_tempo_markings, resolve_tempo_placement,
    resolved_tempo_widths, tempo_marking_width, tempo_metronome_runs, TempoRun,
};

/// Lift above-staff performance directions (expression text such as "arco",
/// "pizz.", technique words) so they clear any slur that arches above them.
///
/// Runs as a post-pass *after* slurs are rendered for a staff, because slurs
/// are laid out only once the whole staff's measures (and their articulation
/// obstacles) exist, whereas the expression text is emitted earlier during
/// per-measure rendering. Slurs are not registered in the skyline shape
/// registry, so we sample their stored [`SlurGeometry`] directly.
///
/// For each above-staff expression text command in `[staff_cmd_start..]`, the
/// slur upper edge is sampled over the text's x-span; if the text's bottom sits
/// at or below that edge, the command's baseline is moved up so the text clears
/// the slur by `clearance`.
/// A rectangular obstacle (rehearsal-mark frame or tuplet number/bracket) that
/// a tempo marking must clear, gated on **both** horizontal and vertical
/// overlap — a box floating entirely above the tempo is not an obstacle.
struct GatedBox {
    eid: String,
    measure_index: Option<usize>,
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

/// A flat-topped horizontal obstacle (a placed expression direction) that a
/// later, outer dependent must clear; only horizontal overlap is required.
/// `eid`/`rank` let an outer mover *decongest* a strictly-inner movable flat top
/// — sliding it sideways out of the outer mover's column so the outer one need
/// not stack as high (see the decongestion step in `flow_above_staff_dependents`).
struct FlatTop {
    eid: String,
    rank: i32,
    left: f64,
    right: f64,
    top: f64,
}

/// Canvas-space extent of a tuplet number glyph, from its SMuFL bounding box.
/// The glyph occupies only part of its em square, so the crude `y ± size/2`
/// estimate used for text would overstate its height and over-lift the tempo.
/// `glyph_bbox` returns `(x, y, w, h)` in staff spaces relative to the glyph
/// origin (`y` downward); scale by `size / 4` (an em is 4 staff spaces).
fn tuplet_glyph_extent(x: f64, y: f64, codepoint: u32, size: f64) -> (f64, f64, f64, f64) {
    let scale = size / 4.0;
    let (bx, by, bw, bh) = smufl::glyph_bbox(codepoint);
    (
        x + bx * scale,
        x + (bx + bw) * scale,
        y + by * scale,
        y + (by + bh) * scale,
    )
}

/// Union of one marking's command extents (label text + metronome glyph/equation
/// runs), as `(left, right, top, bottom)` in canvas px, or `None` if it has no
/// drawable command. Baseline-aware: bottom-baseline text grows upward by one
/// font size, middle/top baseline by half each way; glyphs by half each way.
fn marking_extent(
    dl: &DisplayList,
    staff_cmd_start: usize,
    eid: &str,
) -> Option<(f64, f64, f64, f64)> {
    let mut left = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    for idx in staff_cmd_start..dl.commands.len() {
        if dl
            .element_ids
            .get(idx)
            .and_then(|o| o.as_ref())
            .map(String::as_str)
            != Some(eid)
        {
            continue;
        }
        let (l, r, t, b) = match &dl.commands[idx] {
            command @ RenderCommand::DrawText { .. } => {
                let bbox = substrate_obstacles::text_command_bbox(command)?;
                (bbox.x, bbox.x + bbox.width, bbox.y, bbox.y + bbox.height)
            }
            RenderCommand::DrawGlyph { .. } => {
                let bbox = dl.commands[idx].bbox()?;
                (bbox.x, bbox.x + bbox.width, bbox.y, bbox.y + bbox.height)
            }
            _ => continue,
        };
        left = left.min(l);
        right = right.max(r);
        top = top.min(t);
        bottom = bottom.max(b);
    }
    (left.is_finite() && right.is_finite()).then_some((left, right, top, bottom))
}

/// Shift every command, explicit bbox, and shape of marking `eid` up by `dy`
/// (positive = move up, so canvas `y` decreases). Command-referenced shapes
/// track their command automatically; explicit bbox/shape stores are patched
/// here so selection geometry stays in sync.
pub(super) fn shift_marking(dl: &mut DisplayList, staff_cmd_start: usize, eid: &str, dy: f64) {
    if dy == 0.0 {
        return;
    }
    for idx in staff_cmd_start..dl.commands.len() {
        if dl
            .element_ids
            .get(idx)
            .and_then(|o| o.as_ref())
            .map(String::as_str)
            != Some(eid)
        {
            continue;
        }
        match &mut dl.commands[idx] {
            RenderCommand::DrawText { y, .. } => *y -= dy,
            RenderCommand::DrawGlyph { y, .. } => *y -= dy,
            RenderCommand::DrawLine { y1, y2, .. } => {
                *y1 -= dy;
                *y2 -= dy;
            }
            RenderCommand::DrawRect { y, .. } => *y -= dy,
            RenderCommand::DrawCircle { cy, .. } | RenderCommand::DrawEllipse { cy, .. } => {
                *cy -= dy;
            }
            _ => {}
        }
    }
    for eb in dl.element_bboxes.iter_mut() {
        if eb.element_id == eid {
            eb.bbox.y -= dy;
        }
    }
    for shape in dl.element_shapes.iter_mut() {
        if shape.element_id == eid {
            if let crate::render::ShapeGeom::Rect { bbox } = &mut shape.geom {
                bbox.y -= dy;
            }
        }
    }
}

/// Highest (smallest-y) above-arching slur edge over `[left, right]`, or `None`.
fn slur_ceiling_over_span(slurs: &[SlurGeometry], left: f64, right: f64) -> Option<f64> {
    let mut top: Option<f64> = None;
    for g in slurs {
        let (sx0, sx1) = (g.p0_x.min(g.p3_x), g.p0_x.max(g.p3_x));
        if sx1 < left || sx0 > right {
            continue;
        }
        if let Some(edge) = slur_upper_edge_over_span(g, left, right) {
            top = Some(top.map_or(edge, |cur| cur.min(edge)));
        }
    }
    top
}

/// Collect, per element id, the unioned extent of every command tagged with an
/// id containing `id_substr`, as a [`GatedBox`]. Used for rehearsal-mark frames
/// (`/rehearsal`) and tuplet numbers/brackets (`/tuplet`).
fn collect_gated_boxes(dl: &DisplayList, staff_cmd_start: usize, id_substr: &str) -> Vec<GatedBox> {
    let mut boxes: std::collections::BTreeMap<String, GatedBox> = std::collections::BTreeMap::new();
    for idx in staff_cmd_start..dl.commands.len() {
        let Some(id) = dl.element_ids.get(idx).and_then(|o| o.as_ref()) else {
            continue;
        };
        if !id.contains(id_substr) {
            continue;
        }
        let (l, r, t, b) = match &dl.commands[idx] {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } => tuplet_glyph_extent(*x, *y, *codepoint, *size),
            RenderCommand::DrawText {
                x,
                y,
                text,
                size,
                baseline,
                align,
                ..
            } => {
                let w = text.chars().count() as f64 * 0.5 * *size;
                let (l, r) = match align {
                    TextAlign::Center => (*x - w * 0.5, *x + w * 0.5),
                    TextAlign::Right => (*x - w, *x),
                    TextAlign::Left => (*x, *x + w),
                };
                let (t, b) = match baseline {
                    TextBaseline::Bottom => (*y - *size, *y),
                    _ => (*y - *size * 0.5, *y + *size * 0.5),
                };
                (l, r, t, b)
            }
            RenderCommand::DrawLine { x1, y1, x2, y2, .. } => {
                (x1.min(*x2), x1.max(*x2), y1.min(*y2), y1.max(*y2))
            }
            RenderCommand::DrawEllipse { cx, cy, rx, ry, .. } => {
                (cx - rx, cx + rx, cy - ry, cy + ry)
            }
            _ => continue,
        };
        let entry = boxes.entry(id.clone()).or_insert(GatedBox {
            eid: id.clone(),
            measure_index: id
                .split('/')
                .find_map(|part| part.strip_prefix('m')?.parse().ok()),
            left: f64::INFINITY,
            right: f64::NEG_INFINITY,
            top: f64::INFINITY,
            bottom: f64::NEG_INFINITY,
        });
        entry.left = entry.left.min(l);
        entry.right = entry.right.max(r);
        entry.top = entry.top.min(t);
        entry.bottom = entry.bottom.max(b);
    }
    boxes.into_values().collect()
}

/// Raise tempo marking `eid` (current box `top`/`bottom`, span `left`/`right`)
/// so its bottom clears `ceiling` by `clearance`. Returns the applied `dy`
/// (>= 0, move up) without yet mutating the marking, so the caller can stage
/// several obstacle groups and update its working box between them.
fn clear_below_ceiling(bottom: f64, ceiling: Option<f64>, clearance: f64) -> f64 {
    match ceiling {
        Some(c) => {
            let desired_bottom = c - clearance;
            if bottom > desired_bottom {
                bottom - desired_bottom
            } else {
                0.0
            }
        }
        None => 0.0,
    }
}

/// Horizontal shift envelope for an above-staff mover whose ink currently spans
/// `[left, right]`. Returns `(min_left, max_left)`: the range its *left edge*
/// may slide to without obscuring the rhythmic event it is attached to. The
/// rules differ by kind:
///
/// * **Text** (`is_tempo == false`) is anchored to a specific note, so it may
///   only consume up to **one third** of the distance to the nearest *actual*
///   note on each side (rests are skipped — they carry no competing mark).
///   Past a third the eye can no longer tell which note the text belongs to;
///   a third stops well short of the midpoint, where attachment turns
///   ambiguous. With only rests on a side (no neighbouring note to confuse it
///   with) the cap relaxes to the note-area start / measure edge.
/// * **Tempo** (`is_tempo == true`) applies to the whole bar (rests included),
///   so it ignores note anchoring entirely and may slide anywhere within the
///   bar's horizontal padding — from the downbeat (note-area start) to the
///   barline (measure right edge).
///
/// Substrate is frozen by the time this runs, so the envelope only *consumes*
/// existing gaps; it never creates space (that is the separate, pre-freeze
/// `SpaceRequest` channel). An empty `measure_layouts` (the unit-test path)
/// yields the collapsed `(left, left)`.
pub(crate) fn neutral_x_envelope(
    measure_layouts: &[MeasureLayout],
    left: f64,
    right: f64,
    sp: f64,
    is_tempo: bool,
) -> (f64, f64) {
    let width = right - left;
    // Home measure: the one whose span contains the mover's left edge.
    let Some(ml) = measure_layouts
        .iter()
        .find(|ml| left >= ml.x && left <= ml.x + ml.width)
    else {
        return (left, left);
    };

    // Note-area start (the downbeat column) and the closing barline. On the
    // first measure of a system the wide prefix gutter above the staff is
    // neutral whitespace for a *tempo* (which governs the whole bar and may
    // park over the clef at a system start); a note-attached *text* direction,
    // however, must never drift left over that structural prefix — sliding
    // "arco" over the clef detaches it from its note — so text always floors at
    // the note-area start *after* the prefix.
    let note_area_start = ml.x + ml.prefix_width;
    // A whole-rest bar has no sounding ink anywhere — the rest sits centred and
    // the prefix gutter is pure spacing (no clef/key content to overlap). A
    // tempo over such a bar may therefore reclaim the gutter too, sliding left
    // to the opening barline (`ml.x`) to dodge a neighbouring obstacle (e.g. a
    // rehearsal-mark frame centred on the closing barline) instead of lifting.
    // A bar carrying notes keeps the downbeat floor so the tempo stays over its
    // content.
    let bar_is_full_rest = ml
        .voice_layouts
        .iter()
        .all(|vl| (0..vl.events.len()).all(|i| vl.events.event(i).is_rest()))
        && ml.voice_layouts.iter().any(|vl| !vl.events.is_empty());
    let tempo_note_area_start = if ml.is_first_on_system || bar_is_full_rest {
        ml.x
    } else {
        note_area_start
    };
    let barline = ml.x + ml.width;

    if is_tempo {
        // A tempo change governs the whole bar — including its rests — so it is
        // never anchored to a single note and may slide freely within the bar's
        // horizontal padding, from the downbeat to the barline.
        let min_left = tempo_note_area_start.min(left);
        let max_left = (barline - width).max(left);
        return (min_left, max_left);
    }

    // Text is anchored to a specific note. Scan the home measure for that anchor
    // (the sounding event the text sits over) and its nearest sounding
    // neighbours on each side, skipping rests (neutral whitespace).
    let notehead_w = 1.18 * sp;
    let mut anchor_x = left;
    let mut prev_x: Option<f64> = None; // nearest sounding note to the left
    let mut next_x: Option<f64> = None; // nearest sounding note to the right
    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            if vl.events.event(i).is_rest() {
                continue; // rests carry no competing mark — drift freely across them
            }
            let ex = vl.events.x(i);
            let ink_l = ex;
            let ink_r = ex + notehead_w;
            if ink_r <= left {
                prev_x = Some(prev_x.map_or(ex, |p: f64| p.max(ex)));
            } else if ink_l >= right {
                next_x = Some(next_x.map_or(ex, |n: f64| n.min(ex)));
            } else {
                anchor_x = ex; // the note the text is attached to
            }
        }
    }

    // Leftward: at most a third of the gap to the previous sounding note; with
    // only leading rests (no previous note) the floor relaxes to the note-area
    // start.
    let min_left = match prev_x {
        Some(px) => (left - (anchor_x - px) / 3.0).max(note_area_start),
        None => note_area_start.min(left),
    };
    // Rightward: at most a third of the gap to the next sounding note; with none
    // the cap is the measure's right edge (keeping the full ink inside the bar).
    let max_left = match next_x {
        Some(nx) => (left + (nx - anchor_x) / 3.0).min(barline - width),
        None => (barline - width).max(left),
    };
    (min_left.min(left), max_left.max(left))
}

/// Minimal horizontal shift `dx` that slides the ink span `[left, right]` to a
/// column where no arching slur forces a vertical lift, within the neutral
/// whitespace envelope `[min_left, max_left]` for the left edge. Returns `None`
/// when the envelope is collapsed or no in-envelope column clears the slur (the
/// caller then stacks vertically). Scans outward from zero in `0.25 sp` steps,
/// alternating sides, and returns the first (smallest `|dx|`) clearing shift so
/// the text moves as little as possible away from its beat.
pub(crate) fn horizontal_dodge_clear(
    slurs: &[SlurGeometry],
    left: f64,
    right: f64,
    bottom: f64,
    clearance: f64,
    min_left: f64,
    max_left: f64,
    sp: f64,
) -> Option<f64> {
    let dx_lo = min_left - left; // <= 0 (leftward room)
    let dx_hi = max_left - left; // >= 0 (rightward room)
    if dx_hi - dx_lo < 1e-6 {
        return None; // envelope collapsed: no neutral whitespace to consume
    }
    let clears = |dx: f64| {
        clear_below_ceiling(
            bottom,
            slur_ceiling_over_span(slurs, left + dx, right + dx),
            clearance,
        ) <= 1e-6
    };
    let step = 0.25 * sp;
    let reach = dx_hi.max(-dx_lo);
    let max_steps = (reach / step).ceil() as i64 + 1;
    for k in 1..=max_steps {
        let off = (k as f64 * step).min(reach);
        let cand_neg = (-off).max(dx_lo);
        if cand_neg < -1e-6 && clears(cand_neg) {
            return Some(cand_neg);
        }
        let cand_pos = off.min(dx_hi);
        if cand_pos > 1e-6 && clears(cand_pos) {
            return Some(cand_pos);
        }
    }
    None
}

/// Minimal horizontal shift `dx` that slides the mover's box (ink span
/// `[left, right]`, vertical extent `[top, bottom]`) clear of every pinned box
/// obstacle that vertically overlaps it, leaving a `clearance` side gap, within
/// the envelope `[min_left, max_left]` for the left edge. Returns `None` when
/// the mover is already clear, the envelope is collapsed, or no in-envelope
/// column clears the boxes (the caller then leaves the mover put). Scans outward
/// from zero, alternating sides, returning the first (smallest `|dx|`) clearing
/// shift so the text moves as little as possible away from its beat.
fn horizontal_dodge_clear_boxes(
    boxes: &[GatedBox],
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
    clearance: f64,
    min_left: f64,
    max_left: f64,
    sp: f64,
) -> Option<f64> {
    let dx_lo = min_left - left; // <= 0 (leftward room)
    let dx_hi = max_left - left; // >= 0 (rightward room)
    if dx_hi - dx_lo < 1e-6 {
        return None; // envelope collapsed: no rhythmic-safe whitespace to consume
    }
    // Only boxes that vertically overlap the mover can force a sideways dodge.
    let blockers: Vec<&GatedBox> = boxes
        .iter()
        .filter(|b| b.bottom >= top && b.top <= bottom)
        .collect();
    if blockers.is_empty() {
        return None;
    }
    let clears = |dx: f64| {
        let l = left + dx;
        let r = right + dx;
        blockers
            .iter()
            .all(|b| r + clearance <= b.left || l - clearance >= b.right)
    };
    if clears(0.0) {
        return None; // already clear at rest — no dodge needed
    }
    let step = 0.25 * sp;
    let reach = dx_hi.max(-dx_lo);
    let max_steps = (reach / step).ceil() as i64 + 1;
    for k in 1..=max_steps {
        let off = (k as f64 * step).min(reach);
        let cand_neg = (-off).max(dx_lo);
        if cand_neg < -1e-6 && clears(cand_neg) {
            return Some(cand_neg);
        }
        let cand_pos = off.min(dx_hi);
        if cand_pos > 1e-6 && clears(cand_pos) {
            return Some(cand_pos);
        }
    }
    None
}
fn shift_marking_x(dl: &mut DisplayList, staff_cmd_start: usize, eid: &str, dx: f64) {
    if dx == 0.0 {
        return;
    }
    for idx in staff_cmd_start..dl.commands.len() {
        if dl
            .element_ids
            .get(idx)
            .and_then(|o| o.as_ref())
            .map(String::as_str)
            != Some(eid)
        {
            continue;
        }
        match &mut dl.commands[idx] {
            RenderCommand::DrawText { x, .. } => *x += dx,
            RenderCommand::DrawGlyph { x, .. } => *x += dx,
            _ => {}
        }
    }
    for eb in dl.element_bboxes.iter_mut() {
        if eb.element_id == eid {
            eb.bbox.x += dx;
        }
    }
    for shape in dl.element_shapes.iter_mut() {
        if shape.element_id == eid {
            if let crate::render::ShapeGeom::Rect { bbox } = &mut shape.geom {
                bbox.x += dx;
            }
        }
    }
}

/// sweep that replaces the former chain of pairwise `lift_*_over_*` passes.
///
/// Above-staff dependents are emitted during per-measure rendering, *before*
/// slur/tie geometry exists, so their initial placement only considered notes,
/// stems and glyphs. This post-pass re-flows them against everything now on the
/// staff, in a single outward sweep ordered by proximity to the staff:
///
/// 1. **Expression directions** (arco/pizz/words/technique) place first — they
///    sit closest to the notes they govern. Each clears any **slur** arching
///    above its span (curve edge), then joins the obstacle field.
/// 2. **Tempo markings** place second, outermost. Each clears, in outward
///    stages: all frozen staff ink over its complete horizontal span, slurs +
///    ties + the already-placed expression directions, then rehearsal-mark
///    frames, then tuplet numbers/brackets. The accumulated lift is applied once
///    per marking, keeping its commands, bbox and shapes in lock-step.
///
/// Folding the five passes into one ordered sweep removes their call-order
/// dependence and the repeated, independent bbox patching that let selection
/// geometry drift out of sync with the rendered glyphs.
///
/// `measure_layouts` is the frozen rhythmic grid for the staff. It is consulted
/// only to compute each mover's horizontal **neutral-whitespace envelope**
/// (`docs/plans/horizontal-collision-avoidance.md`): before stacking a text
/// vertically over a slur, the pass first tries a single-shot horizontal slide
/// across adjacent rest space (which carries no competing rhythmic mark) — a
/// small sideways nudge over a rest beats a tall vertical push that grows the
/// system. Pass an empty slice to disable the dodge (the pure-DisplayList unit
/// tests do this); the vertical fallback is then byte-identical to before.
///
/// `placement` supplies each dependent kind's grounded `stack_rank`, which sets
/// the single outward order of the sweep: lower rank settles first, nearer the
/// staff; later movers clear the flat tops already placed. This replaces the two
/// hardcoded expression→tempo stages with one rank-ordered, order-independent
/// pass — re-emitting the source markings in any order yields the same result.
#[allow(clippy::too_many_lines)] // single rank-ordered stacking sweep; splitting would scatter the shared cursor state
pub(crate) fn flow_above_staff_dependents(
    dl: &mut DisplayList,
    staff_cmd_start: usize,
    slur_geom_start: usize,
    measure_layouts: &[MeasureLayout],
    placement: &PlacementTable,
    staff_y: f64,
    sp: f64,
) {
    // Per-mover stacking clearance comes from each kind's `padding.vertical` in
    // the placement table (expressions and tempo resolve independently), so the
    // gap a dependent keeps as it clears slurs, flat tops, rehearsal frames and
    // tuplets is visible in the debug overlay and tunable via
    // `placementDefaults.json` rather than a single baked-in literal.
    let expr_clearance = placement.resolve(ElementKind::Expression).padding.vertical * sp;
    let tempo_clearance = placement.resolve(ElementKind::Tempo).padding.vertical * sp;

    // Pinned curve obstacles: slurs arching above the chord.
    let slurs: Vec<SlurGeometry> = dl.slur_geometries
        [slur_geom_start.min(dl.slur_geometries.len())..]
        .iter()
        .filter(|g| g.curve_dir < 0.0)
        .cloned()
        .collect();

    // Pinned box obstacles: rehearsal-mark frames and tuplet numbers/brackets.
    // Rehearsal-mark commands are tagged `m{measure}/rehearsal` (no index), so
    // the gate substring is `/rehearsal` — NOT `rehearsal/`, which never matches
    // and silently disables the whole rehearsal-box keep-out stage.
    let mut rehearsal_boxes = collect_gated_boxes(dl, staff_cmd_start, "/rehearsal");
    let tuplet_boxes = collect_gated_boxes(dl, staff_cmd_start, "/tuplet");
    let fixed_ink_boxes = collect_fixed_above_ink_boxes(
        &dl.commands[staff_cmd_start..],
        dl.element_ids.get(staff_cmd_start..).unwrap_or(&[]),
        staff_y,
    );
    let rehearsal_clearance = placement
        .resolve(ElementKind::RehearsalMark)
        .padding
        .vertical
        * sp;
    for frame in &mut rehearsal_boxes {
        let overlap_tolerance = 0.05 * sp;
        let ceiling = fixed_ink_boxes
            .iter()
            .filter(|(left, right, _, measure_index)| {
                *measure_index != frame.measure_index
                    && *right > frame.left + overlap_tolerance
                    && *left < frame.right - overlap_tolerance
            })
            .map(|(_, _, top, _)| *top)
            .min_by(f64::total_cmp);
        let dy = clear_below_ceiling(frame.bottom, ceiling, rehearsal_clearance);
        if dy > 0.0 {
            shift_marking(dl, staff_cmd_start, &frame.eid, dy);
            frame.top -= dy;
            frame.bottom -= dy;
        }
    }

    // --- Collect movable dependents: above-staff expressions + tempo markings.
    // Each carries its grounded stack_rank so the outward order is data-driven:
    // expressions (rank 4) settle nearer the staff, tempo (rank 6) rises above
    // them, all in one pass.
    let expr_rank = placement.resolve(ElementKind::Expression).stack_rank;
    let tempo_rank = placement.resolve(ElementKind::Tempo).stack_rank;

    struct Mover {
        eid: String,
        rank: i32,
        left: f64,
        right: f64,
        top: f64,
        bottom: f64,
        /// Stacking clearance for this mover, resolved from its kind's
        /// `padding.vertical` (spatium → px). Replaces the old shared literal.
        clearance: f64,
    }
    let mut movers: Vec<Mover> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for idx in staff_cmd_start..dl.commands.len() {
        let Some(id) = dl.element_ids.get(idx).and_then(|o| o.as_ref()).cloned() else {
            continue;
        };
        let rank = if id.contains("/expr") {
            // Only above-staff expressions. Both above- and below-staff
            // expressions now render on the alphabetic baseline (matching
            // tempo); the `y < staff_y` test (ink centre above the top line) is
            // what distinguishes the above-staff ones the flow pass moves.
            match &dl.commands[idx] {
                RenderCommand::DrawText { y, baseline, .. }
                    if matches!(baseline, TextBaseline::Alphabetic) && *y < staff_y => {}
                _ => continue,
            }
            expr_rank
        } else if id.contains("/tempo") {
            tempo_rank
        } else {
            continue;
        };
        let clearance = if rank == tempo_rank {
            tempo_clearance
        } else {
            expr_clearance
        };
        if seen.iter().any(|e| e == &id) {
            continue;
        }
        let Some((left, right, top, bottom)) = marking_extent(dl, staff_cmd_start, &id) else {
            continue;
        };
        seen.push(id.clone());
        movers.push(Mover {
            eid: id,
            rank,
            left,
            right,
            top,
            bottom,
            clearance,
        });
    }

    // Outward order: ascending rank, then closest-to-staff first (largest
    // bottom), then left-to-right and eid — a total, deterministic ordering
    // independent of the source emission order.
    movers.sort_by(|a, b| {
        a.rank
            .cmp(&b.rank)
            .then(
                b.bottom
                    .partial_cmp(&a.bottom)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(
                a.left
                    .partial_cmp(&b.left)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then_with(|| a.eid.cmp(&b.eid))
    });

    let mut placed_tops: Vec<FlatTop> = Vec::new();
    // System right margin: the closing barline of the rightmost measure on the
    // system. Text whose ink extends past this runs into the page margin, which
    // the margin dodge below pulls back inside (bounded by the safe envelope).
    let system_right = measure_layouts
        .iter()
        .map(|ml| ml.x + ml.width)
        .fold(f64::NEG_INFINITY, f64::max);
    for m in &movers {
        let (mut left, mut right, mut top, mut bottom) = (m.left, m.right, m.top, m.bottom);

        // Right-margin dodge: if the text's right edge overflows the system's
        // right margin, slide it LEFT to bring the ink back inside — but only as
        // far as the neutral-whitespace envelope allows (never past the 1/3 safe
        // margin to the previous sounding note, which would detach the text from
        // its beat). If the envelope can't fully absorb the overflow, take the
        // largest safe leftward shift and accept the residual overhang. This is
        // trigger (a) of the slide spec: "runs into the right page margin."
        if system_right.is_finite() && right > system_right + 1e-6 {
            let (min_left, _max_left) =
                neutral_x_envelope(measure_layouts, left, right, sp, m.rank == tempo_rank);
            let overflow = right - system_right;
            let dx = (min_left - left).max(-overflow);
            if dx < -1e-6 {
                shift_marking_x(dl, staff_cmd_start, &m.eid, dx);
                left += dx;
                right += dx;
            }
        }

        // Horizontal-first dodge is tempo-only. Expressions now stay rhythmically
        // anchored and resolve slur collisions by lifting vertically in Stage A.
        if m.rank == tempo_rank {
            let dy_slur = clear_below_ceiling(
                bottom,
                slur_ceiling_over_span(&slurs, left, right),
                m.clearance,
            );
            if dy_slur > 0.0 {
                let (min_left, max_left) =
                    neutral_x_envelope(measure_layouts, left, right, sp, true);
                if let Some(dx) = horizontal_dodge_clear(
                    &slurs,
                    left,
                    right,
                    bottom,
                    m.clearance,
                    min_left,
                    max_left,
                    sp,
                ) {
                    shift_marking_x(dl, staff_cmd_start, &m.eid, dx);
                    left += dx;
                    right += dx;
                }
            }
        }

        // Expressions no longer dodge rehearsal frames sideways; they remain at
        // their rhythmic X anchor and resolve conflicts by vertical stacking.

        // Tempo box dodge (horizontal-first, before Stage B's vertical lift). A
        // tempo IS a system object co-equal with a rehearsal mark, so when they
        // genuinely share a column the tempo lifts over the frame (Stage B). But
        // a tempo whose text merely *grazes* a rehearsal frame centred on a
        // neighbouring barline (e.g. a "♩=140" at a whole-rest bar's downbeat
        // whose trailing digits overlap the next bar's mark by a sliver) should
        // first try to slide sideways into its bar's neutral whitespace — over a
        // rest bar that reaches the opening barline — and only lift if the slide
        // can't fully clear. Horizontal neighbours need far less gap than
        // vertical ink clearance, so the box dodge uses a small side gap. The
        // dodge is taken ONLY when it fully clears (otherwise Stage B lifts as
        // before), so it never worsens placement.
        if m.rank == tempo_rank && !rehearsal_boxes.is_empty() {
            let (min_left, max_left) = neutral_x_envelope(measure_layouts, left, right, sp, true);
            let side_gap = 0.3 * sp;
            if let Some(dx) = horizontal_dodge_clear_boxes(
                &rehearsal_boxes,
                left,
                right,
                top,
                bottom,
                side_gap,
                min_left,
                max_left,
                sp,
            ) {
                shift_marking_x(dl, staff_cmd_start, &m.eid, dx);
                left += dx;
                right += dx;
            }
        }

        // Decongestion lookahead (cost-asymmetry escape hatch). Before lifting
        // this mover over an inner expression's flat top, see whether sliding
        // that inner expression sideways — out of this mover's column — lets
        // this mover stay lower. Vertical stacking is the expensive axis: a
        // taller mover grows the system's above-staff band and can cascade into
        // re-justification / re-pagination across systems, whereas a small
        // horizontal slide of the inner text is cheap and local. So when a
        // higher-ranked mover (tempo) would otherwise stack over a lower-ranked
        // movable one (an "arco"/"pizz." direction), we prefer to declutter by
        // sliding the inner text into adjacent neutral whitespace — but only if
        // that slide *fully* removes the column overlap (a partial slide pays
        // the "text drifts off its beat" cost without buying the lower stack).
        for ft in placed_tops.iter_mut() {
            if ft.rank >= m.rank {
                continue; // only decongest strictly-inner (lower-rank) movers
            }
            if ft.right <= left || ft.left >= right {
                continue; // already clear of this mover's column
            }
            // Would this flat top force this mover to lift?
            if clear_below_ceiling(bottom, Some(ft.top), m.clearance) <= 1e-6 {
                continue;
            }
            // Two ways to vacate this mover's column, bounded by the inner text's
            // neutral-whitespace envelope so it never detaches from its note:
            //   * LEFT  — slide so the inner text's right edge clears the mover's
            //             left edge (works when the mover sits to the right).
            //   * RIGHT — slide so the inner text's left edge clears the mover's
            //             right edge (the usual case for a tempo, which anchors
            //             at the measure start and extends rightward past the
            //             text, with following rest space to slide into).
            // Take whichever is feasible within the envelope; prefer the smaller
            // move (less drift from the beat). All-or-nothing: a partial slide
            // that still overlaps buys nothing, so it is rejected.
            let (min_left, max_left) =
                neutral_x_envelope(measure_layouts, ft.left, ft.right, sp, false);
            let dx_left = (left - m.clearance) - ft.right; // <= 0
            let dx_right = (right + m.clearance) - ft.left; // >= 0
            let left_ok = dx_left < -1e-6 && dx_left >= (min_left - ft.left) - 1e-6;
            let right_ok = dx_right > 1e-6 && dx_right <= (max_left - ft.left) + 1e-6;
            let dx = match (left_ok, right_ok) {
                (true, true) => {
                    if -dx_left <= dx_right {
                        dx_left
                    } else {
                        dx_right
                    }
                }
                (true, false) => dx_left,
                (false, true) => dx_right,
                (false, false) => 0.0,
            };
            if dx.abs() > 1e-6 {
                shift_marking_x(dl, staff_cmd_start, &ft.eid, dx);
                ft.left += dx;
                ft.right += dx;
            }
        }

        // Vertical lift, outward staging. Stage A: curves (slurs + ties) and the
        // flat tops already placed by nearer movers, gated on horizontal overlap.
        let mut ceiling = if m.rank == tempo_rank {
            fixed_ink_boxes
                .iter()
                .filter(|(ink_left, ink_right, _, _)| *ink_right >= left && *ink_left <= right)
                .map(|(_, _, top, _)| *top)
                .min_by(f64::total_cmp)
        } else {
            None
        };
        if let Some(edge) = slur_ceiling_over_span(&slurs, left, right) {
            ceiling = Some(ceiling.map_or(edge, |cur| cur.min(edge)));
        }
        if let Some(edge) = highest_tie_edge_over_span(dl, staff_cmd_start, left, right) {
            ceiling = Some(ceiling.map_or(edge, |cur| cur.min(edge)));
        }
        for ft in &placed_tops {
            if ft.right < left || ft.left > right {
                continue;
            }
            // Tempo marks share a single reserved line above the staff and are
            // never floated one above another. When an earlier, long tempo's
            // text overhangs into a later tempo's column (e.g. a verbose
            // "Grandioso ma non troppo" overrunning the narrow bars before a
            // following "Poco rubato"), the overhang is tolerated — exactly as
            // a tempo's text is already allowed to overhang following material
            // (`resolve_tempo_placement`: "a tempo may overhang following bars
            // freely") — rather than lifting the later mark off the line. So a
            // tempo does not stack over another tempo's flat top. It still
            // clears slurs, ties, high notes, rehearsal frames and tuplets
            // (the other stages) and still rises over lower-ranked expressions.
            if m.rank == tempo_rank && ft.rank == tempo_rank {
                continue;
            }
            ceiling = Some(ceiling.map_or(ft.top, |cur| cur.min(ft.top)));
        }
        let mut total_dy = clear_below_ceiling(bottom, ceiling, m.clearance);
        top -= total_dy;
        bottom -= total_dy;

        // Stage B: rehearsal-mark frames (gated on horizontal AND vertical
        // overlap with the mover's *current* box). Only tempo markings clear a
        // rehearsal-mark frame: a tempo and a rehearsal mark are co-equal system
        // objects that share the topmost line, so a tempo overhanging a mark's
        // column rises above it. A performance direction (expression) is NOT a
        // system object — the rehearsal mark owns the top slot and already
        // dodges sideways around directions (see `render_rehearsal_marks`), so
        // lifting the direction over the mark too would be redundant double
        // avoidance that floats it far above the staff. Directions therefore
        // stay put under the mark and rely on the mark's own horizontal dodge.
        let mut box_ceiling: Option<f64> = None;
        if m.rank == tempo_rank {
            for mb in &rehearsal_boxes {
                if mb.right < left || mb.left > right {
                    continue;
                }
                if mb.bottom < top || mb.top > bottom {
                    continue;
                }
                box_ceiling = Some(box_ceiling.map_or(mb.top, |cur| cur.min(mb.top)));
            }
        }
        let dy_b = clear_below_ceiling(bottom, box_ceiling, m.clearance);
        total_dy += dy_b;
        top -= dy_b;
        bottom -= dy_b;

        // Stage C: tuplet numbers/brackets (same gating).
        let mut tuplet_ceiling: Option<f64> = None;
        for tb in &tuplet_boxes {
            if tb.right < left || tb.left > right {
                continue;
            }
            if tb.bottom < top || tb.top > bottom {
                continue; // no vertical overlap
            }
            tuplet_ceiling = Some(tuplet_ceiling.map_or(tb.top, |cur| cur.min(tb.top)));
        }
        let dy_c = clear_below_ceiling(bottom, tuplet_ceiling, m.clearance);

        total_dy += dy_c;

        // One lift, applied to commands + bbox + shapes together.
        shift_marking(dl, staff_cmd_start, &m.eid, total_dy);
        placed_tops.push(FlatTop {
            eid: m.eid.clone(),
            rank: m.rank,
            left,
            right,
            top: top - dy_c,
        });
    }
}

#[cfg(test)]
mod above_glyph_substrate_tests {
    use super::*;

    fn glyph(x: f64, y: f64, codepoint: u32) -> RenderCommand {
        RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            font: "Bravura".into(),
            size: 1.0,
            color: "#000000".into(),
            rotation: 0.0,
        }
    }

    /// A single-note tremolo glyph (U+E220) and its notehead tagged as note
    /// substrate (`…/s{seq}/…`) must both report their actual ink above the
    /// staff, while a tuplet number (`…/tuplet…`) remains a separate annotation.
    /// This is the architectural guarantee: substrate ink is classified by
    /// element-id tag, so tremolos are covered without an explicit codepoint
    /// allowlist.
    #[test]
    fn tremolo_substrate_is_an_above_staff_obstacle() {
        let staff_y = 0.0; // top staff line at y=0; above-staff means y < 0
        let commands = vec![
            // Single-note tremolo, above the staff — must be collected.
            glyph(10.0, -8.0, smufl::TREMOLO_1),
            // Notehead, above the staff — actual ink must be collected.
            glyph(10.0, -8.0, smufl::NOTEHEAD_BLACK),
            // Tuplet number, above the staff — separate annotation, EXCLUDED.
            glyph(10.0, -8.0, 0xE883 /* digit, any non-notehead */),
        ];
        let element_ids = vec![
            Some("p3/m11/s0/e0/trem".to_string()),
            Some("p3/m11/s0/e0/n0".to_string()),
            Some("p3/m11/s0/tuplet0".to_string()),
        ];

        let boxes = collect_above_glyph_boxes(&commands, &element_ids, staff_y);
        assert_eq!(
            boxes.len(),
            2,
            "tremolo and notehead substrate ink should be reported; got {boxes:?}"
        );
    }

    /// An untagged glyph (empty/short `element_ids`) yields no obstacles — the
    /// invariant permits `element_ids` to be empty, and nothing is misclassified
    /// as substrate in that case.
    #[test]
    fn untagged_glyphs_are_not_substrate() {
        let commands = vec![glyph(10.0, -8.0, smufl::TREMOLO_1)];
        let boxes = collect_above_glyph_boxes(&commands, &[], 0.0);
        assert!(boxes.is_empty(), "untagged glyph must not be substrate");
    }
}

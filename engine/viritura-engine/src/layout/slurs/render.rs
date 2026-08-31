use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use super::articulation_clearance::*;
use super::boundary_dependents::resolve_outside_boundary_dependents;
pub(super) use super::collision_apex::*;
use super::direction::*;
use super::endpoint_spring::{
    apply_beam_tip_clearance, correct_mixed_tilt, endpoint_note_position,
    grace_source_needs_stem_escape, level_note_targeted_stem_pair, notehead_y_offset,
    stem_contained_x, uses_stem_side, uses_stem_side_x,
};
use super::obstacle_shapes::collect_shape_obstacles;
use super::participation::*;
use super::scorer::{select_slur_candidate, SlurShapeInput};
use super::tie_chains::build_tie_chain_index;
use super::tie_lanes::apply_tie_clearance;
use super::tuning;
use super::tuplet_clearance::{apply_enclosing_tuplet_clearance, flow_tuplets_over_inner_slurs};
use crate::model::Slur;
use crate::render::*;
use std::collections::HashMap;

/// Render slur curves across all measures.
///
/// Walks every event that has `slurs` defined, locates the target event by ID,
/// and emits a `DrawBezier` command. The curve direction is determined by the
/// slur's `side` hint ("up" = above, "down" = below) or falls back to the
/// opposite of stem direction (same convention as ties).
///
/// Intermediate notes and stems are collected as obstacles; the curve is raised
/// to avoid collisions using the two-pass shoulder adjustment described below.
pub(crate) fn render_slurs(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    staff_y_offsets: Option<&[f64]>,
    staff_shape_start: usize,
) {
    // Perf: skip the entire per-staff setup (event_map, note_map, obstacles,
    // shape scans, tie chains, tip stacking, etc.) when this staff has no
    // slurs at all. On dense orchestral scores the vast majority of staves
    // carry no slurs but were paying for the full O(events × shapes) build.
    let has_any_slur = measure_layouts.iter().any(|ml| {
        ml.voice_layouts.iter().any(|vl| {
            (0..vl.events.len()).any(|i| {
                vl.events
                    .event(i)
                    .slurs
                    .as_ref()
                    .is_some_and(|s| !s.is_empty())
                    || vl
                        .events
                        .grace_notes(i)
                        .iter()
                        .any(|g| g.event.slurs.as_ref().is_some_and(|s| !s.is_empty()))
            })
        })
    });
    if !has_any_slur {
        return;
    }
    let slur_geometry_start = dl.slur_geometries.len();

    // Build event-ID → rendered-position map, note-ID → (Y, eff_staff_y) map,
    // and obstacle list across all measures.
    let (mut event_map, note_map, mut all_obstacles) =
        build_slur_event_obstacle_maps(measure_layouts, staff_y, sp, config, staff_y_offsets);

    // Pull articulation / fermata / ledger-line / tie obstacles from the
    // score-global shape registry into the per-staff obstacle list (and record
    // articulation extents on `event_map`). See `collect_shape_obstacles`.
    let tuplet_obstacles = collect_shape_obstacles(
        dl,
        &mut event_map,
        &mut all_obstacles,
        staff_shape_start,
        staff_y,
        sp,
    );

    // Sort obstacles by X so each per-slur consumer
    // (`compute_shoulder_and_apex`, `contour_auto_side`,
    // `compute_stem_side_tip_drop`, `apply_inner_artic_tip_lift`) can binary-
    // search the in-span slice instead of linearly scanning the entire
    // vector. Uses `total_cmp` so NaN positions (shouldn't occur but be
    // defensive) sort deterministically.
    all_obstacles.sort_by(|a, b| a.x.total_cmp(&b.x));

    // ── S7: Nested slur depth ────────────────────────────────────
    let (slur_spans, span_index, span_depths) =
        compute_slur_nest_depths(measure_layouts, &event_map);
    let lookup_depth = |sid: &str, tid: &str| -> (u32, u32) {
        span_index
            .get(&(sid.to_string(), tid.to_string()))
            .and_then(|&i| span_depths.get(i).copied())
            .unwrap_or((0, 0))
    };

    // ── S8 / A5: Tie-chain endpoint extension ───────
    let tie_chains = build_tie_chain_index(measure_layouts);
    // Patch `incoming_tie` on event_map entries that have a predecessor.
    for (event_id, info) in &mut event_map {
        info.incoming_tie = tie_chains.has_incoming_event(event_id);
    }

    // ── Chained-pair detection ──────────────────────
    // When a slur ends on the same event that the next slur starts on
    // (e.g., 1→2, 2→3 phrasing) the two tips meet at the shared notehead
    // and visually fuse into one continuous arc. Reference engravers
    // (industry-standard) introduce a small horizontal gap by pulling
    // each tip slightly inward along its own chord. Build the set of
    // events that act as a chain pivot (both an outgoing slur start AND
    // an incoming slur target).
    // Slur sources are main events AND grace notes. Grace notes live in
    // `el.grace_notes` (outside the main events vector) but carry their own
    // `slurs`, so collect both into one flat list keyed by source event id.
    let mut slur_sources: Vec<(&str, &[Slur])> = Vec::new();
    for ml in measure_layouts {
        for vl in &ml.voice_layouts {
            for i in 0..vl.events.len() {
                if let (Some(id), Some(slurs)) =
                    (vl.events.id(i), vl.events.event(i).slurs.as_ref())
                {
                    if !slurs.is_empty() {
                        slur_sources.push((id, slurs.as_slice()));
                    }
                }
                for gn in vl.events.grace_notes(i) {
                    if let (Some(id), Some(slurs)) = (gn.id.as_ref(), gn.event.slurs.as_ref()) {
                        if !slurs.is_empty() {
                            slur_sources.push((id.as_str(), slurs.as_slice()));
                        }
                    }
                }
            }
        }
    }

    let mut event_has_outgoing_slur: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    let mut event_is_slur_target: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    for &(src_id, slurs) in &slur_sources {
        event_has_outgoing_slur.insert(src_id.to_string());
        for slur in slurs {
            event_is_slur_target.insert(slur.target.clone());
        }
    }
    let is_pivot =
        |evid: &str| event_has_outgoing_slur.contains(evid) && event_is_slur_target.contains(evid);

    // ── Tip-stacking detection ───────────────────────────────────
    // When a single event acts as endpoint for MORE than one slur, the tips
    // visually overlap unless we offset them. Build a `tips_at_event` map
    // (per-event, per-side list sorted by nest_depth) so `local_tip_rank`
    // can return each slur's local rank in O(side-size). See
    // `build_slur_tip_stack_map` / `local_tip_rank` for the full rationale.
    let tips_at_event = build_slur_tip_stack_map(&slur_spans, &span_depths);
    // Emit bezier curves for each slur (sources include grace notes).
    for &(src_id, slurs) in &slur_sources {
        if let Some(src_info_user) = event_map.get(src_id) {
            for slur in slurs {
                if let Some(tgt_info_user) = event_map.get(&slur.target) {
                    // S8/A5: resolve effective endpoints via tie chains.
                    let resolved_source =
                        tie_chains.resolve(src_id, slur.start_note.as_deref(), true);
                    let resolved_target = tie_chains.resolve_slur_target(
                        &slur.target,
                        slur.end_note.as_deref(),
                        src_info_user.mag < 1.0,
                    );
                    let src_id_eff = resolved_source.event_id;
                    let tgt_id_eff = resolved_target.event_id;
                    let src_info = event_map.get(&src_id_eff).unwrap_or(src_info_user);
                    let tgt_info = event_map.get(&tgt_id_eff).unwrap_or(tgt_info_user);
                    let mut resolved_slur = slur.clone();
                    resolved_slur.start_note = resolved_source.note_id;
                    resolved_slur.end_note = resolved_target.note_id;
                    let (depth, inner) = lookup_depth(&src_id_eff, &tgt_id_eff);
                    // Inward shift on chain-pivot endpoints so
                    // adjacent slur tips don't fuse.
                    let start_at_pivot = is_pivot(src_id);
                    let end_at_pivot = is_pivot(&slur.target);
                    // Tip-stacking: rank LOCAL to each
                    // endpoint AND SIDE (sorted by nest_depth
                    // among slurs sharing this notehead on
                    // the same side).
                    let src_tip_rank =
                        local_tip_rank(&tips_at_event, src_id, &src_id_eff, &tgt_id_eff, false);
                    let tgt_tip_rank = local_tip_rank(
                        &tips_at_event,
                        &slur.target,
                        &src_id_eff,
                        &tgt_id_eff,
                        true,
                    );
                    emit_slur_bezier(
                        dl,
                        src_info,
                        tgt_info,
                        &resolved_slur,
                        &note_map,
                        &all_obstacles,
                        &tuplet_obstacles,
                        &src_id_eff,
                        &tgt_id_eff,
                        src_id,
                        sp,
                        config,
                        depth,
                        inner,
                        start_at_pivot,
                        end_at_pivot,
                        src_tip_rank,
                        tgt_tip_rank,
                    );
                    resolve_outside_boundary_dependents(dl, src_info, tgt_info, sp);
                }
            }
            flow_tuplets_over_inner_slurs(dl, staff_shape_start, slur_geometry_start, staff_y, sp);
        }
    }
}

/// Nudge a stem-side endpoint Y away from staff lines
///
/// A slur tip must never land ON a staff line — the silhouette merges with
/// the line and the terminus becomes ambiguous. Notehead-side endpoints
/// already encode this via the on-line/in-space parity in
/// `notehead_side_offset`. Stem-side endpoints (after contour-aware drop)
/// can land anywhere, so this pass corrects them: if the final endpoint
/// falls within `STAFF_LINE_SNAP_TOLERANCE_SP` of a staff line, nudge it
/// outward (in the curve's direction) to `STAFF_LINE_NUDGE_SP` past the
/// nearest line.
///
/// Endpoints outside staff bounds (well into ledger-line territory) are
/// left untouched — they don't conflict with staff lines.
pub(super) fn apply_staff_line_clearance(y: f64, dir: f64, eff_y: f64, sp: f64) -> f64 {
    // 5 staff lines at eff_y + k*sp, k = 0..=4.
    let mut best_dist = f64::INFINITY;
    let mut nearest_line = y;
    for k in 0..=4 {
        let ly = eff_y + (k as f64) * sp;
        let d = (y - ly).abs();
        if d < best_dist {
            best_dist = d;
            nearest_line = ly;
        }
    }
    if y < eff_y - 0.5 * sp || y > eff_y + 4.0 * sp + 0.5 * sp {
        return y;
    }
    if best_dist >= tuning::STAFF_LINE_SNAP_TOLERANCE_SP * sp {
        return y;
    }
    nearest_line + dir * tuning::STAFF_LINE_NUDGE_SP * sp
}

/// Result of `compute_shoulder_and_apex` — the full S4 collision-avoidance
/// pipeline output: the final required shoulder height, the apex-shift
pub(super) fn compute_stem_side_tip_drop(
    this_y_pos: f64,
    this_eff_y: f64,
    curve_above_local: bool,
    src_center_x: f64,
    tgt_center_x: f64,
    src_y_pos: f64,
    tgt_y_pos: f64,
    src_eff_y: f64,
    tgt_eff_y: f64,
    src_voice_idx: usize,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    sp: f64,
    config: &LayoutConfig,
    // Endpoint magnification (1.0 main, ~0.65 grace) — scales the stem-tip
    // anchor so a grace note's overhang is measured from its shorter stem.
    mag: f64,
) -> f64 {
    let dir = if curve_above_local { -1.0 } else { 1.0 };
    let endpoint_stem_tip_y = this_eff_y
        + this_y_pos * sp * 0.5
        + dir * (config.stem_length * sp * mag + tuning::STEM_EXTENSION_SP * sp);
    let dx_local = tgt_center_x - src_center_x;
    let dy_local = (tgt_eff_y + tgt_y_pos * sp * 0.5) - (src_eff_y + src_y_pos * sp * 0.5);
    let chord_len_local = (dx_local * dx_local + dy_local * dy_local).sqrt().max(0.01);
    let chord_len_sp = (chord_len_local / sp).max(0.0);
    let span_drop = ((chord_len_sp - tuning::TIP_DROP_SPAN_OFFSET_SP)
        / tuning::TIP_DROP_SPAN_SCALE_SP)
        .clamp(0.0, 1.0)
        * tuning::TIP_DROP_SPAN_MAX_SP
        * sp;
    let x_lo_local = src_center_x.min(tgt_center_x);
    let x_hi_local = src_center_x.max(tgt_center_x);
    let mut overhang_max = 0.0_f64;
    for ob in obstacles_in_x_range(obstacles, x_lo_local, x_hi_local) {
        if ob.voice_idx == 0 || ob.voice_idx != src_voice_idx {
            continue;
        }
        if let Some(ref oid) = ob.event_id {
            if oid == src_event_id || oid == tgt_event_id {
                continue;
            }
        }
        let overhang = if curve_above_local {
            endpoint_stem_tip_y - ob.y_top
        } else {
            ob.y_bottom - endpoint_stem_tip_y
        };
        if overhang > overhang_max {
            overhang_max = overhang;
        }
    }
    let contour_drop = (overhang_max * tuning::TIP_DROP_OVERHANG_FACTOR)
        .min(tuning::TIP_DROP_OVERHANG_MAX_SP * sp);
    (span_drop + contour_drop).min(tuning::TIP_DROP_TOTAL_MAX_SP * sp)
}

/// Apply the S2/A4 articulation pull-back to slur endpoints
///
/// When an endpoint note carries an articulation on the slur side, the
/// articulation must sit *inside* the slur curve. This pulls the endpoint Y
/// OUTWARD (further from the notehead) so the articulation bbox plus
/// `tuning::ARTIC_PAD_SP` of padding fits between notehead and slur tip.
///
/// Two special cases are handled:
/// * **Boundary-outside articulations** — accents on the first/last note
///   that `render_articulations` deliberately positions
///   *outside* the curve. We skip the pull on those endpoints (otherwise
///   the slur would arc up to meet the accent and overlap it). Detected
///   either via `EndpointArticulationRelation::Outside` or via the distance test
///   `max_inside_dist` for staccato/tenuto dots bumped 1 sp above the staff.
/// * **Mixed-stem context** — articulations sit on the
///   stem-opposite side. Only the endpoint whose articulation actually lies
///   on the slur side contributes a pull target; the other is filtered out
///   via `extent_on_slur_side`.
///
pub(super) fn stem_side_y_offset(
    is_endpoint_src: bool,
    src_y_pos: f64,
    tgt_y_pos: f64,
    src_eff_y: f64,
    tgt_eff_y: f64,
    src_center_x: f64,
    tgt_center_x: f64,
    end_curve_dir: f64,
    is_beamed: bool,
    voice_idx: usize,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    sp: f64,
    config: &LayoutConfig,
    // Endpoint magnification (1.0 main, ~0.65 grace). The stem-side tip
    // anchors at the stem TIP, whose length scales with the note's mag —
    // a grace note's stem is only `mag×` as long, so without this the tip
    // floats a full main-note stem-length away from the small grace head.
    mag: f64,
) -> f64 {
    let base = end_curve_dir * (config.stem_length * sp * mag + tuning::STEM_EXTENSION_SP * sp);
    if is_beamed {
        return base + end_curve_dir * (tuning::CONTOUR_DROP_EXTRA_SP * sp);
    }
    let (endpoint_y_pos, endpoint_eff_y, curve_above) = if is_endpoint_src {
        (src_y_pos, src_eff_y, end_curve_dir < 0.0)
    } else {
        (tgt_y_pos, tgt_eff_y, end_curve_dir < 0.0)
    };
    let drop = compute_stem_side_tip_drop(
        endpoint_y_pos,
        endpoint_eff_y,
        curve_above,
        src_center_x,
        tgt_center_x,
        src_y_pos,
        tgt_y_pos,
        src_eff_y,
        tgt_eff_y,
        voice_idx,
        obstacles,
        src_event_id,
        tgt_event_id,
        sp,
        config,
        mag,
    );
    base - end_curve_dir * drop
}

/// **Collision avoidance:** Scans obstacles between endpoints and raises the
/// curve height (and shifts control-point shoulder) to clear them.
/// Uses iterative bezier adjustment against shapes between the slur endpoints.
//
// The function is a long pipeline of clearly-labelled phases (direction,
// endpoint X/Y, tie clearance, articulation pullback, shoulder/apex, etc.).
// Most heavy lifting already lives in dedicated helpers (`apply_tie_clearance`,
// `apply_endpoint_artic_pullback`, `apply_inner_artic_tip_lift`,
// `apply_staff_line_clearance`, `compute_shoulder_and_apex`,
// `apply_nested_shoulder_adjust`, `apply_apex_line_snap`,
// `stem_side_y_offset`, `compute_slur_bezier`). What remains is the
// step-by-step glue that wires those helpers together; splitting it further
// scatters the slur engraving rules across many tiny functions and hurts
// the engraver's ability to read the algorithm top-to-bottom.
#[allow(clippy::too_many_lines)] // Ordered endpoint-to-curve pipeline; engraving sub-phases already live in named helpers.
pub(super) fn emit_slur_bezier(
    dl: &mut DisplayList,
    src: &EventRenderInfo,
    tgt: &EventRenderInfo,
    slur: &crate::model::event::Slur,
    note_map: &HashMap<String, (f64, f64)>,
    obstacles: &[SlurObstacle],
    tuplet_obstacles: &[super::obstacle_shapes::TupletObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    authored_src_event_id: &str,
    sp: f64,
    config: &LayoutConfig,
    nest_depth: u32,
    inner_depth: u32,
    start_at_pivot: bool,
    end_at_pivot: bool,
    // Stack rank at the source endpoint when multiple slur tips meet.
    // 0 = innermost (or only) slur at this notehead; higher = outer.
    src_tip_rank: u32,
    // Stack rank at the target endpoint (same semantics as src_tip_rank).
    tgt_tip_rank: u32,
) {
    // ── Direction (single decision) ───────────────────────────────
    // Consolidated into `decide_curve_direction` so the logic isn't spread
    // across 4 successive `let curve_above = ...` shadowings that each
    // re-decide based on a different rule. The decider applies, in order:
    //   1. Explicit `slur.side` override.
    //   2. Default stem-opposite (or above for mixed stems,
    // 3. Contour-following auto-side — mountain/valley
    //      flip with register-guard suppression.
    //   4. Tall-slur force-above exception
    //   5. Cross-staff default → BELOW
    let direction =
        decide_curve_direction(slur, src, tgt, obstacles, src_event_id, tgt_event_id, sp);
    let curve_above = direction.curve_above;
    let end_above = direction.end_above;
    let curve_dir: f64 = direction.curve_dir;
    let grace_slur = src.mag < 1.0 || tgt.mag < 1.0;
    let grace_to_chord = src.mag < 1.0 && tgt.note_count > 1 && slur.end_note.is_none();

    // ── Line style ───────────────────────────────────────────────
    let line_style: u8 = match slur.line_type {
        Some(crate::model::event::SlurLineType::Dashed) => 1,
        Some(crate::model::event::SlurLineType::Dotted) => 2,
        _ => 0,
    };

    // ── Endpoint note positions ───────────────────────────────────
    // For start/end notes specified by ID, look up both pos and eff_staff_y.
    let (src_y_pos, src_eff_y) =
        endpoint_note_position(slur.start_note.as_deref(), note_map, src, curve_above);
    let (tgt_y_pos, tgt_eff_y) = endpoint_note_position(
        slur.end_note.as_deref(),
        note_map,
        tgt,
        (src.mag < 1.0 && tgt.note_count > 1) || end_above,
    );

    // ── Endpoint X: notehead centreG-A) ───────
    // Standard practice describes "½ stave-space clear of the notehead" as a *total
    // radial* clearance — primarily applied via vertical (Y) offset, not as
    // an additional horizontal push past the notehead edge. Anchor at the
    // notehead centre X; the visual "tuck" effect emerges from the bezier
    // control points pulling the curve away from the notehead, not from
    // shoving the endpoint horizontally past it.
    //
    // Previously we pushed by +/- notehead_w*0.5 (right edge / left edge),
    // which combined with the 0.7–1.0sp Y offset gave a total clearance of
    // ~0.9–1.1sp — almost double the standard prescription — and made every
    // short slur look like it was sliding off the side of the note.
    // Refs:"the curve begins ½ stave-space clear of the centre
    // of the note"; standard engraving practice.
    let src_center_x = src.x + src.notehead_w * 0.5;
    let tgt_center_x = tgt.x + tgt.notehead_w * 0.5;
    let dir_x = if tgt_center_x >= src_center_x {
        1.0
    } else {
        -1.0
    };
    let mut x1 = src_center_x;
    let mut x2 = tgt_center_x;

    // ── Chained-pair tip nudge ───────────────────────────────────
    // When this event also begins (or ends) another slur, pull this tip
    // inward along the chord so adjacent slur tips don't visually fuse.
    // The opposite slur applies the same shift on its own end, producing
    // a small symmetric gap centred on the shared notehead. 0.18 sp on
    // each side ⇒ ~0.36 sp total gap (≈ 1/3 of a notehead width).
    let pivot_nudge = tuning::CHAINED_PIVOT_NUDGE_SP * sp;
    if start_at_pivot {
        x1 += pivot_nudge * dir_x;
    }
    if end_at_pivot {
        x2 -= pivot_nudge * dir_x;
    }

    // ── G-B: Slur–tie endpoint sharing ──────────────
    // When a slur endpoint sits on a note that ALSO carries a tie,
    // Standard practice describes two acceptable conventions: (A) small X offset
    // so the arcs sit side-by-side, or (B) Y stacking so the slur
    // arches OVER the tie with the same start X.
    //
    // Reference engravers (industry-standard) consistently choose (B):
    // the slur tip stays at the notehead's X and is lifted in Y by
    // enough room to clear the tie arc beneath it. This reads as
    // "slur encloses the tied group" and matches the prevailing
    // hierarchy of nested arcs (articulations < ties < slurs).
    //
    // The X-shift implementation is intentionally suppressed here; the
    // Y-clearance is added below in the endpoint-Y block. We retain
    // `dir_x` and the unmodified `x1`/`x2` for callers that still need
    // a consistent chord direction.
    // ── Endpoint Y ────────────────────────────────────────────────
    // Two regimes:
    //   * Notehead-side slur (curve opposite stem): tip sits just outside the
    // notehead's outer edge.standard engraving practice: "begin and end
    //     just clear of the noteheads". Roughly nh_h + 0.10 sp gap.
    //   * Stem-side slur (curve same side as stem): tip attaches near the stem
    // tip with small clearance. standard engraving practice and
    //
    // For notehead-side endpoints, in-space and on-line notes use slightly
    // different offsets so the tip lands in a clean gap (not on a staff line).
    let src_on_line = (src_y_pos.round() as i32) % 2 == 0;
    let tgt_on_line = (tgt_y_pos.round() as i32) % 2 == 0;

    // Notehead-side baseline offsets (from notehead center, in curve_dir).
    // industry-standard engravers: slur tip should sit cleanly clear of
    // the notehead — the standard prescription is roughly ½ stave-space past the
    // notehead edge (≈0.95 sp from notehead centre with nh_h = 0.45 sp).
    // Different parities target different spaces:
    //   * On-line note (y_pos even): the next staff line is exactly 1 sp from
    //     the notehead centre. Place the tip body at 1.2 sp so it sits past
    //     the adjacent line, inside the space beyond (line at 1.0sp, next
    //     line at 2.0sp, tip body lies in 1.0–2.0 space).
    //   * In-space note (y_pos odd): the adjacent line is 0.5 sp away and
    //     the next space starts at 0.5 sp and ends at 1.5 sp from notehead
    //     centre. Place the tip at 1.1 sp so it sits well inside that space
    //     with ~0.65 sp clearance from the notehead edge.
    // These match reference engravings (industry-standard) and give visibly
    // generous gaps above/below the notehead without floating into the next
    // staff line.
    // Source endpoint:
    // Stem-tip Y anchoring applies whenever the slur is on the SAME SIDE as
    // the stem at this endpoint, does not target a specific chord note, and
    // is not an S-curve (side ≠ sideEnd). Note-targeted outer chord notes keep
    // their note-relative Y but use stem-side X containment below. Previously
    // this was gated on `slur.side` being
    // explicitly set, but auto-direction slurs need the same treatment —
    // otherwise ascending/descending lines anchored at low/high noteheads
    // produce a tilted asymmetric arch instead of industry-standard engravers's
    // symmetric dome.
    let s_curve = curve_above != end_above;
    let src_targets_note = slur.start_note.is_some();
    let tgt_targets_note = slur.end_note.is_some();
    let src_grace_stem_escape = grace_source_needs_stem_escape(
        src,
        tgt_eff_y,
        tgt_y_pos,
        src_eff_y,
        src_y_pos,
        curve_above,
        src_targets_note,
        sp,
    );
    let src_stem_side = !grace_slur && uses_stem_side(src, src_targets_note, s_curve, curve_above);
    let tgt_stem_side = !grace_slur && uses_stem_side(tgt, tgt_targets_note, s_curve, end_above);
    let src_stem_side_x =
        !grace_slur && uses_stem_side_x(src, src_targets_note, src_y_pos, s_curve, curve_above);
    let tgt_stem_side_x =
        !grace_slur && uses_stem_side_x(tgt, tgt_targets_note, tgt_y_pos, s_curve, end_above);
    let src_stem_anchor = src_stem_side || src_grace_stem_escape;
    let src_anchor_dir = if src_grace_stem_escape {
        -1.0
    } else {
        curve_dir
    };

    // ── Stem-side endpoint tip drop (standard, contour-aware) ─
    // Encapsulated in `compute_stem_side_tip_drop` — the contour-aware
    // drop that pulls a stem-side slur tip back toward the notehead so
    // long phrases get a gentle standard engraving-style curve instead of a flat
    // geometric arc; standard engraving practice).
    let y1_offset = if src_stem_anchor {
        stem_side_y_offset(
            true,
            src_y_pos,
            tgt_y_pos,
            src_eff_y,
            tgt_eff_y,
            src_center_x,
            tgt_center_x,
            src_anchor_dir,
            src.is_beamed,
            src.voice_idx,
            obstacles,
            src_event_id,
            tgt_event_id,
            sp,
            config,
            src.mag,
        )
    } else {
        curve_dir * notehead_y_offset(src_on_line, src.mag, grace_slur, false, sp)
    };

    let y2_offset = if tgt_stem_side {
        let end_curve_dir = if end_above { -1.0 } else { 1.0 };
        stem_side_y_offset(
            false,
            src_y_pos,
            tgt_y_pos,
            src_eff_y,
            tgt_eff_y,
            src_center_x,
            tgt_center_x,
            end_curve_dir,
            tgt.is_beamed,
            src.voice_idx,
            obstacles,
            src_event_id,
            tgt_event_id,
            sp,
            config,
            tgt.mag,
        )
    } else {
        curve_dir * notehead_y_offset(tgt_on_line, tgt.mag, grace_slur, grace_to_chord, sp)
    };

    // ── Tip-stacking offset ────────────────────────
    // When multiple slur tips meet at the same notehead, separate them in
    // BOTH axes: lift each tip outward in the curve direction, and fan it
    // horizontally so the outer slur starts fractionally earlier and ends
    // fractionally later than the one it encloses. A purely vertical stack
    // leaves the tips sitting in a column, which reads as one thick stroke
    // where the curves converge. Rank is 0 for the sole slur at a notehead
    // (no offset) and grows for outer slurs.
    let tip_stack_step = tuning::TIP_STACK_STEP_SP * sp;
    let tip_stack_fan = tuning::TIP_STACK_HORIZ_SP * sp;
    let y1_offset = y1_offset + curve_dir * (src_tip_rank as f64) * tip_stack_step;
    let end_curve_dir = if end_above { -1.0 } else { 1.0 };
    let y2_offset = y2_offset + end_curve_dir * (tgt_tip_rank as f64) * tip_stack_step;
    // Source fans left (earlier), target fans right (later).
    x1 += -(f64::from(src_tip_rank)) * tip_stack_fan;
    x2 += f64::from(tgt_tip_rank) * tip_stack_fan;

    // ── Stem-side endpoint X shift ───────────────────────────────
    // When the slur is anchored at the stem TIP (not the notehead side),
    // its X must align with the stem itself, not the notehead centre.
    // Stem attaches at the notehead's RIGHT edge for stem-up notes and the
    // LEFT edge for stem-down notes. Without this shift the slur tip floats
    // in empty space half a notehead away from the actual stem.
    //
    // Then **tuck inward** (toward the chord midpoint) by ~0.25 sp so the
    // tip doesn't sit directly atop the stem end — otherwise the slur reads
    // as a continuation of the stem line. industry-standard engravers both apply a
    // small inward shift at stem-side endpoints for the same reason.
    // Ref:"the slur springs from the tip of the stem [but]
    // should not appear to grow out of it"; standard engraving practice.
    let stem_inward_tuck = tuning::STEM_INWARD_TUCK_SP * sp;
    let inward_sign_src = if tgt_center_x >= src_center_x {
        1.0
    } else {
        -1.0
    };
    let inward_sign_tgt = -inward_sign_src;
    if src_stem_side_x || src_grace_stem_escape {
        x1 = stem_contained_x(src, inward_sign_src, stem_inward_tuck);
    }
    if tgt_stem_side_x {
        x2 = stem_contained_x(tgt, inward_sign_tgt, stem_inward_tuck);
    }

    let y1 = src_eff_y + src_y_pos * sp * 0.5 + y1_offset;
    let y2 = tgt_eff_y + tgt_y_pos * sp * 0.5 + y2_offset;

    // Note-targeted chord slurs that sit inside both stems spring from one
    // horizontal level. Split the adjustment evenly between the two natural
    // endpoints so both tips remain visibly associated with their selected
    // notes instead of moving one endpoint by the full pitch difference.
    let (mut y1, mut y2) = level_note_targeted_stem_pair(
        y1,
        y2,
        src_targets_note,
        tgt_targets_note,
        src_stem_side_x,
        tgt_stem_side_x,
        src,
        tgt,
        src_eff_y,
        tgt_eff_y,
    );
    // ── Slur/tie endpoint lanes ───────────────────────────────────
    // Encapsulated in `apply_tie_clearance` — when a tie lands on the same
    // notehead and side as this slur tip, the slur takes the next lane
    // outward from the tie's actual tip, composed with its own tip rank.
    (y1, y2) = apply_tie_clearance(
        y1,
        y2,
        src,
        tgt,
        curve_dir,
        end_curve_dir,
        src_tip_rank,
        tgt_tip_rank,
        sp,
    );

    // ── S2 / A4: Articulation pull-back ────────────────
    // Encapsulated in `apply_endpoint_artic_pullback` — pulls slur endpoints
    // OUTWARD when an articulation sits between the notehead and the slur tip
    // Handles mixed-stem and boundary-outside-accent cases.
    (y1, y2) = apply_endpoint_artic_pullback(y1, y2, src, tgt, curve_above, sp);

    // ── Inner-articulation tip lift ───────────────────────────────
    // Encapsulated in `apply_inner_artic_tip_lift`. Scans interior
    // articulation obstacles, finds the worst-protruding edge in the
    // slur direction, and per-endpoint lifts y1/y2 so the slur's
    // natural apex clears that peak by INNER_ARTIC_PAD_SP. Skipped when
    // either endpoint carries an outside-boundary articulation (standard engraving BB
    // p.121) — those glyphs are placed past the un-lifted tip and would
    // re-collide.
    if !direction.preserve_endpoint_positions {
        (y1, y2) = apply_inner_artic_tip_lift(
            y1,
            y2,
            x1,
            x2,
            src,
            tgt,
            obstacles,
            src_event_id,
            tgt_event_id,
            curve_above,
            sp,
        );
    }

    // Beam shapes are sampled at each endpoint's stem X, so sloped and
    // multi-level beams contribute their exact local outer edge rather than a
    // whole-polygon bbox extreme.
    y1 = apply_beam_tip_clearance(y1, src, src_anchor_dir, src_stem_anchor, sp);
    y2 = apply_beam_tip_clearance(y2, tgt, end_curve_dir, tgt_stem_side, sp);

    // ── Staff-line clearance for stem-side endpoints ──────────────
    // Encapsulated in `apply_staff_line_clearance` — nudges stem-side
    // endpoints away from staff lines so the tip never lands ON a line
    //, standard practice-snap).
    if src_stem_anchor {
        y1 = apply_staff_line_clearance(y1, src_anchor_dir, src_eff_y, sp);
    }
    if tgt_stem_side {
        y2 = apply_staff_line_clearance(y2, curve_dir, tgt_eff_y, sp);
    }
    let pitch_slope = tgt_eff_y - src_eff_y + (tgt_y_pos - src_y_pos) * sp * 0.5;
    let mixed_stems = src.stem_up != tgt.stem_up;
    let tilt_context = (pitch_slope, src_stem_side, tgt_stem_side, mixed_stems);
    (y1, y2) = correct_mixed_tilt(y1, y2, tilt_context);
    // notehead — standard engraving practice ends a slur at the notehead,
    // NOT at a trailing augmentation dot (the dot sits clear of the curve
    // in its own staff space), so no rightward shift is applied for dots.
    //
    // Note: this is a tiny, single-step shift (no iteration). The
    // scorer (S9, future) would refine; for now this is good enough.
    if let Some(acc_x) = src.accidental_right_x {
        // The accidental sits left of the notehead; if we're starting
        // a slur from this note, ensure we don't visually clip the
        // accidental on the curve's inner side.
        if acc_x >= x1 - 0.2 * sp && acc_x < x1 {
            // Pull the start slightly leftward to give the accidental room.
            x1 = acc_x - 0.1 * sp;
        }
    }

    // Grace magnification is already consumed by stem-side endpoint placement
    // and remains available to the candidate input. Midpoint/tip thickness is
    // a property of the authored slur style, not silently changed when only
    // one endpoint happens to be a grace note.

    // Snap endpoints off staff lines: if the endpoint Y lands within ~0.15 sp
    // of a staff line (positions 0,2,4,6,8 in half-spaces from top), nudge it
    // away by ~0.4 sp in curve_dir so the tip sits in a space, not on a line.
    // Standard engraving practice: the tip must never sit on a staff line.
    let snap_off_line = |y: f64, eff_y: f64| -> f64 {
        let half_spaces = (y - eff_y) / (sp * 0.5);
        let nearest = half_spaces.round();
        // Only snap if we're on or near a staff line (positions 0..=8) and
        // within ~0.15 sp of it.
        if (0.0..=8.0).contains(&nearest)
            && (nearest as i32) % 2 == 0
            && (half_spaces - nearest).abs() < 0.30
        {
            y + curve_dir * tuning::STAFF_LINE_NUDGE_SP * sp
        } else {
            y
        }
    };
    (y1, y2) = (snap_off_line(y1, src_eff_y), snap_off_line(y2, tgt_eff_y));

    // ── Default shoulder shape ────────────────────────────────────
    // Length-dependent CP indent (standard engraving practice schedule). CP indent
    // is `(1 - shoulderW) / 2`, so shoulderW=0.5 → indent=0.25, shoulderW=0.6
    // → indent=0.20, shoulderW=0.7 → indent=0.15.
    // standard engraving practice.
    let dx = x2 - x1;
    let dy = y2 - y1;
    let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
    let d_sp = chord_len / sp;
    let cp_indent: f64 = if d_sp < 2.0 {
        0.20 // shoulderW = 0.60
    } else if d_sp < 10.0 {
        0.25 // shoulderW = 0.50 (most common range)
    } else if d_sp < 18.0 {
        0.20 // shoulderW = 0.60
    } else {
        config.slur_cp_indent.min(0.15) // very long: fall back to config (0.15)
    };

    // ── Collision avoidance + encompass + apex shift + cap ───────
    // Encapsulated in `compute_shoulder_and_apex` — runs the full S4
    // pipeline (chord-line intrusion → required shoulder → slope-aware
    // apex shift → 2-pass re-evaluation → cap with endpoint-lift
    // overflow). Returns the final (needed_shoulder, apex_shift_frac,
    // possibly-lifted y1, y2).
    let preserve_endpoint_positions = direction.preserve_endpoint_positions
        || src.endpoint_articulation_relation == Some(super::EndpointArticulationRelation::Outside)
        || tgt.endpoint_articulation_relation == Some(super::EndpointArticulationRelation::Outside)
        || src.outgoing_tie
        || src.incoming_tie
        || tgt.outgoing_tie
        || tgt.incoming_tie;
    // A stricter subset: endpoints whose Y is load-bearing for something else.
    // A tie endpoint anchors the slur/tie stack, and an outside articulation
    // fixes the tip it sits beyond — tilting either would break a
    // relationship rather than merely move a curve. Notehead attachment
    // (`direction.preserve_endpoint_positions`) is only a preference, so it
    // still permits the small tilt slant reduction asks for.
    let endpoints_pinned = src.endpoint_articulation_relation
        == Some(super::EndpointArticulationRelation::Outside)
        || tgt.endpoint_articulation_relation == Some(super::EndpointArticulationRelation::Outside)
        || src.outgoing_tie
        || src.incoming_tie
        || tgt.outgoing_tie
        || tgt.incoming_tie;
    let CollisionResult {
        mut needed_shoulder,
        mut apex_shift_frac,
        y1: new_y1,
        y2: new_y2,
    } = compute_shoulder_and_apex(
        x1,
        x2,
        y1,
        y2,
        chord_len,
        curve_above,
        curve_dir,
        sp,
        config,
        obstacles,
        src_event_id,
        tgt_event_id,
        preserve_endpoint_positions,
        endpoints_pinned,
    );
    y1 = new_y1;
    y2 = new_y2;

    // Recompute values that downstream phases (nested-slur shrink, cross-
    // staff factor, apex line-snap) still need. These are pure functions
    // of stable inputs (config, sp, x1, x2, chord_len) so duplicating is
    // cheap and keeps the extraction's contract minimal.
    let mut shoulder_cap = config.slur_shoulder_max * sp;
    if preserve_endpoint_positions {
        shoulder_cap = shoulder_cap.max(needed_shoulder);
    }
    let mid_x = (x1.min(x2) + x1.max(x2)) * 0.5;
    let default_shoulder = {
        let w = chord_len / sp;
        let x_param = w * config.slur_rise_rate / config.slur_height_inf;
        config.slur_height_inf
            * sp
            * (2.0 / std::f64::consts::PI)
            * (std::f64::consts::PI * x_param / 2.0).atan()
    };

    // ── S7: Nested slur clearance ────────────────────────────────
    // Encapsulated in `apply_nested_shoulder_adjust` — bumps the shoulder
    // up for each enclosed inner slur and shrinks it for each strict
    // outer slur; standard engraving practice).
    needed_shoulder = apply_nested_shoulder_adjust(
        needed_shoulder,
        nest_depth,
        inner_depth,
        default_shoulder,
        shoulder_cap,
        sp,
    );

    // ── S6 finish: Cross-staff height-factor reduction ──────────
    // When endpoints span a large staff gap (>3.5sp), shrink shoulder by
    // 0.85x. The inflection naturally sits in the empty inter-staff space, so
    // a tall arc would balloon outside the system. Independent of S6 direction
    // default — applies even with explicit side. standard engraving practice
    // `Chord::isCrossStaff()` height adjust;cross-staff slurs.
    if direction.is_cross_staff_geometric
        && direction.staff_gap_sp > tuning::CROSS_STAFF_GAP_THRESHOLD_SP
    {
        needed_shoulder *= tuning::CROSS_STAFF_HEIGHT_FACTOR;
        if needed_shoulder < tuning::MIN_SHOULDER_SP * sp {
            needed_shoulder = tuning::MIN_SHOULDER_SP * sp;
        }
    }

    // ── S5 / G-C: Staff-line apex snap (long slurs only) ─────────
    // Encapsulated in `apply_apex_line_snap` — for phrase-length slurs
    // (≥ APEX_LINE_SNAP_PHRASE_GATE_SP), nudge the shoulder when the
    // bezier apex would land on a staff lineG-C).
    needed_shoulder = apply_apex_line_snap(
        needed_shoulder,
        chord_len,
        mid_x,
        apex_shift_frac,
        x1,
        x2,
        y1,
        y2,
        curve_dir,
        src_eff_y,
        tgt_eff_y,
        shoulder_cap,
        sp,
    );

    // ── S9: bounded deterministic candidate selection ───────────
    // The established heuristic is candidate zero and therefore wins exact
    // ties. Alternatives vary only shoulder height or bounded apex bias, are
    // scored against the same exact obstacle slice, and are disabled entirely
    // when engrave-mode handles express hard author intent.
    let shape_input = SlurShapeInput {
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        cp_indent,
        heuristic_shoulder: needed_shoulder,
        heuristic_apex_shift: apex_shift_frac,
        default_shoulder,
        shoulder_cap,
        staff_y: (src_eff_y + tgt_eff_y) * 0.5,
        sp,
        obstacles,
        source_event_id: src_event_id,
        target_event_id: tgt_event_id,
        has_manual_shape: slur.shape.is_some(),
    };
    let selected = select_slur_candidate(&shape_input);
    needed_shoulder = selected.candidate.shoulder;
    apex_shift_frac = selected.candidate.apex_shift;

    needed_shoulder = apply_multi_event_phrase_lift(
        needed_shoulder,
        shoulder_cap,
        x1,
        x2,
        src.voice_idx,
        obstacles,
        src_event_id,
        tgt_event_id,
        slur.shape.is_some(),
        sp,
    );
    needed_shoulder = apply_enclosing_tuplet_clearance(
        needed_shoulder,
        apex_shift_frac,
        &shape_input,
        tuplet_obstacles,
    );

    let eid = element_id::slur(authored_src_event_id, &slur.target);
    let thickness = config.slur_thickness * sp;
    let endpoint_thickness = (config.slur_endpoint_thickness * sp).clamp(0.001, thickness);
    // Apply engrave-mode endpoint deltas (p0, p3) to the input endpoints so
    // both the bezier and the published SlurGeometry stay consistent.
    let shape = slur.shape.as_ref();
    let (mut x1, mut y1, mut x2, mut y2) = (x1, y1, x2, y2);
    if let Some(s) = shape {
        if let Some(p) = s.p0 {
            x1 += p[0] * sp;
            y1 += p[1] * sp;
        }
        if let Some(p) = s.p3 {
            x2 += p[0] * sp;
            y2 += p[1] * sp;
        }
    }
    let (cmd, spine) = compute_slur_bezier(
        x1,
        y1,
        x2,
        y2,
        curve_dir,
        needed_shoulder,
        cp_indent,
        apex_shift_frac,
        thickness,
        endpoint_thickness,
        line_style,
        shape.map(|s| {
            (
                None,
                s.p1.map(|p| (p[0] * sp, p[1] * sp)),
                s.p2.map(|p| (p[0] * sp, p[1] * sp)),
                None,
            )
        }),
    );
    dl.slur_geometries.push(crate::render::SlurGeometry {
        element_id: eid.clone(),
        p0_x: x1,
        p0_y: y1,
        p1_x: spine.0,
        p1_y: spine.1,
        p2_x: spine.2,
        p2_y: spine.3,
        p3_x: x2,
        p3_y: y2,
        thickness,
        curve_dir,
        sp,
    });
    // Precise collision/skyline geometry: a thin band sampled along the slur's
    // cubic spine, so queries see the local arc height at each X instead of the
    // pessimistic bounding box of a wide, shallow slur.
    let band = crate::layout::curves::sample_cubic_band(
        (x1, y1),
        (spine.0, spine.1),
        (spine.2, spine.3),
        (x2, y2),
        thickness,
    );
    dl.push_shape_band(
        band,
        eid.clone(),
        crate::render::ElementKind::Slur,
        None,
        None,
    );
    dl.push_tagged(cmd, eid);
}

/// Compute a filled bezier with symmetric shoulder height and an optional
/// horizontal apex shift. Both control points sit at the same perpendicular
/// distance from the chord, but their chord-fraction positions can be biased
/// toward one end to move the apex sideways (used for collision avoidance).
///
/// standard engraving practice — symmetric
/// `shoulderH`, with `shoulderOffset.x` shifting both CPs together along the
/// chord axis.
///
/// Optional per-handle deltas in layout units (`(x, y)` for each of P0..P3),
/// supplied by engrave-mode edits.
pub(super) type HandleDelta = Option<(f64, f64)>;
pub(super) type HandleDeltas = (HandleDelta, HandleDelta, HandleDelta, HandleDelta);

pub(super) fn compute_slur_bezier(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    curve_dir: f64,
    shoulder_h: f64,
    cp_indent: f64,
    apex_shift_frac: f64,
    thickness: f64,
    endpoint_thickness: f64,
    line_style: u8,
    // Optional engrave-mode handle deltas (already converted to layout units):
    // (p0_delta, p1_delta, p2_delta, p3_delta).
    handle_deltas: Option<HandleDeltas>,
) -> (RenderCommand, (f64, f64, f64, f64)) {
    // Chord vector and perpendicular
    let dx = x2 - x1;
    let dy = y2 - y1;
    let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
    let ux = dx / chord_len;
    let uy = dy / chord_len;
    let px = -uy * curve_dir;
    let py = ux * curve_dir;

    // Apply apex shift to both CP fractions in the same direction. The shift
    // is clamped so the inner spacing (1 - 2*cp_indent) stays positive AND
    // neither control point passes an endpoint: `f1 >= 0` needs
    // `shift >= -cp_indent`, `f2 <= 1` needs `shift <= cp_indent`. Letting a
    // control point overshoot its endpoint makes the curve double back, which
    // inverts the tapered tip and renders as a twisted bowtie at the end.
    let max_shift = (0.5 - cp_indent - 0.02).max(0.0).min(cp_indent);
    let shift = apex_shift_frac.clamp(-max_shift, max_shift);
    let f1 = cp_indent + shift;
    let f2 = (1.0 - cp_indent) + shift;

    // Reserve a tangential run at each end. `max_shift` is bounded by the
    // indent, so a full shift can otherwise land a control point exactly on
    // its endpoint; the curve then has no along-chord travel there and leaves
    // square to the chord no matter how shallow the arc is.
    let f1 = f1.max(tuning::MIN_CP_FRACTION);
    let f2 = f2.min(1.0 - tuning::MIN_CP_FRACTION);

    // A slur is never taller than it is wide.
    let span_w = (x2 - x1).abs();
    let shoulder_h = shoulder_h.min(span_w.max(0.01));

    // Bound the angle at which the curve leaves each notehead.
    //
    // In the chord frame a control point sits `chord_len * f` along the chord
    // and `shoulder_h` across it, so their ratio is the departure angle.
    // Working here rather than in X matters: the chord's slope is already
    // factored out, so the bound behaves the same on a level slur as on a
    // steep one. The nearer control point governs, being the one that runs
    // out of room first.
    //
    // This is also what keeps the X clamp below from having to act. Clamping
    // X alone would leave the control point directly above its endpoint, so
    // the curve would leave the notehead square to the chord — trading a fold
    // for a hook. Shortening the shoulder keeps the control point on its ray
    // and simply flattens the arc.
    let reach = chord_len * f1.min(1.0 - f2);
    let shoulder_h = shoulder_h.min(reach * tuning::MAX_DEPARTURE_TAN);

    // Also bound it by the room left in X, since that is what the clamp below
    // would otherwise take out of the curve's shape. The perpendicular's
    // horizontal component is `|px|` per unit of shoulder, and both contours
    // are displaced a further `thickness/2` along it.
    //
    // Floored at half the requested arc: driving the shoulder to zero to
    // satisfy X turns the slur into a straight line, which is a worse defect
    // than the one being avoided. The clamp below remains as the backstop for
    // whatever the floor leaves unresolved.
    let half_t = thickness * 0.5;
    let shoulder_h = if px.abs() > 1e-9 {
        let budget = if px > 0.0 {
            span_w * (1.0 - f2)
        } else {
            span_w * f1
        };
        let bound = (budget / px.abs() - half_t).max(0.0);
        shoulder_h.min(bound).max(shoulder_h * 0.5)
    } else {
        shoulder_h
    };

    // Symmetric perpendicular offset for both CPs.
    let mut cp1_x = x1 + ux * chord_len * f1 + px * shoulder_h;
    let mut cp1_y = y1 + uy * chord_len * f1 + py * shoulder_h;
    let mut cp2_x = x1 + ux * chord_len * f2 + px * shoulder_h;
    let mut cp2_y = y1 + uy * chord_len * f2 + py * shoulder_h;

    // Tangent rule: neither control point may sit outside the endpoints
    // horizontally. `f1`/`f2` bound the tangential component, and the cap
    // above bounds the shoulder, but the perpendicular still contributes a
    // horizontal term proportional to the chord's slope — enough on a sloped
    // chord to carry a control point past its endpoint even when both other
    // bounds hold. A control point outside the span reverses the curve's
    // direction of travel there, so the outline doubles back and the tapered
    // tip renders as a pinch instead of a point.
    let (span_lo, span_hi) = if x1 < x2 { (x1, x2) } else { (x2, x1) };
    cp1_x = cp1_x.clamp(span_lo, span_hi);
    cp2_x = cp2_x.clamp(span_lo, span_hi);

    // Apply engrave-mode handle deltas after computing defaults so user edits
    // compose with automatic collision avoidance.
    let mut x1 = x1;
    let mut y1 = y1;
    let mut x2 = x2;
    let mut y2 = y2;
    if let Some((d0, d1, d2, d3)) = handle_deltas {
        if let Some((dx, dy)) = d0 {
            x1 += dx;
            y1 += dy;
        }
        if let Some((dx, dy)) = d1 {
            cp1_x += dx;
            cp1_y += dy;
        }
        if let Some((dx, dy)) = d2 {
            cp2_x += dx;
            cp2_y += dy;
        }
        if let Some((dx, dy)) = d3 {
            x2 += dx;
            y2 += dy;
        }
    }

    // Ties and slurs are the same engraved stroke; only the spine differs.
    // Hand the midline path to the shared graver so the swell and tapered
    // tips can't drift between the two pipelines.
    let cmd = super::super::curves::engrave_stroke(
        &super::super::curves::StrokeSpine {
            x1,
            y1,
            cp1_x,
            cp1_y,
            cp2_x,
            cp2_y,
            x2,
            y2,
            curve_dir,
        },
        thickness,
        endpoint_thickness,
        line_style,
    );
    (cmd, (cp1_x, cp1_y, cp2_x, cp2_y))
}

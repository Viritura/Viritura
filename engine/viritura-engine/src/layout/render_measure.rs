// Core measure rendering (split from original 2,451-line file)

use super::beams::*;
use super::config::LayoutConfig;
use super::element_id;
use super::grace::*;
use super::measure::MID_CLEF_LEFT_PAD_SP;
use super::measure::{prefix_layout, AlignedPrefix, PrefixContext};
use super::render_annotations::*;
use super::render_articulations::*;
use super::render_barlines::*;
use super::render_events::*;
use super::render_lyrics::*;
use super::render_signatures::*;
use super::render_tremolos::*;
use super::time_signatures;
use super::tuplets::*;
use super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

mod measure_repeats;
mod multimeasure_rests;

pub(crate) use measure_repeats::*;
pub(crate) use multimeasure_rests::*;

/// Middle staff line position in half-spaces from the top line.
pub(super) const MIDDLE_LINE_POS: f64 = 4.0;

/// Horizontal footprint (in spaces) of the 2/3-size change clef engraved in the
/// leading gap BEFORE a mid-system start-of-measure barline. The per-staff
/// barline (`render_measure_prefix`) and the inter-staff barline connectors
/// (`render_inter_staff_barlines`) both shift right by this amount on a
/// clef-change measure, so they MUST read the same constant or the barline
/// splits visually at the connector. Sized for the widest change clef (the G
/// clef, ~1.79sp at 2/3 size) plus padding on both sides and clearance for a
/// wide (double) barline's left stroke.
pub(crate) const CLEF_CHANGE_LEADING_GAP_SP: f64 = 3.2;

/// Padding (in spaces) between a mid-system change clef's right edge and the
/// LEFT ink edge of the barline it precedes.
pub(crate) const CLEF_TO_BARLINE_PAD_SP: f64 = 0.7;

/// Leading gap reserved in a clef-change measure's prefix for the change clef
/// drawn BEFORE the barline. The barline (and anything that aligns to it, such
/// as a rehearsal mark) sits at `ml.x + leading_clef_gap`, NOT at `ml.x`. A
/// mid-system clef change pushes the barline right by this gap; the opening
/// measure of the score (index 0) and the first measure on a system never carry
/// a leading change clef, so they return 0.
pub(crate) fn measure_leading_clef_gap(
    ml: &MeasureLayout,
    sp: f64,
    clef_change_measures: &HashSet<usize>,
) -> f64 {
    if ml.resolved.index != 0
        && !ml.is_first_on_system
        && clef_change_measures.contains(&ml.resolved.index)
    {
        CLEF_CHANGE_LEADING_GAP_SP * sp
    } else {
        0.0
    }
}

/// Exported measure geometry starts at the visible left barline. A change clef
/// engraved before that barline occupies layout width but is not part of the
/// selectable bar span, so remove the same leading gap from x, width, and prefix.
pub(crate) fn measure_bounds_geometry(
    ml: &MeasureLayout,
    leading_clef_gap: f64,
) -> (f64, f64, f64) {
    (
        ml.x + leading_clef_gap,
        (ml.width - leading_clef_gap).max(0.0),
        (ml.prefix_width - leading_clef_gap).max(0.0),
    )
}

/// Measure indices that carry a mid-score start-of-measure clef change
/// (`position == None`) in any of the SHOWN staves, read from the already-
/// resolved per-staff measures. Standard engraving practice engraves such a
/// change BEFORE the preceding barline, and the gap that opens for it shifts the
/// shared barline — so it must be applied on every shown staff that shares that
/// barline. Scoped to the staves actually present (`all_resolved`), NOT the
/// whole score: an individual-part view must not reserve a gap for a clef change
/// that belongs to a different part. Measure 0 is excluded (the opening clef is
/// the staff's primary clef, not a change).
pub(crate) fn clef_change_measure_set_resolved<R: AsRef<[ResolvedMeasure]>>(
    all_resolved: &[R],
) -> HashSet<usize> {
    let mut set = HashSet::new();
    for staff in all_resolved {
        for rm in staff.as_ref() {
            if rm.index == 0 {
                continue;
            }
            let changes = rm
                .part
                .clefs
                .as_ref()
                .is_some_and(|clefs| clefs.iter().any(|c| c.position.is_none()));
            if changes {
                set.insert(rm.index);
            }
        }
    }
    set
}

/// Build the clef-change measure set from already-laid-out measure layouts,
/// scoped to EXACTLY the staves present. The leading-clef gap shifts the shared
/// barline, so the set must include only the staves that actually share that
/// barline in this view: in an individual-part view (a single instrument's
/// staves), a clef change that belongs to a DIFFERENT part must not reserve a
/// gap here — otherwise the bassoon's barline shifts for a violin clef change it
/// never carries. Measure 0 is excluded (the opening clef is the staff's primary
/// clef, not a change).
pub(crate) fn clef_change_measure_set_from_layouts(
    all_staff_layouts: &[Vec<MeasureLayout>],
) -> HashSet<usize> {
    let mut set = HashSet::new();
    for layouts in all_staff_layouts {
        for ml in layouts {
            if ml.resolved.index == 0 {
                continue;
            }
            let changes = ml
                .resolved
                .part
                .clefs
                .as_ref()
                .is_some_and(|clefs| clefs.iter().any(|c| c.position.is_none()));
            if changes {
                set.insert(ml.resolved.index);
            }
        }
    }
    set
}

/// Compute the effective staff_y for a cross-staff event.
/// If the event has a `staff` override that differs from its parent sequence's
/// staff, anchor it to the target staff's Y.
///
/// `event.staff` (and `sequence_staff`) are **part-relative** staff numbers
/// (1 = the part's top staff). `staff_y_offsets` holds the Y of every visual
/// staff in the *whole system* (across all parts), so we must NOT index it with
/// the part-relative staff number directly — for any part that isn't the first
/// in the system that would land the note on some other part's staff (e.g. a
/// piano cross-staff note jumping onto a flute staff). Instead we recover the
/// current staff's visual index from `staff_y` (the caller always passes
/// `staff_y_offsets[vi]`) and shift by the part-relative delta, since a part's
/// staves are contiguous in system order.
/// Falls back to the default `staff_y` when no cross-staff override is active.
pub(super) fn cross_staff_y(
    el: &EventLayout,
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
) -> f64 {
    cross_staff_y_scalar(el.event.staff, el.sequence_staff, staff_y, staff_y_offsets)
}

/// Arena-friendly variant of [`cross_staff_y`] taking the two scalar fields it
/// reads (`event.staff`, `sequence_staff`) directly, so callers iterating the
/// `EventArena` need not materialize an `EventLayout`.
pub(super) fn cross_staff_y_scalar(
    event_staff: Option<u32>,
    sequence_staff: u32,
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
) -> f64 {
    if let Some(target_staff) = event_staff {
        if target_staff != sequence_staff {
            if let Some(offsets) = staff_y_offsets {
                // Recover this staff's visual index by matching its Y, then
                // offset by the part-relative staff delta.
                if let Some(cur_idx) = offsets.iter().position(|&y| (y - staff_y).abs() < 0.5) {
                    let delta = target_staff as i64 - sequence_staff as i64;
                    let tgt = cur_idx as i64 + delta;
                    if tgt >= 0 && (tgt as usize) < offsets.len() {
                        return offsets[tgt as usize];
                    }
                }
            }
        }
    }
    staff_y
}

// ═══════════════════════════════════════════
// Rendering into DisplayList
// ═══════════════════════════════════════════

/// Paint a courtesy page-turn hint in the bottom-right margin of an outgoing
/// page telling the player that the next page opens with `rest_measures` bars
/// of rest, so a turn here is safe. This mirrors the hand annotation
/// performers write — a small "⊢N⊣" at the foot of the page.
///
/// It is drawn with the literal tack characters rather than a miniature
/// multimeasure-rest H-bar: a real MMR symbol risks being misread as an actual
/// performance direction (and double-counted), whereas "⊢N⊣" reads clearly as
/// a reminder. The text is top-aligned a 1sp gap below the bottom margin border
/// so it sits in the margin band below the engraved content, clear of music ink
/// that runs right up to the frame edge.
pub(crate) fn render_page_turn_hint(
    dl: &mut DisplayList,
    page: &PageLayout,
    page_width: f64,
    config: &LayoutConfig,
    rest_measures: usize,
) {
    if rest_measures == 0 {
        return;
    }
    let sp = config.sp;
    // Right-aligned to the right margin; the top of the text sits a 1sp gap
    // below the bottom margin border so the "⊢N⊣" hangs into the bottom margin
    // without touching music ink that runs right up to the frame edge inside
    // the inset band.
    let right_edge = page_width - config.page_margin_right * sp;
    let bottom_margin_line = page.y_offset + page.height - config.page_margin_bottom * sp;

    dl.push(RenderCommand::DrawText {
        x: right_edge,
        y: bottom_margin_line + 1.0 * sp,
        text: format!("⊢{rest_measures}⊣"),
        font: "serif".into(),
        size: 3.0 * sp,
        color: "#000000".into(),
        align: TextAlign::Right,
        baseline: TextBaseline::Top,
    });
}

/// Paint every page-turn courtesy hint onto its outgoing page. Each hint names
/// the last system of the page that should carry it; the page box is located
/// in `dl.pages` by that system so the placement is correct even when a
/// dedicated title page has been prepended (which shifts page numbering).
pub(crate) fn render_page_turn_hints(
    dl: &mut DisplayList,
    hints: &[crate::layout::page_turn::PageTurnHint],
    page_width: f64,
    config: &LayoutConfig,
) {
    // Resolve each hint to a concrete page box under an immutable borrow first,
    // then paint (which mutably borrows `dl.commands`).
    let resolved: Vec<(PageLayout, usize)> = hints
        .iter()
        .filter_map(|h| {
            let idx = dl
                .pages
                .iter()
                .position(|p| p.system_indices.contains(&h.last_system))?;
            // The final page is never an outgoing page — nothing follows it.
            if idx + 1 >= dl.pages.len() {
                return None;
            }
            Some((dl.pages[idx].clone(), h.rest_measures))
        })
        .collect();
    for (page, rest_measures) in resolved {
        render_page_turn_hint(dl, &page, page_width, config, rest_measures);
    }
}

/// Render the measure's "prefix" elements — start barline, courtesy/start
/// clef, key signature, time signature, and any condensing-change marker.
/// Returns the updated x cursor positioned just to the right of the prefix
/// (i.e., where event rendering should begin).
#[allow(clippy::too_many_arguments)]
fn render_measure_prefix(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    prev_has_repeat_end: bool,
    prev_barline_type: Option<&BarlineType>,
    clef_change_measures: &HashSet<usize>,
) -> f64 {
    let rm = &ml.resolved;
    let is_first = rm.index == 0;
    let staff_height = 4.0 * sp;
    let mut x_cursor = ml.x;
    let has_repeat_start = rm.global.repeat_start.is_some();
    let measure_leading_gap = measure_leading_clef_gap(ml, sp, clef_change_measures);
    let prefix = prefix_layout(
        rm,
        sp,
        ml.is_first_on_system,
        Some(AlignedPrefix {
            width: ml.prefix_width,
            first_onset_padding: ml.first_onset_padding,
        }),
        Some(measure_leading_gap),
        PrefixContext::MeasureLayout,
        config,
    );

    // Detect a start-of-measure clef. In MNX, explicit start clefs have
    // position=None. Carried-forward clefs injected by the resolver have
    // position=(0,1) which also represents beat 0.
    let start_clef = rm.part.clefs.as_ref().and_then(|clefs| {
        clefs.iter().find(|c| match &c.position {
            None => true,
            Some(p) => p.fraction.0 == 0,
        })
    });
    // Explicit clef changes (position=None) — only these trigger change clefs.
    let explicit_clef_change = rm
        .part
        .clefs
        .as_ref()
        .and_then(|clefs| clefs.iter().find(|c| c.position.is_none()));

    // Mid-system start-of-measure clef change. Standard engraving practice
    // engraves it BEFORE the preceding barline (at the end of the previous
    // measure), not after it. `clef_change_measures` is the measure-level set
    // (any part of this measure changes clef), so the shared barline shifts
    // right by the same leading gap on EVERY staff and stays vertically aligned
    // even when only one part actually changes clef. The leading-gap space is
    // reserved uniformly by `compute_prefix_width`.
    let is_clef_change_measure =
        !is_first && !ml.is_first_on_system && clef_change_measures.contains(&rm.index);
    // Footprint of the 2/3-size change clef drawn in the leading gap.
    let leading_clef_gap = prefix.leading_clef_gap;

    // Barline at start (except first measure, unless it has repeat_start).
    // The barline type comes from the PREVIOUS measure's barline property (MNX: end-of-measure).
    //
    // Convention: on a system break, the previous measure's end barline is
    // already rendered at the end of the previous system, so the first
    // measure of a new system should not redraw it as a left "initial"
    // barline. A repeat_start belongs semantically to the start of the new
    // measure and is always drawn (handled by the `else if` branch below).
    // Standard engraving practice: the initial system-start bar is hidden by
    // default for single-staff parts.
    //
    // A repeat-start barline that opens a system (or the piece) is deferred:
    // the restated clef and key signature come first, with the start-repeat
    // barline drawn immediately before the music (see below). Its 1.5sp slot is
    // still reserved at the end of the prefix region.
    let defer_repeat_start = prefix.defer_repeat_start;
    if !is_first && !ml.is_first_on_system {
        let start_bt = BarlineKind::at_boundary(
            prev_has_repeat_end,
            has_repeat_start,
            prev_barline_type,
            BarlineType::Regular,
        );
        // Mid-system clef change: draw the change clef (only on the staff that
        // actually changes clef) in the leading gap BEFORE the barline, then
        // advance the cursor past the gap uniformly so the barline lands at the
        // same x on every staff regardless of which parts changed clef.
        if is_clef_change_measure {
            if let Some(pc) = explicit_clef_change {
                // Right-align the change clef against the barline's LEFT ink
                // edge (not its center) with a fixed pad, so it clears wide
                // barlines (double/final) instead of overhanging their left
                // stroke. The leading gap is sized for the widest (G) change
                // clef, so narrower clefs simply start further right. The
                // `.max` clamps against overflowing into the previous measure
                // in the pathological wide-barline case.
                let barline_x = x_cursor + leading_clef_gap;
                let clef_w = change_clef_width(&pc.clef, sp);
                let left_extent = barline_left_extent(&start_bt, config, sp);
                let clef_x = (barline_x - left_extent - CLEF_TO_BARLINE_PAD_SP * sp - clef_w)
                    .max(x_cursor + 0.2 * sp);
                let cmd_idx = dl.commands.len();
                render_change_clef(dl, clef_x, staff_y, sp, &pc.clef);
                dl.tag_command(cmd_idx, element_id::clef(ml.part_index, rm.index));
            }
            x_cursor += leading_clef_gap;
        }
        let cmd_idx = dl.commands.len();
        render_barline(dl, x_cursor, staff_y, staff_height, sp, config, &start_bt);
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::barline(rm.index));
        }
        match start_bt {
            BarlineKind::RepeatStart | BarlineKind::RepeatBoth => x_cursor += 1.5 * sp,
            _ => x_cursor += 0.5 * sp,
        }
    }

    // Condensing change marker: small dashed line above the staff at the barline
    // where a condensing mode transition occurs (e.g., unison → divisi).
    // Ref: docs/plans/condensing-and-doubling.md §3
    if rm.condensing_change {
        let marker_x = ml.x;
        let marker_top = staff_y - 2.0 * sp;
        let marker_bottom = staff_y - 0.5 * sp;
        let dash_len = 0.3 * sp;
        let gap_len = 0.3 * sp;
        // Use a very thin width (0.04*sp) to avoid being counted as stems by tests
        let marker_width = 0.04 * sp;
        let mut y = marker_top;
        while y < marker_bottom {
            let end = (y + dash_len).min(marker_bottom);
            dl.push(RenderCommand::DrawLine {
                x1: marker_x,
                y1: y,
                x2: marker_x,
                y2: end,
                width: marker_width,
                color: "#999999".to_string(),
            });
            y += dash_len + gap_len;
        }
    }

    // Full-size clef only at the start of a system (first measure on line).
    // A mid-system clef change is `is_first_on_system == false`, so it never
    // reaches this branch — it is drawn before the barline above instead.
    if ml.is_first_on_system || is_first {
        if let Some(pc) = start_clef {
            let cmd_idx = dl.commands.len();
            render_clef(dl, x_cursor + 0.5 * sp, staff_y, sp, &pc.clef);
            x_cursor += clef_prefix_advance_sp(&pc.clef) * sp;
            dl.tag_command(cmd_idx, element_id::clef(ml.part_index, rm.index));
        }
    }

    // Key signature — render on key changes, at the start of the score, and
    // at the start of each system (continuation key signatures).
    // Ref:— key signatures repeat at every system start.
    let is_key_change = rm.global.key.is_some();
    let cancel_count = if is_key_change {
        rm.prev_key.cancellation_count(&rm.active_key)
    } else {
        0
    };
    let needs_key_render = (is_key_change || is_first || ml.is_first_on_system)
        && (rm.active_key.accidental_count() != 0 || cancel_count > 0);
    if needs_key_render {
        let clef_sign = rm
            .part
            .clefs
            .as_ref()
            .and_then(|c| c.first())
            .map(|pc| &pc.clef.sign)
            .unwrap_or(&ClefSign::G);
        let cancel_prev = if cancel_count > 0 {
            Some(&rm.prev_key)
        } else {
            None
        };
        let cmd_idx = dl.commands.len();
        x_cursor += render_key_signature(
            dl,
            x_cursor,
            staff_y,
            sp,
            &rm.active_key,
            clef_sign,
            cancel_prev,
        );
        // Tag every accidental, not just the first: the selection highlight
        // re-inks an element's own commands, so an untagged accidental would
        // stay black while its neighbours turned blue.
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::key_sig(ml.part_index, rm.index));
        }
    }

    // Time signature — align across staves by positioning relative to the
    // (possibly forced) prefix boundary. This ensures that when different staves
    // have different key sig widths (e.g., transposing instruments), the time sig
    // still lines up vertically. standard engraving practice aligns time sigs across staves.
    if let Some(ref ts) = rm.global.time {
        let settings = config.time_signature_settings;
        let time_sig_reserve = time_signatures::prefix_reserve(settings, ts, sp);
        let time_sig_x = ml.x
            + ml.time_signature_x_offset
                .expect("time signature prefix offset");
        if time_sig_x > x_cursor {
            x_cursor = time_sig_x;
        }
        if settings.distribution == crate::model::time::TimeSignatureDistribution::PerStaff {
            let cmd_idx = dl.commands.len();
            render_time_signature(
                dl,
                x_cursor + time_signatures::left_bearing(settings, sp),
                staff_y,
                sp,
                ts,
                settings,
            );
            for ci in cmd_idx..dl.commands.len() {
                dl.tag_command(ci, element_id::time_sig(rm.index));
            }
        }
        x_cursor += time_sig_reserve;
    }

    // A deferred system-start repeat-start barline sits immediately after the
    // clef/key/time prefix — its reserved 1.5sp slot ends one trailing pad
    // (1.2sp) before the first note.
    if defer_repeat_start {
        let bar_x = x_cursor + 0.5 * sp;
        let cmd_idx = dl.commands.len();
        render_barline(
            dl,
            bar_x,
            staff_y,
            staff_height,
            sp,
            config,
            &BarlineKind::RepeatStart,
        );
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::barline(rm.index));
        }
    }

    x_cursor
}

/// Collect every notehead in a measure as an accidental-clearance obstacle
/// rect `(visual_staff, top, bottom, x_left, x_right)` in absolute pixels
/// (top/bottom = center ±0.5sp). Used to pre-seed the system-scoped
/// `acc_obstacles` so an accidental column clears noteheads from EVERY voice
/// on its staff — including voices the grand-staff layout renders in a
/// separate pass, which a per-call notehead scan cannot see. Mirrors the
/// per-event `all_noteheads` geometry (cross-staff y, displaced-second
/// offsets, shared-notehead skip).
pub(crate) fn collect_measure_notehead_obstacles(
    ml: &MeasureLayout,
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
    sp: f64,
    config: &LayoutConfig,
    out: &mut Vec<AccidentalObstacle>,
) {
    let nh_offset_unit = config.notehead_rx * 2.0 * sp;
    for vl in ml.voice_layouts.iter() {
        let ev = &vl.events;
        for ej in 0..ev.len() {
            if ev.event(ej).is_rest() {
                continue;
            }
            let sy = cross_staff_y_scalar(
                ev.event(ej).staff,
                ev.sequence_staff(ej),
                staff_y,
                staff_y_offsets,
            );
            let vstaff = ev.event(ej).staff.unwrap_or(ev.sequence_staff(ej));
            let ex = ev.x(ej);
            let glyph = smufl::notehead_glyph(&ev.event(ej).duration.base);
            let gw = smufl::notehead_width(glyph) * sp;
            let positions = ev.note_positions(ej);
            let offsets = ev.note_x_offsets(ej);
            let shared = ev.shared_noteheads(ej);
            for (k, &posk) in positions.iter().enumerate() {
                if shared.get(k).copied().unwrap_or(false) {
                    continue;
                }
                let off = offsets.get(k).copied().unwrap_or(0.0);
                let xl = ex + off * nh_offset_unit;
                let cy = sy + posk * sp * 0.5;
                out.push(AccidentalObstacle {
                    visual_staff: vstaff,
                    top: cy - 0.5 * sp,
                    bottom: cy + 0.5 * sp,
                    left: xl,
                    right: xl + gw,
                    is_accidental: false,
                    alter: None,
                });
            }
        }
    }
}

#[allow(clippy::too_many_lines)] // single per-measure render pass (barline→prefix→events→annotations); cohesive pipeline stage
pub(crate) fn render_measure(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    measure_repeat_right: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    prev_has_repeat_end: bool,
    prev_barline_type: Option<&BarlineType>,
    global_beamed_ids: &HashSet<String>,
    explicit_beamed_ids: &HashSet<String>,
    lyric_line_order: Option<&[String]>,
    staff_y_offsets: Option<&[f64]>,
    use_beams: bool,
    use_accidental_display: bool,
    slur_map: Option<&super::slurs::SlurParticipationMap>,
    tie_accidentals: Option<&HashMap<String, bool>>,
    mmr_number_extents: &[AboveGlyphBox],
    clef_change_measures: &HashSet<usize>,
    // Shared cross-measure accidental obstacle accumulator. Two simultaneous
    // chords on one staff can live in separate `MeasureLayout`s (separate
    // voices), each rendered by its own `render_measure` call; threading this
    // through the system's measure loop lets a later chord's accidental column
    // clear an earlier one's already-placed accidentals. Each entry is
    // `(visual_staff, top, bottom, x_left, x_right, accidental_alter)` in absolute pixels.
    acc_obstacles: &mut Vec<AccidentalObstacle>,
) {
    // A mid-system clef change pushes the barline right by this gap; anything
    // that aligns to the barline (the rehearsal mark) must shift with it.
    let leading_clef_gap = measure_leading_clef_gap(ml, sp, clef_change_measures);
    let grand_staff = staff_y_offsets.filter(|offsets| offsets.len() > 1);
    let is_top_staff = grand_staff.is_none_or(|offsets| (staff_y - offsets[0]).abs() < 0.01);
    let is_bottom_staff = grand_staff.is_none_or(|offsets| {
        offsets
            .last()
            .is_some_and(|bottom| (staff_y - bottom).abs() < 0.01)
    });
    let grand_staff_center = grand_staff.map(|offsets| {
        (offsets[0] + offsets.last().copied().unwrap_or(offsets[0]) + 4.0 * sp) * 0.5
    });

    // Handle multimeasure rest rendering
    if let Some(count) = ml.multimeasure_rest_count {
        render_multimeasure_rest(
            dl,
            ml,
            staff_y,
            sp,
            config,
            count,
            prev_has_repeat_end,
            is_top_staff,
            grand_staff_center,
        );
        // Above-staff system objects still belong on a multimeasure rest (a
        // tempo or rehearsal mark at the start of a long rest must show). The
        // tempo renderer hops above the big count number to avoid collision —
        // including count numbers in neighbouring multimeasure-rest measures
        // that the tempo text overlaps horizontally.
        if ml.show_system_objects {
            render_tempo_markings(
                dl,
                ml,
                staff_y,
                sp,
                config,
                mmr_number_extents,
                leading_clef_gap,
            );
            render_jump_markers(dl, ml, staff_y, sp, config, mmr_number_extents);
            render_rehearsal_marks(
                dl,
                ml,
                staff_y,
                sp,
                config,
                mmr_number_extents,
                leading_clef_gap,
            );
        }
        render_measure_numbers(dl, ml, staff_y, sp, config, is_bottom_staff);
        return;
    }

    // Render barline + start/change clef + key sig + time sig.
    // The returned x cursor sits just to the right of the prefix region.
    let _x_cursor_after_prefix = render_measure_prefix(
        dl,
        ml,
        staff_y,
        sp,
        config,
        prev_has_repeat_end,
        prev_barline_type,
        clef_change_measures,
    );
    let rm = &ml.resolved;

    // The simile sign replaces the bar's notated content; MNX still permits
    // both, so it is drawn alongside whatever the sequences hold.
    render_measure_repeat(
        dl,
        ml,
        measure_repeat_right,
        staff_y,
        sp,
        config,
        is_top_staff,
    );

    // Events from all voices(including grace notes)
    // Track the accidental in effect at each (step, octave) within this
    // measure, seeded lazily from the key signature. Reset per measure.
    let mut measure_acc: HashMap<(String, i32), i32> = HashMap::new();
    // Record where this measure's event commands begin so dynamics can later
    // treat the articulation glyphs emitted here as collision obstacles.
    let measure_event_cmd_start = dl.commands.len();

    // Cross-event accidental clearance. An accidental column is placed per
    // event from that event's OWN geometry only, so without help it can land on
    // a notehead belonging to a DIFFERENT event on the same staff — either
    // another voice (dense two-voice piano writing) or a neighbouring event in
    // the same voice whose notehead is displaced/close in a fast chromatic run.
    // We gather every notehead (tagged with its owning event so the current
    // event can exclude its own) and pass the same-staff ones to each event so
    // its accidental column shifts left to clear them. Built only when the
    // measure has multiple voices OR any accidentals are shown — cheap guard
    // that skips the common monophonic-no-accidental case.
    // Tuple: (voice_idx, event_idx, visual_staff, center_y, x_left, x_right).
    let all_noteheads: Vec<(usize, usize, u32, f64, f64, f64)> = {
        let nh_offset_unit = config.notehead_rx * 2.0 * sp;
        let mut v = Vec::new();
        for (vidx, vl2) in ml.voice_layouts.iter().enumerate() {
            let ev = &vl2.events;
            for ej in 0..ev.len() {
                if ev.event(ej).is_rest() {
                    continue;
                }
                let sy = cross_staff_y_scalar(
                    ev.event(ej).staff,
                    ev.sequence_staff(ej),
                    staff_y,
                    staff_y_offsets,
                );
                let vstaff = ev.event(ej).staff.unwrap_or(ev.sequence_staff(ej));
                let ex = ev.x(ej);
                let glyph = smufl::notehead_glyph(&ev.event(ej).duration.base);
                let gw = smufl::notehead_width(glyph) * sp;
                let positions = ev.note_positions(ej);
                let offsets = ev.note_x_offsets(ej);
                let shared = ev.shared_noteheads(ej);
                for (k, &posk) in positions.iter().enumerate() {
                    if shared.get(k).copied().unwrap_or(false) {
                        continue;
                    }
                    let off = offsets.get(k).copied().unwrap_or(0.0);
                    let xl = ex + off * nh_offset_unit;
                    let cy = sy + posk * sp * 0.5;
                    v.push((vidx, ej, vstaff, cy, xl, xl + gw));
                }
            }
        }
        v
    };

    // Cross-event accidental clearance (companion to `all_noteheads`). Two
    // chords at the SAME onset on one staff (e.g. an upper and a lower voice)
    // each lay out their accidentals against their own noteheads, so the two
    // stacks land in the same column and collide vertically. Accidental
    // positions are only known once placed, so we accumulate each event's
    // placed-accidental rects in the system-scoped `acc_obstacles` (shared
    // across the measure's voice/staff `MeasureLayout`s) and feed the nearby
    // same-staff ones to subsequent events, which fan their column out to the
    // left to clear them.

    for (voice_idx_0based, vl) in ml.voice_layouts.iter().enumerate() {
        let voice_part_index = vl.part_index_override.unwrap_or(ml.part_index);
        let voice_seq_index = vl.seq_index_override.unwrap_or(vl.voice_index);
        let events = &vl.events;
        for ei in 0..events.len() {
            let ev_x = events.x(ei);
            // Compute the effective staff_y for this event (cross-staff override)
            let event_staff_y = cross_staff_y_scalar(
                events.event(ei).staff,
                events.sequence_staff(ei),
                staff_y,
                staff_y_offsets,
            );

            // Construct element ID for this event (used for tagging sub-elements)
            let event_suffix = element_id::event_suffix(events.id(ei), ei);
            let element_id_str =
                element_id::event(voice_part_index, rm.index, voice_seq_index, &event_suffix);

            // Render grace notes before the main event
            for (gi, gn) in events.grace_notes(ei).iter().enumerate() {
                if gn.after_main {
                    continue;
                }
                let grace_cmd_idx = dl.commands.len();
                render_grace_event(dl, gn, event_staff_y, sp, config, global_beamed_ids);
                let grace_cmd_end = dl.commands.len();
                if grace_cmd_end > grace_cmd_idx {
                    let grace_suffix = element_id::event_suffix(gn.id.as_deref(), gi);
                    let grace_element_id = element_id::grace(
                        voice_part_index,
                        rm.index,
                        voice_seq_index,
                        &event_suffix,
                        &grace_suffix,
                    );
                    for ci in grace_cmd_idx..grace_cmd_end {
                        dl.tag_command(ci, grace_element_id.clone());
                    }
                }
            }

            // Compute clipped ledger-line extensions to maintain minimum gap
            // between adjacent events' ledger lines.
            // Ref: standard engraving practice-based gap algorithm.
            // Use the actual notehead glyph width for each event — whole notes
            // are wider (1.66sp) than quarter/half noteheads (1.18sp).
            let nh_glyph = smufl::notehead_glyph(&events.event(ei).duration.base);
            let nh_w = smufl::notehead_width(nh_glyph) * sp;

            let mut ledger_right_ext = config.ledger_extension;
            let mut ledger_left_ext = config.ledger_extension;
            let min_gap = config.ledger_gap * sp;
            if ei + 1 < events.len() {
                let next_x = events.x(ei + 1);
                let gap_px = next_x - (ev_x + nh_w);
                if gap_px < 2.0 * config.ledger_extension * sp + min_gap {
                    let center = (ev_x + nh_w + next_x) / 2.0;
                    ledger_right_ext = ((center - min_gap / 2.0 - (ev_x + nh_w)) / sp)
                        .max(0.0)
                        .min(config.ledger_extension);
                }
            }
            if ei > 0 {
                let prev_x = events.x(ei - 1);
                let prev_glyph = smufl::notehead_glyph(&events.event(ei - 1).duration.base);
                let prev_w = smufl::notehead_width(prev_glyph) * sp;
                let gap_px = ev_x - (prev_x + prev_w);
                if gap_px < 2.0 * config.ledger_extension * sp + min_gap {
                    let center = (prev_x + prev_w + ev_x) / 2.0;
                    ledger_left_ext = ((ev_x - center - min_gap / 2.0) / sp)
                        .max(0.0)
                        .min(config.ledger_extension);
                }
            }

            let cmd_idx = dl.commands.len();
            // Noteheads of OTHER events on this event's visual staff that its
            // accidental column must clear. Excludes the current event's own
            // noteheads (which the column is intentionally placed against).
            // Restricted to a small x-window around `ev_x` (the accidental sits
            // just left of the notehead) so the inner clearance loop stays
            // cheap.
            let cur_vstaff = events.event(ei).staff.unwrap_or(events.sequence_staff(ei));
            let sibling_noteheads: Vec<(f64, f64, f64)> = if all_noteheads.is_empty() {
                Vec::new()
            } else {
                let win_lo = ev_x - 8.0 * sp;
                let win_hi = ev_x + 2.0 * sp;
                all_noteheads
                    .iter()
                    .filter(|(vidx, eidx, vstaff, _, xl, xr)| {
                        !(*vidx == voice_idx_0based && *eidx == ei)
                            && *vstaff == cur_vstaff
                            && *xr > win_lo
                            && *xl < win_hi
                    })
                    .map(|(_, _, _, cy, xl, xr)| (*cy, *xl, *xr))
                    .collect()
            };
            // Accidentals/noteheads of OTHER events already placed within the
            // same x-window, on this or any staff. We deliberately do NOT filter
            // by staff number: piano cross-staff writing can give two
            // simultaneous voices different staff numbers while they render at
            // the same visual height, so a staff filter would wrongly drop the
            // other voice's glyph. The vertical-band test inside
            // `clear_sibling_obstacles` (absolute y) is the real guard — a
            // glyph on another staff sits well outside the accidental's band.
            let sibling_accidentals: Vec<(f64, f64, f64, f64, Option<i32>)> =
                if acc_obstacles.is_empty() {
                    Vec::new()
                } else {
                    let win_lo = ev_x - 8.0 * sp;
                    let win_hi = ev_x + 2.0 * sp;
                    acc_obstacles
                        .iter()
                        .filter(|obstacle| obstacle.right > win_lo && obstacle.left < win_hi)
                        .filter(|obstacle| obstacle.is_accidental)
                        .map(|obstacle| {
                            (
                                obstacle.top,
                                obstacle.bottom,
                                obstacle.left,
                                obstacle.right,
                                obstacle.alter,
                            )
                        })
                        .collect()
                };
            render_event(
                dl,
                events,
                ei,
                event_staff_y,
                sp,
                config,
                global_beamed_ids,
                &ml.resolved.active_key,
                &mut measure_acc,
                use_accidental_display,
                &element_id_str,
                ledger_left_ext,
                ledger_right_ext,
                ml.resolved.kit.as_ref(),
                slur_map,
                tie_accidentals,
                voice_idx_0based,
                &sibling_noteheads,
                &sibling_accidentals,
                ml.resolved.active_time.measure_beats(),
            );

            // Record this event's placed accidentals so later simultaneous
            // events on the same staff can clear them. Accidentals are SMuFL
            // glyphs in the standard-accidentals block (U+E260..E26F); their
            // vertical footprint uses the same half-space extent convention as
            // the placement skyline. Noteheads (U+E0A0..E0A4) are also recorded
            // from their ACTUAL rendered positions: pre-seeding covers
            // later-rendered voices, and this incremental scan captures the
            // exact placed geometry of already-rendered events (belt-and-
            // suspenders against any pre-seed/render position drift).
            for ci in cmd_idx..dl.commands.len() {
                if let RenderCommand::DrawGlyph {
                    x, y, codepoint, ..
                } = &dl.commands[ci]
                {
                    if (0xE260..=0xE26D).contains(codepoint) {
                        let alter = match *codepoint {
                            0xE260 => Some(-1),
                            0xE261 => Some(0),
                            0xE262 => Some(1),
                            0xE263 => Some(-2),
                            0xE264 => Some(2),
                            0xE265 => Some(3),
                            0xE266 => Some(-3),
                            _ => None,
                        };
                        let (bbox_x, bbox_y, bbox_width, bbox_height) =
                            smufl::glyph_bbox(*codepoint);
                        acc_obstacles.push(AccidentalObstacle {
                            visual_staff: cur_vstaff,
                            top: y + bbox_y * sp,
                            bottom: y + (bbox_y + bbox_height) * sp,
                            left: x + bbox_x * sp,
                            right: x + (bbox_x + bbox_width) * sp,
                            is_accidental: true,
                            alter,
                        });
                    } else if (0xE0A0..=0xE0A4).contains(codepoint) {
                        let w = smufl::notehead_width(*codepoint) * sp;
                        acc_obstacles.push(AccidentalObstacle {
                            visual_staff: cur_vstaff,
                            top: y - 0.5 * sp,
                            bottom: y + 0.5 * sp,
                            left: *x,
                            right: *x + w,
                            is_accidental: false,
                            alter: None,
                        });
                    }
                }
            }

            // Note: render_event already draws a natural-length stem from the
            // notehead using event_staff_y. We do NOT add a "bridge" stem back
            // to the home staff for non-beamed cross-staff events — that's
            // engraving-incorrect (standard engraving practice). Beamed cross-staff
            // events are handled in render_beams via the BETWEEN-staves path.

            // Tag ALL commands produced by this event with a structured element ID
            // so that stems, noteheads, dots, accidentals, ledger lines all share
            // the same ID for hit-testing / selection. Skip commands already tagged
            // with sub-element IDs (e.g., articulations, tremolos).
            let cmd_end = dl.commands.len();
            if cmd_end > cmd_idx {
                for ci in cmd_idx..cmd_end {
                    if !dl.is_tagged(ci) {
                        dl.tag_command(ci, element_id_str.clone());
                    }
                }
            }

            for (gi, gn) in events
                .grace_notes(ei)
                .iter()
                .enumerate()
                .filter(|(_, gn)| gn.after_main)
            {
                let grace_cmd_idx = dl.commands.len();
                render_grace_event(dl, gn, event_staff_y, sp, config, global_beamed_ids);
                let grace_cmd_end = dl.commands.len();
                if grace_cmd_end > grace_cmd_idx {
                    let grace_suffix = element_id::event_suffix(gn.id.as_deref(), gi);
                    let grace_element_id = element_id::grace(
                        voice_part_index,
                        rm.index,
                        voice_seq_index,
                        &event_suffix,
                        &grace_suffix,
                    );
                    for ci in grace_cmd_idx..grace_cmd_end {
                        dl.tag_command(ci, grace_element_id.clone());
                    }
                }
            }
            // Grace note slurs are only rendered when explicitly defined in MNX
            // (via slur elements on the grace group). We do NOT auto-add them.
        }
    }

    // Render mid-measure clef changes
    for mc in &ml.mid_clef_changes {
        render_change_clef(dl, mc.x + MID_CLEF_LEFT_PAD_SP * sp, staff_y, sp, &mc.clef);
    }

    // Render beam groups
    render_beams(
        dl,
        ml,
        staff_y,
        sp,
        config,
        explicit_beamed_ids,
        use_beams,
        staff_y_offsets,
    );

    // Render beam groups for grace notes
    render_grace_beams(dl, ml, staff_y, sp, config, use_beams);

    // Render tuplet brackets and numbers
    let tuplet_artic_boxes = super::render_annotations::collect_articulation_boxes(
        &dl.commands[measure_event_cmd_start..],
    );
    let tuplet_bracket_boxes = render_tuplet_brackets(
        dl,
        ml,
        staff_y,
        sp,
        config,
        &tuplet_artic_boxes,
        staff_y_offsets,
    );

    // Render multi-note tremolo slashes between paired events
    render_multi_note_tremolos(dl, ml, staff_y, sp, config);

    // Render dynamics markings below staff
    let mut artic_boxes = super::render_annotations::collect_articulation_boxes(
        &dl.commands[measure_event_cmd_start..],
    );
    // Tuplet brackets are obstacles too: a below-staff dynamic must clear a
    // below-staff bracket (and vice versa) rather than collide with it.
    artic_boxes.extend(tuplet_bracket_boxes);
    let dynamic_boxes = render_dynamics(dl, ml, staff_y, sp, config, &artic_boxes, staff_y_offsets);

    // Render text expressions below staff (below dynamics)
    let expr_cmd_start = dl.commands.len();
    // Above-staff directions (e.g. "arco") must clear note-substrate ink
    // (accidentals, articulations, tremolos, ornaments, flags, …) that
    // protrudes above the noteheads beneath them.
    let expr_above_glyph_boxes = super::render_annotations::collect_above_glyph_boxes(
        &dl.commands[measure_event_cmd_start..],
        dl.element_ids.get(measure_event_cmd_start..).unwrap_or(&[]),
        staff_y,
    );
    render_text_expressions(
        dl,
        ml,
        staff_y,
        sp,
        config,
        &expr_above_glyph_boxes,
        &dynamic_boxes,
        staff_y_offsets,
    );
    let expr_cmd_end = dl.commands.len();

    // Render tempo markings above staff (system objects)
    if ml.show_system_objects {
        // Tempo text must clear note-substrate ink (accents/marcato, high
        // accidentals, tremolos, ornaments, flags, …) protruding above the
        // noteheads — it participates in the above-staff skyline alongside
        // notes and stems.
        let above_glyph_boxes = super::render_annotations::collect_above_glyph_boxes(
            &dl.commands[measure_event_cmd_start..],
            dl.element_ids.get(measure_event_cmd_start..).unwrap_or(&[]),
            staff_y,
        );
        // Count numbers of neighbouring multimeasure-rest measures protrude
        // above the staff just like articulations; a wide tempo string that
        // reaches into the next bar must hop over them too.
        let mut tempo_above_boxes = above_glyph_boxes;
        tempo_above_boxes.extend_from_slice(mmr_number_extents);
        // NOTE: above-staff performance directions (e.g. "arco") are
        // deliberately NOT folded into the tempo's emission-time skyline here.
        // Tempo-vs-expression vertical stacking is owned entirely by the
        // post-pass `flow_above_staff_dependents` (expressions place first as
        // flat tops, the tempo then clears them outward). Lifting the tempo over
        // the expression at emission too would front-run that pass — committing
        // the tempo high before its decongestion lookahead (which may slide the
        // expression sideways out of the tempo's column) ever runs.
        render_tempo_markings(
            dl,
            ml,
            staff_y,
            sp,
            config,
            &tempo_above_boxes,
            leading_clef_gap,
        );
    }

    // Render jump markers (segno, fine, D.S.) above staff (system objects)
    if ml.show_system_objects {
        let jump_above_boxes = super::render_annotations::collect_above_glyph_boxes(
            &dl.commands[measure_event_cmd_start..],
            dl.element_ids.get(measure_event_cmd_start..).unwrap_or(&[]),
            staff_y,
        );
        render_jump_markers(dl, ml, staff_y, sp, config, &jump_above_boxes);
    }

    // Render rehearsal marks (boxed letters/numbers) above staff (system objects)
    if ml.show_system_objects {
        // The mark must clear articulations (accents/marcato) protruding above
        // the noteheads beneath it AND any performance directions (e.g. "arco")
        // placed at the measure start. Both are supplied as x-localized obstacle
        // bands so the mark can slide LEFT past a direction that sits just right
        // of the barline instead of lifting over it — standard engraving
        // practice gives the mark the topmost slot and prefers the smaller
        // displacement (horizontal vs vertical).
        let mut above_glyph_boxes = super::render_annotations::collect_above_glyph_boxes(
            &dl.commands[measure_event_cmd_start..],
            dl.element_ids.get(measure_event_cmd_start..).unwrap_or(&[]),
            staff_y,
        );
        above_glyph_boxes.extend(super::render_annotations::collect_above_text_boxes(
            &dl.commands[expr_cmd_start..expr_cmd_end],
            staff_y,
        ));
        // The big count number over a neighbouring multimeasure rest protrudes
        // above the staff at the same height as the mark's box; a mark whose box
        // overlaps one horizontally must lift clear of it too.
        above_glyph_boxes.extend_from_slice(mmr_number_extents);
        render_rehearsal_marks(
            dl,
            ml,
            staff_y,
            sp,
            config,
            &above_glyph_boxes,
            leading_clef_gap,
        );
    }

    // Render chord symbols above staff
    render_chord_symbols(dl, ml, staff_y, sp, config);

    // Render measure numbers above staff when explicitly set
    render_measure_numbers(dl, ml, staff_y, sp, config, is_bottom_staff);

    // Render breath marks above staff
    render_breath_marks(dl, ml, staff_y, sp, config);

    // Render caesura marks above staff (at barline position)
    render_caesuras(dl, ml, staff_y, sp, config);

    // Render trill ornaments above notes
    render_trills(dl, measure_event_cmd_start, ml, staff_y, sp, config);

    // Render ornaments (turn, mordent, etc.) above notes
    render_ornaments(dl, measure_event_cmd_start, ml, staff_y, sp, config);

    // Render fermatas above/below notes and rests. Drawn AFTER articulations
    // (events), trills, and ornaments so a fermata can sit outside (above) every
    // other marking already placed on the event — standard engraving practice.
    render_fermatas(dl, measure_event_cmd_start, ml, staff_y, sp, config);

    // Render arpeggio markings (wavy lines left of chords)
    render_arpeggios(dl, ml, staff_y, sp, config);

    // Render fingering annotations near noteheads
    render_fingerings(dl, ml, staff_y, sp, config);

    // Render lyrics below staff (below dynamics)
    render_lyrics(dl, ml, staff_y, sp, config, lyric_line_order);
}

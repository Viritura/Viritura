#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::skyline::{Skyline, SkylineDirection};
use super::super::spacing::*;
use super::super::types::*;
use super::accidental_visibility::is_suppressed_tied_accidental;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Pre-computed logarithmic spacing map for a measure.
#[derive(Clone)]
pub(crate) struct LogSpacing {
    /// Sorted (beat_position, cumulative_x_offset_in_sp) pairs.
    pub mapping: Vec<(f64, f64)>,
    /// Total logical width in spatium.
    pub total_width: f64,
    /// Cumulative *rigid* (incompressible) width in spatium at each onset,
    /// parallel to `mapping`. Rigid width is glyph-clearance padding —
    /// currently accidental columns — that must keep a fixed physical size for
    /// legibility even when the system is compressed to fit the page. Only the
    /// remaining *elastic* width (duration spacing) is scaled by justification.
    pub rigid_widths: Vec<f64>,
    /// Total rigid width in spatium. This may exceed `rigid_widths.last()` when
    /// final-onset ink needs a hard tail before the trailing barline.
    pub rigid_total: f64,
    /// Base spatium (px per sp) used to convert rigid widths to fixed pixels.
    pub base_sp: f64,
}

impl LogSpacing {
    /// Look up x position for a given beat from the spacing map.
    ///
    /// Rigid padding (accidental clearance) keeps a fixed physical size of
    /// `rigid_sp * base_sp` pixels regardless of `content_width`; only the
    /// elastic remainder (duration spacing) is scaled to fit the allotted
    /// width. Under extreme compression the elastic part collapses to zero
    /// before the rigid struts give way, so accidentals never overlap their
    /// noteheads — the measure overflows instead, which is the legible choice.
    pub fn lookup_x(&self, beat: f64, content_width: f64, x_origin: f64) -> f64 {
        if self.mapping.is_empty() || self.total_width <= 0.0 {
            return x_origin;
        }
        let mut x_offset = 0.0;
        let mut rigid_offset = 0.0;
        for (idx, &(b, x)) in self.mapping.iter().enumerate() {
            if b <= beat + 0.001 {
                x_offset = x;
                rigid_offset = self.rigid_widths.get(idx).copied().unwrap_or(0.0);
            } else {
                break;
            }
        }
        let elastic_total = (self.total_width - self.rigid_total).max(1e-9);
        let elastic_offset = (x_offset - rigid_offset).max(0.0);
        let rigid_px = self.rigid_total * self.base_sp;
        let elastic_px = (content_width - rigid_px).max(0.0);
        x_origin + rigid_offset * self.base_sp + (elastic_offset / elastic_total) * elastic_px
    }
}

/// Spring width for a given duration gap (in beats).
///
/// Uses a multiplicative power law `width = quarter_space · (gap/quarter)^E`
/// with `0 < E < 1` (standard engraving practice), anchored at a **fixed
/// quarter-note reference** rather than the score's shortest note. Two
/// properties matter:
///
/// 1. *Density ordering.* For a fixed measure duration split into `N` equal
///    onsets the total width grows as `N^(1−E)`, so a busier measure is never
///    narrower than a sparser one of the same length. An additive
///    `base + k·log₂(ratio)` curve lacks this property — past a point, adding
///    onsets can *shrink* the measure, letting a sparse bar look wider than a
///    dense one.
/// 2. *Scale stability.* Anchoring at a fixed quarter (not the detected
///    shortest duration) keeps spacing constant regardless of whether fast
///    notes appear elsewhere in the piece; otherwise a single passage of 32nds
///    would inflate the spacing of every long note and rest in the score.
///
/// `common_shortest_beats` is retained in the signature for callers but no
/// longer scales the spring; the fixed reference supersedes it.
pub(crate) fn log_duration_width(
    gap_beats: f64,
    _common_shortest_beats: f64,
    _config: &LayoutConfig,
) -> f64 {
    if gap_beats <= 0.0 {
        return 0.0;
    }
    // A quarter note is the reference: it gets QUARTER_SPACE_SP; width then
    // grows as duration^E. Values are tuned to standard engraving spacing.
    const QUARTER_SPACE_SP: f64 = 3.5;
    const REFERENCE_BEATS: f64 = 1.0; // quarter note
    const DURATION_SPACING_EXPONENT: f64 = 0.585; // log2(1.5)
    let ratio = gap_beats / REFERENCE_BEATS;
    QUARTER_SPACE_SP * ratio.powf(DURATION_SPACING_EXPONENT)
}

/// Compute grace note padding (in spatium) for a given count of grace notes.
pub(super) fn grace_padding_sp(count: usize, config: &LayoutConfig) -> f64 {
    let grace_scale = 0.65;
    let grace_nw = config.notehead_rx * 2.0 * grace_scale;
    let grace_gap = 0.3;
    let grace_to_main = 1.2;
    count as f64 * grace_nw + (count as f64 - 1.0).max(0.0) * grace_gap + grace_to_main
}

/// Estimate the leftward horizontal extent (in staff spaces) of an event's
/// stacked accidental column, measured from the column's right edge (the
/// boundary that sits `acc_note_gap` left of the notehead).
///
/// Mirrors the renderer's packing in `render_accidentals_stacked`: accidentals
/// are placed OUTSIDE-IN (top, bottom, next-top, …) and each tucks into the
/// rightmost free column via a vertical skyline, so vertically distant
/// accidentals SHARE a column instead of fanning into a leftward staircase. The
/// per-glyph cut-out interlocking is intentionally omitted here, which keeps the
/// estimate a safe, slight over-reservation (never under) — exactly the right
/// direction for a width budget.
///
/// Using the renderer's outside-in + column-reuse order (rather than a
/// monotonic top-to-bottom staircase) is essential: a dense chromatic cluster
/// has every adjacent accidental vertically overlapping, so the naive staircase
/// reserved ~N columns (≈Nx the real width), ballooning the preceding gap into a
/// large empty space. With column reuse the estimate matches the ~2–3 columns
/// the renderer actually draws.
///
/// `accs` entries are `(staff_position_half_spaces, alter, enclosure_extra_sp)`
/// where higher pitches have smaller (more negative) staff positions, matching
/// the render coordinate convention. Returns 0.0 for empty input.
fn stacked_accidental_extent_sp(accs: &[(f64, i32, f64)]) -> f64 {
    if accs.is_empty() {
        return 0.0;
    }
    let acc_stack_gap = 0.20;

    // Pitch-sorted indices (ascending staff position = highest pitch first),
    // then visited outside-in so an inner accidental can tuck back into the
    // same column as a non-overlapping outer one (mirrors the renderer's
    // `alternating_outside_in_order`).
    let mut idx: Vec<usize> = (0..accs.len()).collect();
    idx.sort_by(|&a, &b| accs[a].0.total_cmp(&accs[b].0));
    let mut order = Vec::with_capacity(idx.len());
    let (mut lo, mut hi) = (0isize, idx.len() as isize - 1);
    let mut pick_top = true;
    while lo <= hi {
        if pick_top {
            order.push(idx[lo as usize]);
            lo += 1;
        } else {
            order.push(idx[hi as usize]);
            hi -= 1;
        }
        pick_top = !pick_top;
    }

    // A Down skyline tracks each column's left edge by vertical range. The seed
    // building puts the whole range at the column origin (0 = notehead-gap
    // boundary); a non-overlapping accidental therefore sees barrier 0 and
    // reuses the rightmost column.
    let mut skyline = Skyline::new(SkylineDirection::Down);
    skyline.add_building(-50.0, 50.0, 0.0);
    let mut min_left = 0.0_f64;
    for &i in &order {
        let (pos, alter, enc_extra) = accs[i];
        let width = smufl::accidental_width(alter) + enc_extra;
        let (above, below) = smufl::accidental_vertical_extent(alter);
        let v_top = pos - above;
        let v_bottom = pos + below;
        // Rightmost (largest x) placement that clears every vertically
        // overlapping placed accidental: the min (leftmost) barrier in range.
        let barrier = skyline.min_height_in_range(v_top, v_bottom).unwrap_or(0.0);
        let left_edge = barrier - width;
        skyline.add_building(v_top, v_bottom, left_edge - acc_stack_gap);
        min_left = min_left.min(left_edge);
    }
    -min_left
}

/// Compute the stacked accidental column extent (in staff spaces) for a single
/// event's notes, honoring key signature and per-note accidental display flags.
/// Returns 0.0 when the event shows no accidentals.
///
/// `measure_acc` carries the running alteration in effect at each (step,
/// octave) within the measure, exactly as the renderer tracks it, so an
/// accidental that cancels an earlier same-measure alteration (e.g. a natural
/// after a flat on the same pitch) is reserved even though it matches the key
/// signature. Callers that want pure key-relative behavior pass a fresh map.
///
/// `clef` is the active clef for this event (or `None` for callers that don't
/// have clef context — they fall back to the pre-ledger behavior). When
/// supplied, notes that sit far enough beyond the staff to carry ledger lines
/// at the accidental's vertical range reserve an extra `ledger_extension` of
/// left extent. This mirrors the renderer's ledger barriers in
/// `render_accidentals_stacked`: a ledgered note pushes its accidental column
/// `ledger_extension` further left (the ledger reaches that far past the
/// notehead), so without the matching reservation the column overflows into the
/// previous event. `ledger_extension` is the engraving leger-line extension in
/// staff spaces (`LayoutConfig::ledger_extension`, Bravura default 0.4sp).
pub(crate) fn event_accidental_extent_sp(
    notes: &[Note],
    active_key: &KeySignature,
    measure_acc: &mut HashMap<(String, i32), i32>,
    clef: Option<&Clef>,
    ledger_extension: f64,
    suppressed_note_ids: Option<&HashSet<String>>,
) -> f64 {
    event_accidental_extent_sp_transposed(
        notes,
        active_key,
        None,
        measure_acc,
        clef,
        ledger_extension,
        suppressed_note_ids,
    )
}

#[allow(clippy::too_many_arguments)] // Mirrors rendered accidental state with optional written-pitch projection.
pub(super) fn event_accidental_extent_sp_transposed(
    notes: &[Note],
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    measure_acc: &mut HashMap<(String, i32), i32>,
    clef: Option<&Clef>,
    ledger_extension: f64,
    suppressed_note_ids: Option<&HashSet<String>>,
) -> f64 {
    let mut accs: Vec<(f64, i32, f64)> = Vec::new();
    // Extra leftward extent demanded by ledger lines on accidental-bearing
    // notes (sp). Sharps/naturals may kern slightly into a ledger in the
    // renderer, but reserving the full extension here is a safe, tight floor.
    let mut ledger_extra = 0.0_f64;
    for note in notes {
        if note.kit_component.is_some() {
            continue;
        }
        // Mirror the renderer: every note's sounding alteration becomes the
        // value in effect for the rest of the measure at its staff position,
        // and an accidental is shown when it differs from the value currently
        // in effect (seeded from the key signature).
        let display_pitch = spacing_display_pitch(note, transposition);
        let display_alter = display_pitch.alter.unwrap_or(0);
        let key_alter = active_key.alteration_for_step(&display_pitch.step);
        let pos_key = (display_pitch.step.clone(), display_pitch.octave);
        let in_effect = measure_acc.get(&pos_key).copied().unwrap_or(key_alter);
        let differs = display_alter != in_effect;

        let ad = note.accidental_display.as_ref();
        let explicitly_shown = ad.is_some_and(|a| a.show);
        let forced = ad.is_some_and(|a| a.force.unwrap_or(false));
        let explicitly_hidden = ad.is_some_and(|a| !a.show);
        let tied_continuation = is_suppressed_tied_accidental(note, suppressed_note_ids);
        if !tied_continuation {
            measure_acc.insert(pos_key, display_alter);
        }
        if !tied_continuation && !explicitly_hidden && (explicitly_shown || forced || differs) {
            let enc_extra = ad.and_then(|a| a.enclosure.as_ref()).map_or(0.0, |enc| {
                let is_parens = matches!(enc.symbol, AccidentalEnclosureSymbol::Parentheses);
                2.0 * smufl::accidental_enclosure_width(is_parens) + 2.0 * 0.06
            });
            // Render places higher pitches at smaller staff positions, so
            // negate the diatonic index to match that orientation.
            let pos = -(display_pitch.diatonic_position() as f64);
            accs.push((pos, display_alter, enc_extra));

            // If we know the clef, reserve ledger room for notes whose staff
            // position lies in a ledger zone (beyond the staff lines). The
            // accidental's own vertical span reaches the ledger, so the column
            // extends `ledger_extension` further left than the bare glyph
            // column. We take the max (not sum) — one ledgered note in the
            // chord is enough to push the whole column out by one extension.
            if let Some(clef) = clef {
                if pitch_has_ledger_at_accidental(&display_pitch, display_alter, clef) {
                    ledger_extra = ledger_extra.max(ledger_extension);
                }
            }
        }
    }
    let mut extent = stacked_accidental_extent_sp(&accs);
    // Chords containing a SECOND displace one notehead by a full notehead width
    // to the side of the stem. When that displacement is leftward (a stem-down
    // cluster), the renderer stacks the accidental column to the left of the
    // displaced notehead, not the onset notehead (see the displaced-notehead
    // barrier seeding in `render_accidentals_stacked`). Reserve a notehead
    // width of extra left extent so the column clears the previous event.
    // Displacement is only ever a single notehead width (offsets are 0 or ±1),
    // and we cannot cheaply know the stem direction here, so we reserve it
    // whenever a second is present and accidentals are shown — a safe, tight
    // over-reservation limited to second-clusters that carry accidentals.
    if extent > 0.0 && notes_contain_second(notes) {
        extent += smufl::glyph_bbox(smufl::NOTEHEAD_BLACK).2;
    }
    if extent > 0.0 {
        extent += ledger_extra;
    }
    extent
}

pub(super) fn spacing_display_pitch(note: &Note, transposition: Option<(i32, i32)>) -> Pitch {
    let Some((staff_distance, half_steps)) = transposition else {
        return note.pitch.clone();
    };
    let delta = note
        .written
        .as_ref()
        .and_then(|written| written.diatonic_delta)
        .unwrap_or(0);
    note.pitch.transpose(staff_distance, half_steps, delta)
}

/// Whether a note sits in a ledger-line zone such that a ledger line crosses
/// its accidental's vertical range. Staff positions follow the renderer's
/// convention (half-spaces from the top staff line, larger = lower); ledger
/// lines occur at even positions beyond the staff: ≤ -2 above, ≥ 10 below.
/// The accidental's vertical extent (from `smufl::accidental_vertical_extent`)
/// is added so an accidental on a note just inside the staff still reserves
/// ledger room when its glyph reaches a ledger above/below.
fn pitch_has_ledger_at_accidental(pitch: &Pitch, alter: i32, clef: &Clef) -> bool {
    // Staff position in half-spaces (matches compute_note_staff_positions).
    let diatonic = pitch.diatonic_position();
    let clef_ref = clef.reference_diatonic();
    let clef_line = clef.line_from_bottom();
    let pos = (4 - clef_line) as f64 * 2.0 - (diatonic - clef_ref) as f64;

    let (above, below) = smufl::accidental_vertical_extent(alter);
    let v_top = pos - above;
    let v_bottom = pos + below;

    // Ledger above the staff: any even position ≤ -2 within the glyph's span.
    if v_top <= -2.0 {
        return true;
    }
    // Ledger below the staff: any even position ≥ 10 within the glyph's span.
    if v_bottom >= 10.0 {
        return true;
    }
    false
}

/// Whether any two non-kit notes sharing an onset form a diatonic second — the
/// condition that triggers a one-notehead-width sideways notehead displacement.
pub(crate) fn notes_contain_second(notes: &[Note]) -> bool {
    let mut positions: Vec<i32> = notes
        .iter()
        .filter(|n| n.kit_component.is_none())
        .map(|n| n.pitch.diatonic_position())
        .collect();
    positions.sort_unstable();
    positions.windows(2).any(|w| w[1] - w[0] == 1)
}

/// Compute accidental padding (in spatium) for a given max accidental width.
pub(crate) fn accidental_padding_sp(max_width_sp: f64) -> f64 {
    // Gap between the accidental column and its own notehead (sp). Must match
    // the hard barrier floor in render_events.rs `render_accidentals_stacked`
    // so the reserved space equals the space the placement actually consumes.
    let acc_note_gap = 0.20;
    // Clearance between the accidental column's left edge and the preceding
    // element (note, barline or another note's stem). Without it the accidental
    // is pushed hard against the previous event and the bar reads as cramped.
    // Standard engraving practice leaves a small breathing gap on the approach
    // side of an accidental.
    let acc_left_gap = 0.50;
    max_width_sp + acc_note_gap + acc_left_gap
}

pub(super) fn rhythmic_position_to_beat(position: &RhythmicPosition) -> Option<f64> {
    if position.fraction.1 == 0 {
        return None;
    }
    Some(position.beats())
}

pub(super) fn build_standard_arpeggio_set(part_measures: &[&PartMeasure]) -> HashSet<BeatKey> {
    let mut set = HashSet::new();
    for pm in part_measures {
        if let Some(arpeggios) = &pm.arpeggios {
            for arpeggio in arpeggios {
                if let Some(beat) = rhythmic_position_to_beat(&arpeggio.position) {
                    set.insert(BeatKey::new(beat));
                }
            }
        }
        if let Some(non_arpeggios) = &pm.non_arpeggios {
            for non_arpeggio in non_arpeggios {
                if let Some(beat) = rhythmic_position_to_beat(&non_arpeggio.position) {
                    set.insert(BeatKey::new(beat));
                }
            }
        }
    }
    set
}

/// Padding (in spatium) reserved to the left of an arpeggio'd chord so the
/// wavy vertical line has room. Matches `LayoutConfig.arpeggio_offset` plus
/// a small clearance for the line thickness.
pub(super) fn arpeggio_padding_sp(config: &LayoutConfig) -> f64 {
    config.arpeggio_offset + 0.4
}

/// Left-overhang of a fermata glyph before the notehead onset (spatium).
///
/// The fermata is centered on the notehead centre (`notehead_rx` from onset).
/// If the glyph half-width exceeds `notehead_rx`, the glyph bleeds left of the onset.
pub(super) fn fermata_left_overhang_sp(glyph_w: f64, config: &LayoutConfig) -> f64 {
    (glyph_w * 0.5 - config.notehead_rx).max(0.0)
}

/// Minimum onset-to-onset gap (spatium) required when the current event has a fermata.
///
/// The fermata's right edge from the onset = `notehead_rx + glyph_w/2`.
/// We add a small clearance before the next notehead.
pub(super) fn fermata_min_gap_sp(glyph_w: f64, config: &LayoutConfig) -> f64 {
    const CLEARANCE: f64 = 0.3;
    config.notehead_rx + glyph_w * 0.5 + CLEARANCE
}

/// Minimum onset-to-onset gap (spatium) required when the current event carries
/// a caesura. The caesura glyph is engraved in the gap before the next event
/// (or the barline), `CAESURA_RIGHT_PAD` to its left; the gap must hold the
/// current notehead, the glyph, and clearance on both sides so the railroad
/// tracks never overlap the noteheads or their accidentals.
///
/// Noteheads are left-anchored at their onset, so the current one protrudes a
/// full notehead width (`2 * notehead_rx`) past the onset.
pub(super) fn caesura_min_gap_sp(glyph_w: f64, config: &LayoutConfig) -> f64 {
    const CAESURA_RIGHT_PAD: f64 = 0.25; // matches render_caesuras right padding
    const LEFT_CLEARANCE: f64 = 0.5; // breathing room past the current notehead
    2.0 * config.notehead_rx + LEFT_CLEARANCE + glyph_w + CAESURA_RIGHT_PAD
}

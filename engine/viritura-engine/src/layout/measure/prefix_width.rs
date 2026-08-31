//! Measurement contract for a measure's prefix furniture.
//!
//! The prefix is everything engraved before the first note: a repeat-start
//! barline, a restated or changed clef, the key signature, the time
//! signature, and the clearance the first event's accidental needs. Two
//! Measurement, alignment, and rendering all consume [`PrefixLayout`], so the
//! glyph sequence and its reserved width cannot drift into separate rules.

#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::measure::helpers::collect_flat_events;
use super::super::render_signatures::{clef_prefix_advance_sp, key_signature_layout};
use super::super::resolve::*;
use super::super::spacing::{
    accidental_padding_sp, event_accidental_extent_sp, notes_contain_second,
};
use crate::model::*;
use crate::render::smufl::smufl;
use std::collections::{HashMap, HashSet};

/// Ink-to-ink clearance between a key signature and a following time signature.
pub(crate) const KEY_TO_TIME_GAP_SP: f64 = 0.3;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct AlignedPrefix {
    pub(crate) width: f64,
    pub(crate) first_onset_padding: f64,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct PrefixLayout {
    pub(crate) width: f64,
    pub(crate) leading_clef_gap: f64,
    pub(crate) first_onset_padding: f64,
    pub(crate) defer_repeat_start: bool,
    pub(crate) time_signature_x_offset: Option<f64>,
}

fn first_onset_ink_padding_sp(
    rm: &ResolvedMeasure,
    config: &LayoutConfig,
    is_system_start: bool,
) -> f64 {
    const APPROACH_CLEARANCE_SP: f64 = 0.5;

    let mut notes = Vec::new();
    let mut max_notehead_left_extent = 0.0_f64;
    let suppressed_note_ids: HashSet<_> = if is_system_start {
        HashSet::new()
    } else {
        rm.tie_continuation_ids.iter().cloned().collect()
    };
    for sequence in &rm.part.sequences {
        for (beat, event) in collect_flat_events(&sequence.content, 0.0, 1.0) {
            if beat > 0.001 {
                break;
            }
            let notehead = smufl::notehead_glyph(&event.duration.base);
            let (head_x, _, head_width, _) = smufl::glyph_bbox(notehead);
            max_notehead_left_extent = max_notehead_left_extent.max((head_width - head_x).max(0.0));
            notes.extend(event.notes().iter().cloned());
        }
    }
    if notes.is_empty() {
        return 0.0;
    }

    // Prefix geometry starts at the barline center, while the clearance rule
    // starts at its rightmost ink edge.
    let has_leading_barline =
        (rm.index != 0 && !is_system_start) || rm.global.repeat_start.is_some();
    let barline_half_width = if has_leading_barline {
        config.barline_width * 0.5
    } else {
        0.0
    };
    let active_clef = if has_leading_barline {
        rm.part.clefs.as_ref().and_then(|clefs| {
            clefs
                .iter()
                .rfind(|positioned| {
                    positioned
                        .position
                        .as_ref()
                        .is_none_or(|position| position.beats() <= 0.001)
                })
                .map(|positioned| &positioned.clef)
        })
    } else {
        None
    };
    let accidental_extent = event_accidental_extent_sp(
        &notes,
        &rm.active_key,
        &mut HashMap::new(),
        active_clef,
        config.ledger_extension,
        Some(&suppressed_note_ids),
    );
    let accidental_padding = if accidental_extent > 0.0 {
        accidental_padding_sp(accidental_extent) + barline_half_width
    } else {
        0.0
    };
    let cluster_padding = if notes_contain_second(&notes) {
        max_notehead_left_extent + APPROACH_CLEARANCE_SP + barline_half_width
    } else {
        0.0
    };
    accidental_padding.max(cluster_padding)
}

#[derive(Clone, Copy)]
pub(crate) enum PrefixContext {
    Alignment,
    MeasureLayout,
}

/// Compute the canonical prefix geometry used by measurement and rendering.
pub(crate) fn prefix_layout(
    rm: &ResolvedMeasure,
    sp: f64,
    is_system_start: bool,
    forced_prefix: Option<AlignedPrefix>,
    forced_leading_clef_gap: Option<f64>,
    context: PrefixContext,
    config: &LayoutConfig,
) -> PrefixLayout {
    let is_first = rm.index == 0;
    let mut prefix_width = 0.0;
    let has_repeat_start = rm.global.repeat_start.is_some();

    if has_repeat_start {
        prefix_width += 1.5 * sp;
    }

    let start_clef = rm.part.clefs.as_ref().and_then(|clefs| {
        clefs.iter().find(|pc| {
            pc.position
                .as_ref()
                .is_none_or(|position| position.fraction.0 == 0)
        })
    });
    let explicit_start_clef = rm
        .part
        .clefs
        .as_ref()
        .and_then(|clefs| clefs.iter().find(|pc| pc.position.is_none()));
    let leading_clef_gap = forced_leading_clef_gap.unwrap_or_else(|| {
        if !is_first
            && explicit_start_clef.is_some()
            && (matches!(context, PrefixContext::MeasureLayout) || !is_system_start)
        {
            crate::layout::render_measure::CLEF_CHANGE_LEADING_GAP_SP * sp
        } else {
            0.0
        }
    });
    match context {
        PrefixContext::Alignment if (is_first || is_system_start) => {
            if let Some(clef) = start_clef {
                let barline_advance = if is_first { 0.0 } else { 0.5 };
                prefix_width += (barline_advance + clef_prefix_advance_sp(&clef.clef)) * sp;
            }
        }
        PrefixContext::MeasureLayout if is_first => {
            if let Some(clef) = explicit_start_clef {
                prefix_width += clef_prefix_advance_sp(&clef.clef) * sp;
            }
        }
        _ => prefix_width += leading_clef_gap,
    }

    let restates_key = match context {
        PrefixContext::Alignment => is_first || is_system_start,
        PrefixContext::MeasureLayout => is_first,
    };
    if rm.global.key.is_some() || (restates_key && rm.active_key.accidental_count() != 0) {
        let cancel_count = if rm.global.key.is_some() {
            rm.prev_key.cancellation_count(&rm.active_key)
        } else {
            0
        };
        let clef_sign = rm
            .part
            .clefs
            .as_ref()
            .and_then(|clefs| clefs.first())
            .map(|pc| &pc.clef.sign)
            .unwrap_or(&ClefSign::G);
        let cancel_prev = (cancel_count > 0).then_some(&rm.prev_key);
        let key_width =
            key_signature_layout(0.0, 0.0, sp, &rm.active_key, clef_sign, cancel_prev).advance;
        if key_width > 0.0 {
            prefix_width += key_width;
            if rm.global.time.is_some() {
                prefix_width += KEY_TO_TIME_GAP_SP * sp;
            }
        }
    }

    if let Some(ref time) = rm.global.time {
        prefix_width += crate::layout::time_signatures::prefix_reserve(
            config.time_signature_settings,
            time,
            sp,
        );
    }

    if prefix_width > 0.0 {
        prefix_width += 1.2 * sp;
    }

    // Reserve all left-extending first-onset ink in the prefix itself. The
    // shared onset map keeps beat columns aligned but must not advance beat
    // zero a second time.
    let first_onset_padding_sp = first_onset_ink_padding_sp(rm, config, is_system_start);
    let first_onset_padding = first_onset_padding_sp * sp;
    if first_onset_padding > 0.0 {
        prefix_width += first_onset_padding;
    }

    let first_onset_padding = forced_prefix.map_or(first_onset_padding, |forced| {
        first_onset_padding.max(forced.first_onset_padding)
    });
    if let Some(forced) = forced_prefix {
        prefix_width = prefix_width.max(forced.width);
    }

    let has_first_onset_ink_padding = first_onset_padding > 0.0;
    let min_clearance = if (!is_first || prefix_width > 0.0) && !has_first_onset_ink_padding {
        1.5 * sp
    } else {
        0.0
    };
    prefix_width = prefix_width.max(min_clearance);
    let defer_repeat_start = (is_first || is_system_start) && has_repeat_start;
    let time_reserve = rm.global.time.as_ref().map(|time| {
        crate::layout::time_signatures::prefix_reserve(config.time_signature_settings, time, sp)
    });
    let repeat_reserve = if defer_repeat_start { 1.5 * sp } else { 0.0 };

    PrefixLayout {
        width: prefix_width,
        leading_clef_gap,
        first_onset_padding,
        defer_repeat_start,
        time_signature_x_offset: time_reserve.map(|reserve| {
            prefix_width - first_onset_padding - repeat_reserve - reserve - 1.2 * sp
        }),
    }
}

/// Compose the system-wide prefix from independently aligned regions.
///
/// A clef change before the barline and first-onset ink after the barline may
/// occur on different staves. Taking one max over their totals would discard
/// one region; take each max separately so every staff retains one onset x.
pub(crate) fn compute_max_prefix_width<'a>(
    measures: impl IntoIterator<Item = &'a ResolvedMeasure>,
    sp: f64,
    is_system_start: bool,
    config: &LayoutConfig,
) -> AlignedPrefix {
    let (leading_gap, furniture_width, first_onset_padding) = measures
        .into_iter()
        .map(|measure| {
            prefix_layout(
                measure,
                sp,
                is_system_start,
                None,
                None,
                PrefixContext::Alignment,
                config,
            )
        })
        .fold(
            (0.0_f64, 0.0_f64, 0.0_f64),
            |(max_leading, max_furniture, max_onset), layout| {
                (
                    max_leading.max(layout.leading_clef_gap),
                    max_furniture.max(
                        (layout.width - layout.leading_clef_gap - layout.first_onset_padding)
                            .max(0.0),
                    ),
                    max_onset.max(layout.first_onset_padding),
                )
            },
        );
    AlignedPrefix {
        width: leading_gap + furniture_width + first_onset_padding,
        first_onset_padding,
    }
}

/// Preserve rhythmic width when independently aligned prefix regions make the
/// shared prefix wider than the largest staff-local prefix already budgeted.
pub(crate) fn natural_width_with_aligned_prefix(
    natural_width: f64,
    included_prefix_width: f64,
    aligned_prefix: AlignedPrefix,
) -> f64 {
    natural_width + (aligned_prefix.width - included_prefix_width).max(0.0)
}

pub(crate) fn compute_prefix_width(
    rm: &ResolvedMeasure,
    sp: f64,
    is_system_start: bool,
    config: &LayoutConfig,
) -> f64 {
    prefix_layout(
        rm,
        sp,
        is_system_start,
        None,
        None,
        PrefixContext::Alignment,
        config,
    )
    .width
}

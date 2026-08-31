use super::super::types::MeasureLayout;
use std::collections::{HashMap, HashSet};

/// Flattened pitch span of a voice used by slur participation and direction
/// decisions. Each entry is `(event id, top_pos, bottom_pos)`.
pub(super) type VoiceSpan = Vec<(Option<String>, f64, f64)>;

/// Build the per-voice flat list of `(id, top, bottom)` plus the id→index
/// lookup table used by the tall-slur detection helpers.
pub(super) fn build_voice_span_index(
    measure_layouts: &[MeasureLayout],
    voice_idx: usize,
) -> (VoiceSpan, HashMap<String, usize>) {
    // Grace notes are part of the traversal only when they are authored slur
    // endpoints. This gives endpoint lookup and contour/nesting the same event
    // universe without letting unrelated ornamental grace clusters distort a
    // main-note phrase's pitch contour.
    let mut slur_endpoint_ids: HashSet<&str> = HashSet::new();
    for ml in measure_layouts {
        let Some(vl) = ml.voice_layouts.get(voice_idx) else {
            continue;
        };
        for i in 0..vl.events.len() {
            if let Some(slurs) = &vl.events.event(i).slurs {
                if let Some(id) = vl.events.id(i) {
                    slur_endpoint_ids.insert(id);
                }
                slur_endpoint_ids.extend(slurs.iter().map(|slur| slur.target.as_str()));
            }
            for grace in vl.events.grace_notes(i) {
                if let Some(slurs) = &grace.event.slurs {
                    if let Some(id) = grace.id.as_deref() {
                        slur_endpoint_ids.insert(id);
                    }
                    slur_endpoint_ids.extend(slurs.iter().map(|slur| slur.target.as_str()));
                }
            }
        }
    }

    let mut voice_flat: VoiceSpan = Vec::new();
    for ml in measure_layouts {
        let Some(vl) = ml.voice_layouts.get(voice_idx) else {
            continue;
        };
        for i in 0..vl.events.len() {
            for grace in vl.events.grace_notes(i) {
                let Some(id) = grace.id.as_deref() else {
                    continue;
                };
                if !slur_endpoint_ids.contains(id) {
                    continue;
                }
                let top = grace
                    .note_positions
                    .iter()
                    .copied()
                    .fold(f64::INFINITY, f64::min);
                let bottom = grace
                    .note_positions
                    .iter()
                    .copied()
                    .fold(f64::NEG_INFINITY, f64::max);
                voice_flat.push((
                    Some(id.to_string()),
                    if top.is_finite() { top } else { 0.0 },
                    if bottom.is_finite() { bottom } else { 0.0 },
                ));
            }

            let positions = vl.events.note_positions(i);
            let top = positions.iter().copied().fold(f64::INFINITY, f64::min);
            let bottom = positions.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            voice_flat.push((
                vl.events.id(i).map(str::to_string),
                if top.is_finite() { top } else { 0.0 },
                if bottom.is_finite() { bottom } else { 0.0 },
            ));
        }
    }
    let id_to_idx = voice_flat
        .iter()
        .enumerate()
        .filter_map(|(i, (id, _, _))| id.as_ref().map(|s| (s.clone(), i)))
        .collect();
    (voice_flat, id_to_idx)
}

/// Total vertical pitch span across endpoints and interior notes.
pub(super) fn voice_span_total_hs(
    voice_flat: &VoiceSpan,
    id_to_idx: &HashMap<String, usize>,
    start_id: &str,
    target_id: &str,
) -> f64 {
    let Some(&i0) = id_to_idx.get(start_id) else {
        return 0.0;
    };
    let Some(&i1) = id_to_idx.get(target_id) else {
        return 0.0;
    };
    let (lo, hi) = if i0 <= i1 { (i0, i1) } else { (i1, i0) };
    let mut top = f64::INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    for (_, event_top, event_bottom) in &voice_flat[lo..=hi] {
        top = top.min(*event_top);
        bottom = bottom.max(*event_bottom);
    }
    if top.is_finite() && bottom.is_finite() {
        bottom - top
    } else {
        0.0
    }
}

/// Whether both endpoints sit below the interior pitch peak by `margin`.
pub(super) fn voice_span_is_mountain_contour(
    voice_flat: &VoiceSpan,
    id_to_idx: &HashMap<String, usize>,
    start_id: &str,
    target_id: &str,
    margin: f64,
) -> bool {
    let Some(&i0) = id_to_idx.get(start_id) else {
        return false;
    };
    let Some(&i1) = id_to_idx.get(target_id) else {
        return false;
    };
    let (lo, hi) = if i0 <= i1 { (i0, i1) } else { (i1, i0) };
    if hi <= lo + 1 {
        return false;
    }
    let inner_top = voice_flat[lo + 1..hi]
        .iter()
        .map(|(_, top, _)| *top)
        .fold(f64::INFINITY, f64::min);
    inner_top.is_finite()
        && voice_flat[i0].1 >= inner_top + margin
        && voice_flat[i1].1 >= inner_top + margin
}

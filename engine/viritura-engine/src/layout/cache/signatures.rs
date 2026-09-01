use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::model::clef::PositionedClef;
use crate::model::event::{Event, SequenceContent};
use crate::model::key::KeySignature;
use crate::model::measure::{PartMeasure, ResolvedMeasure};
use crate::model::time::TimeSignature;

/// Compute a content fingerprint for a ResolvedMeasure.
///
/// Hashes all content-affecting fields (global + part data, active time/key,
/// transposition) via serde JSON serialization. Positional data is excluded.
pub(crate) fn measure_content_hash(rm: &ResolvedMeasure) -> u64 {
    let mut hasher = DefaultHasher::new();

    if let Ok(json) = serde_json::to_string(&rm.global) {
        json.hash(&mut hasher);
    }
    if let Ok(json) = serde_json::to_string(&rm.part) {
        json.hash(&mut hasher);
    }
    rm.measure_repeat_covered.hash(&mut hasher);
    rm.next_has_repeat_start.hash(&mut hasher);
    if let Ok(json) = serde_json::to_string(&rm.active_time) {
        json.hash(&mut hasher);
    }
    if let Ok(json) = serde_json::to_string(&rm.active_key) {
        json.hash(&mut hasher);
    }
    rm.transposition.hash(&mut hasher);
    rm.written_diatonic_adjustment.hash(&mut hasher);
    if let Some(ref kit) = rm.kit {
        if let Ok(json) = serde_json::to_string(kit) {
            json.hash(&mut hasher);
        }
    }

    // Slur shape is skipped by the parent model's serialization, so fold it in
    // explicitly to invalidate retained segments after an engrave-handle drag.
    hash_slur_shapes(&rm.part, &mut hasher);
    hasher.finish()
}

fn hash_slur_shapes(pm: &PartMeasure, hasher: &mut DefaultHasher) {
    for seq in &pm.sequences {
        hash_seq_content_slur_shapes(&seq.content, hasher);
    }
}

fn hash_seq_content_slur_shapes(content: &[SequenceContent], hasher: &mut DefaultHasher) {
    for item in content {
        match item {
            SequenceContent::Event(ev) => hash_event_slur_shapes(ev, hasher),
            SequenceContent::Tuplet(t) => hash_seq_content_slur_shapes(&t.content, hasher),
            SequenceContent::MultiNoteTremolo(t) => {
                for ev in &t.content {
                    hash_event_slur_shapes(ev, hasher);
                }
            }
            SequenceContent::Grace(g) => {
                for ev in &g.content {
                    hash_event_slur_shapes(ev, hasher);
                }
            }
            SequenceContent::Space(_) | SequenceContent::Other(_) => {}
        }
    }
}

fn hash_event_slur_shapes(ev: &Event, hasher: &mut DefaultHasher) {
    let Some(slurs) = &ev.slurs else { return };
    for slur in slurs {
        let Some(shape) = &slur.shape else { continue };
        if let Some(id) = &ev.id {
            id.hash(hasher);
        }
        slur.target.hash(hasher);
        if let Ok(json) = serde_json::to_string(shape) {
            json.hash(hasher);
        }
    }
}

/// Per-staff carried state crossing a measure boundary in the resolve pass.
#[derive(Clone)]
pub(crate) struct BoundaryState {
    pub active_time: TimeSignature,
    pub active_key: KeySignature,
    pub last_clef: Option<PositionedClef>,
    pub prev_display_key: KeySignature,
}

/// Compute a fingerprint over carried resolve state and staff transposition.
pub(crate) fn boundary_state_fingerprint(
    state: &BoundaryState,
    transposition: Option<(i32, i32)>,
    key_fifths_flip_at: Option<i32>,
) -> u64 {
    let mut h = DefaultHasher::new();
    state.active_time.count.hash(&mut h);
    state.active_time.unit.hash(&mut h);
    match &state.active_time.display {
        None => 0u8.hash(&mut h),
        Some(display) => {
            1u8.hash(&mut h);
            if let Ok(serialized) = serde_json::to_string(display) {
                serialized.hash(&mut h);
            }
        }
    }
    hash_key_signature(&state.active_key, &mut h);
    hash_key_signature(&state.prev_display_key, &mut h);
    match &state.last_clef {
        None => 0u8.hash(&mut h),
        Some(clef) => {
            1u8.hash(&mut h);
            if let Ok(serialized) = serde_json::to_string(clef) {
                serialized.hash(&mut h);
            }
        }
    }
    transposition.hash(&mut h);
    key_fifths_flip_at.hash(&mut h);
    h.finish()
}

fn hash_key_signature(key: &KeySignature, hasher: &mut DefaultHasher) {
    key.fifths.hash(hasher);
    key.color.hash(hasher);
    key.atonal.hash(hasher);
}

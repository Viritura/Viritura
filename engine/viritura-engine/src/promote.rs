//! `promote` — convert schema-conformant [`crate::raw`] types into the
//! engine's in-memory [`crate::model`] types.
//!
//! This is the explicit, type-checked bridge between MNX-wire shapes and
//! the engine's runtime shapes. It is the Rust mirror of TypeScript's
//! `promoteUnknown` / `RawScore → Score` walker.
//!
//! See [`docs/spec/data-model-pipeline.md`](../../../docs/spec/data-model-pipeline.md)
//! ("Promote walker — module inventory") for the architectural overview.
//!
//! ## Why this exists
//!
//! `raw::*` is generated from `mnx-schema.json` by typify. It is faithful
//! to the spec but awkward to consume:
//!
//! - Scalars are wrapped in newtypes (`Octave(i64)`, `Bpm(i64)`, …).
//! - Optional unions appear with mechanical names.
//! - Vendor extensions live under `_x` everywhere.
//! - `id`, `_c` comments, etc. are pervasive but unused by the engine.
//!
//! `model::*` is the engine's runtime shape: lean, with engine-only fields
//! and music-theory methods. `promote::*` is where the translation lives
//! — one function per type, each named so that drift surfaces as a
//! localised compile error rather than silent wrong behaviour.
//!
//! ## Pattern
//!
//! For each `raw::Xxx` consumed by the engine:
//!
//! ```ignore
//! pub(crate) fn promote_xxx(raw: raw::Xxx) -> model::Xxx { ... }
//! ```
//!
//! The functions are `pub(crate)` — only [`crate::parse::parse_mnx_strict`]
//! and tests call them. They take ownership of their input so vector
//! contents can be reused without cloning.
//!
//! Promote functions return [`PromoteError`] when raw values exist that the
//! engine doesn't yet model (e.g. note-value bases the engine hasn't taught
//! itself). Pure structural copies are infallible.

pub(crate) mod articulation;
pub(crate) mod barline;
pub(crate) mod beam;
pub(crate) mod clef;
pub(crate) mod direction;
pub(crate) mod duration;
pub(crate) mod event;
pub(crate) mod key;
pub(crate) mod kit;
pub(crate) mod layout;
pub(crate) mod measure;
pub(crate) mod note;
pub(crate) mod part;
pub(crate) mod pitch;
pub(crate) mod repeat;
pub(crate) mod root;
pub(crate) mod score;
pub(crate) mod slur;
pub(crate) mod time;
pub(crate) mod vendor_directions;
pub(crate) mod vendor_ext;

#[cfg(test)]
mod fixture_sweep;

/// Errors surfaced while translating raw MNX into the engine model.
///
/// All variants represent "the input is schema-valid but the engine
/// doesn't currently represent this value". Add new variants as the
/// engine grows coverage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromoteError {
    /// Raw note-value base outside the engine's supported set
    /// (duplexMaxima, 512th, 1024th, 2048th, 4096th).
    UnsupportedNoteValueBase(String),
}

impl std::fmt::Display for PromoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedNoteValueBase(s) => {
                write!(
                    f,
                    "MNX note-value base '{s}' is not supported by the engine"
                )
            }
        }
    }
}

impl std::error::Error for PromoteError {}

/// Promote a single global-measure JSON value into a [`model::GlobalMeasure`].
///
/// Used by external callers (e.g. WASM patch flow) that need to materialise
/// a measure from JSON without going through the full `parse_mnx` pipeline.
pub fn promote_global_measure_json(
    json: &serde_json::Value,
) -> Result<crate::model::GlobalMeasure, PromoteError> {
    let raw_gm: crate::raw::MeasureGlobal = serde_json::from_value(json.clone())
        .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("global measure: {e}")))?;
    measure::promote_global_measure_with_json(raw_gm, Some(json))
}

/// Promote a single part-measure JSON value into a [`model::PartMeasure`].
///
/// Used by external callers (e.g. WASM patch flow) that need to materialise
/// a measure from JSON without going through the full `parse_mnx` pipeline.
pub fn promote_part_measure_json(
    json: &serde_json::Value,
) -> Result<crate::model::PartMeasure, PromoteError> {
    // Stub `sequences[].content` so raw::PartMeasure parses past typify's
    // broken flatten union on SequenceContentItem.
    let mut stubbed = json.clone();
    if let Some(seqs) = stubbed.get_mut("sequences").and_then(|s| s.as_array_mut()) {
        for seq in seqs.iter_mut() {
            if let Some(obj) = seq.as_object_mut() {
                obj.insert("content".into(), serde_json::Value::Array(Vec::new()));
            }
        }
    }
    let raw_pm: crate::raw::PartMeasure = serde_json::from_value(stubbed)
        .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("part measure: {e}")))?;
    measure::promote_part_measure(raw_pm, json)
}

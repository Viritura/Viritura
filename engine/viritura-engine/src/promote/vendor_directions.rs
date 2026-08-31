//! Promote Viritura vendor extensions from `_x.viritura.*` into model types.
//!
//! Pipeline per measure/event:
//!
//! 1. `read_viritura_ext` returns the raw `_x.viritura` JSON object from a
//!    [`crate::raw::VendorExtensions`] field.
//! 2. We deserialize it into the schema-typed [`crate::raw_viritura`]
//!    counterpart (e.g. [`raw_viritura::PartMeasureExtensions`]) via
//!    `serde_json::from_value`. Unknown fields are an error (the schema is
//!    closed via `additionalProperties: false`), which surfaces drift loudly.
//! 3. Per-type `promote_*` functions translate the schema-typed shape into
//!    the engine [`crate::model`] shape.
//!
//! Extended jump types `DsAlCoda` / `DcAlCoda` only appear here — MNX-core
//! `raw::JumpType` doesn't carry them.

use crate::model::chord_symbol::{ChordRoot as ModelChordRoot, ChordSymbol as ModelChordSymbol};
use crate::model::direction::{
    Coda as ModelCoda, Jump as ModelJump, JumpType as ModelJumpType, Pedal as ModelPedal,
    RehearsalMark as ModelRehearsalMark, TextExpression as ModelTextExpression,
};
use crate::model::event::{Glissando as ModelGlissando, GlissandoStyle as ModelGlissandoStyle};
use crate::promote::vendor_ext::read_viritura_ext;
use crate::{raw, raw_viritura};

// ─── Public entry points ──────────────────────────────────────────────

/// Vendor extensions hoisted off a raw `PartMeasure._x.viritura`.
#[derive(Default)]
pub(crate) struct PartMeasureVendor {
    pub pedals: Option<Vec<ModelPedal>>,
    pub chord_symbols: Option<Vec<ModelChordSymbol>>,
    pub expressions: Option<Vec<ModelTextExpression>>,
    pub condensing_override: Option<String>,
}

#[cfg(test)]
pub(crate) fn extract_part_measure_vendor(x: Option<&raw::VendorExtensions>) -> PartMeasureVendor {
    extract_part_measure_vendor_with_fallback(x, None)
}

/// Like `extract_part_measure_vendor` but accepts the original JSON for
/// unrelated legacy vendor fields that have not yet been migrated.
pub(crate) fn extract_part_measure_vendor_with_fallback(
    x: Option<&raw::VendorExtensions>,
    top_level_json: Option<&serde_json::Value>,
) -> PartMeasureVendor {
    let raw_ext: raw_viritura::PartMeasureExtensions = if let Some(json) = read_viritura_ext(x) {
        serde_json::from_value(serde_json::Value::Object(json.clone())).unwrap_or_default()
    } else if let Some(serde_json::Value::Object(top)) = top_level_json {
        // Synthesize the still-supported unrelated extension fields.
        let synthetic = serde_json::json!({
            "pedals": top.get("pedals").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
            "chordSymbols": top.get("chordSymbols").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
            "expressions": top.get("expressions").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
        });
        serde_json::from_value(synthetic).unwrap_or_default()
    } else {
        raw_viritura::PartMeasureExtensions::default()
    };
    PartMeasureVendor {
        pedals: vec_or_none(raw_ext.pedals.into_iter().map(promote_pedal).collect()),
        chord_symbols: vec_or_none(
            raw_ext
                .chord_symbols
                .into_iter()
                .map(promote_chord_symbol)
                .collect(),
        ),
        expressions: vec_or_none(
            raw_ext
                .expressions
                .into_iter()
                .map(promote_text_expression)
                .collect(),
        ),
        condensing_override: raw_ext.condensing_override.map(|o| o.to_string()),
    }
}

/// Vendor extensions hoisted off a raw `MeasureGlobal._x.viritura`.
///
/// `_x.viritura.jump` takes priority over the top-level MNX-core `jump`
/// when both are present.
#[derive(Default)]
pub(crate) struct GlobalMeasureVendor {
    pub rehearsal_mark: Option<ModelRehearsalMark>,
    pub coda: Option<ModelCoda>,
    pub jump: Option<ModelJump>,
    pub senza_misura: Option<bool>,
}

pub(crate) fn extract_global_measure_vendor(
    x: Option<&raw::VendorExtensions>,
) -> GlobalMeasureVendor {
    let Some(json) = read_viritura_ext(x) else {
        return GlobalMeasureVendor::default();
    };
    let raw_ext: raw_viritura::MeasureGlobalExtensions =
        match serde_json::from_value(serde_json::Value::Object(json.clone())) {
            Ok(v) => v,
            Err(_) => return GlobalMeasureVendor::default(),
        };
    GlobalMeasureVendor {
        rehearsal_mark: raw_ext.rehearsal_mark.map(promote_rehearsal_mark),
        coda: raw_ext.coda.map(promote_coda),
        jump: raw_ext.jump.map(promote_extended_jump),
        senza_misura: raw_ext.senza_misura,
    }
}

/// Extract event-level `_x.viritura.glissandos` as model glissandos.
pub(crate) fn extract_event_glissandos(
    x: Option<&raw::VendorExtensions>,
) -> Option<Vec<ModelGlissando>> {
    let json = read_viritura_ext(x)?;
    let raw_ext: raw_viritura::EventExtensions =
        serde_json::from_value(serde_json::Value::Object(json.clone())).ok()?;
    vec_or_none(
        raw_ext
            .glissandos
            .into_iter()
            .map(promote_glissando)
            .collect(),
    )
}

// ─── Type-by-type promote functions ────────────────────────────────────

fn promote_pedal(r: raw_viritura::Pedal) -> ModelPedal {
    ModelPedal {
        pedal_type: r.type_,
        position: promote_rhythmic_position_local(r.position),
        end: promote_measure_rhythmic_position_local(r.end),
        style: r.style,
        staff: r.staff.map(|staff| u32::try_from(staff).unwrap_or(1)),
        voice: r.voice,
    }
}

fn promote_text_expression(r: raw_viritura::TextExpression) -> ModelTextExpression {
    ModelTextExpression {
        text: r.text,
        position: promote_rhythmic_position_local(r.position),
        placement: r.placement,
        staff: r.staff.map(|staff| u32::try_from(staff).unwrap_or(1)),
        voice: r.voice,
        source_part_index: None,
        source_expression_index: None,
        manual_offset: r.manual_offset.map(|d| d.0),
        avoid_collisions: r.avoid_collisions,
    }
}

fn promote_chord_symbol(r: raw_viritura::ChordSymbol) -> ModelChordSymbol {
    ModelChordSymbol {
        position: promote_rhythmic_position_local(r.position),
        root: promote_chord_root(r.root),
        quality: r.quality,
        bass: r.bass.map(promote_chord_root),
        extension: r.extension.and_then(|e| u32::try_from(*e).ok()),
        text_override: r.text_override,
    }
}

fn promote_chord_root(r: raw_viritura::ChordRoot) -> ModelChordRoot {
    ModelChordRoot {
        step: match r.step {
            raw_viritura::ChordRootStep::A => "A".to_string(),
            raw_viritura::ChordRootStep::B => "B".to_string(),
            raw_viritura::ChordRootStep::C => "C".to_string(),
            raw_viritura::ChordRootStep::D => "D".to_string(),
            raw_viritura::ChordRootStep::E => "E".to_string(),
            raw_viritura::ChordRootStep::F => "F".to_string(),
            raw_viritura::ChordRootStep::G => "G".to_string(),
        },
        alter: r.alter.map(|a| a as i32),
    }
}

fn promote_rehearsal_mark(r: raw_viritura::RehearsalMark) -> ModelRehearsalMark {
    ModelRehearsalMark {
        text: r.text,
        style: r.style,
        manual_offset: r.manual_offset.map(|d| d.0),
        avoid_collisions: r.avoid_collisions,
    }
}

fn promote_coda(r: raw_viritura::Coda) -> ModelCoda {
    ModelCoda {
        location: promote_rhythmic_position_local(r.location),
        glyph: r.glyph,
        color: r.color,
    }
}

/// Promote a `raw_viritura::Jump` (extended types only — `dsalcoda`,
/// `dcalcoda`). MNX-core jumps come through `direction::promote_jump`.
fn promote_extended_jump(r: raw_viritura::Jump) -> ModelJump {
    ModelJump {
        jump_type: match r.type_ {
            raw_viritura::JumpType::Dsalcoda => ModelJumpType::DsAlCoda,
            raw_viritura::JumpType::Dcalcoda => ModelJumpType::DcAlCoda,
        },
        location: promote_rhythmic_position_local(r.location),
    }
}

fn promote_glissando(r: raw_viritura::Glissando) -> ModelGlissando {
    ModelGlissando {
        target: r.target,
        style: match r.style {
            Some(raw_viritura::GlissandoStyle::Straight) | None => ModelGlissandoStyle::Straight,
            Some(raw_viritura::GlissandoStyle::Wavy) => ModelGlissandoStyle::Wavy,
        },
        text: r.text,
    }
}

// ─── Local helpers ────────────────────────────────────────────────────
// raw_viritura's RhythmicPosition / MeasureRhythmicPosition are distinct
// types from MNX-core's (they're generated from a different schema), so we
// can't share the existing `promote_rhythmic_position`. Shapes are
// identical though, so the mapping is mechanical.

fn promote_rhythmic_position_local(
    r: raw_viritura::RhythmicPosition,
) -> crate::model::clef::RhythmicPosition {
    let frac = r.fraction;
    let num = frac.first().copied().unwrap_or(0).max(0) as u32;
    let den = frac.get(1).copied().unwrap_or(4).max(1) as u32;
    crate::model::clef::RhythmicPosition {
        fraction: (num, den),
    }
}

fn promote_measure_rhythmic_position_local(
    r: raw_viritura::MeasureRhythmicPosition,
) -> crate::model::direction::MeasureRhythmicPosition {
    crate::model::direction::MeasureRhythmicPosition {
        measure: r.measure,
        position: promote_rhythmic_position_local(r.position),
    }
}

fn vec_or_none<T>(v: Vec<T>) -> Option<Vec<T>> {
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vendor_ext_from_json(s: &str) -> raw::VendorExtensions {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn extracts_rehearsal_mark_and_coda_from_global_measure() {
        let x = vendor_ext_from_json(
            r#"{"viritura":{
                "rehearsalMark":{"text":"A"},
                "coda":{"location":{"fraction":[0,4]}}
            }}"#,
        );
        let v = extract_global_measure_vendor(Some(&x));
        assert_eq!(v.rehearsal_mark.as_ref().unwrap().text, "A");
        assert!(v.coda.is_some());
    }

    #[test]
    fn extracts_extended_jump_dsalcoda() {
        let x = vendor_ext_from_json(
            r#"{"viritura":{"jump":{
                "type":"dsalcoda",
                "location":{"fraction":[3,4]}
            }}}"#,
        );
        let v = extract_global_measure_vendor(Some(&x));
        let jump = v.jump.expect("jump decoded");
        assert!(matches!(jump.jump_type, ModelJumpType::DsAlCoda));
    }

    #[test]
    fn extracts_condensing_override_string() {
        let x = vendor_ext_from_json(r#"{"viritura":{"condensingOverride":"divisi"}}"#);
        let v = extract_part_measure_vendor(Some(&x));
        assert_eq!(v.condensing_override.as_deref(), Some("divisi"));
    }

    #[test]
    fn extracts_event_glissandos() {
        let x = vendor_ext_from_json(
            r#"{"viritura":{"glissandos":[
                {"target":"e2","style":"wavy"}
            ]}}"#,
        );
        let glissandos = extract_event_glissandos(Some(&x)).expect("glissandos");
        assert_eq!(glissandos.len(), 1);
        assert_eq!(glissandos[0].target, "e2");
        assert!(matches!(glissandos[0].style, ModelGlissandoStyle::Wavy));
    }

    #[test]
    fn returns_empty_when_viritura_absent() {
        let x = vendor_ext_from_json(r#"{"other":{}}"#);
        let v = extract_part_measure_vendor(Some(&x));
        assert!(v.pedals.is_none());
        assert!(v.condensing_override.is_none());
    }
}

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
use crate::model::chord_symbol::{ChordRoot as ModelChordRoot, ChordSymbol as ModelChordSymbol};
use crate::model::direction::{
    MarkerText as ModelMarkerText, MarkerTextPlacement as ModelMarkerTextPlacement,
    MarkerTexts as ModelMarkerTexts, Pedal as ModelPedal,
    PositionedTextType as ModelPositionedTextType, RehearsalMark as ModelRehearsalMark,
    TextExpression as ModelTextExpression,
};
use crate::model::event::{Glissando as ModelGlissando, GlissandoStyle as ModelGlissandoStyle};
use crate::model::measure::StaffGroupingDisplayOverride as ModelStaffGroupingDisplayOverride;
use crate::model::staff_meter::{
    StaffMeter as ModelStaffMeter, StaffMeterChange as ModelStaffMeterChange,
    StaffMeterSynchronization as ModelStaffMeterSynchronization,
};
use crate::model::text::{
    GlyphRun as ModelGlyphRun, TextContent as ModelTextContent,
    TextContentChunk as ModelTextContentChunk, TextRun as ModelTextRun,
};
use crate::promote::vendor_ext::read_viritura_ext;
use crate::promote::PromoteError;
use crate::{raw, raw_viritura};

// ─── Public entry points ──────────────────────────────────────────────

/// Vendor extensions hoisted off a raw `PartMeasure._x.viritura`.
#[derive(Default)]
pub(crate) struct PartMeasureVendor {
    pub pedals: Option<Vec<ModelPedal>>,
    pub condensing_override: Option<String>,
    pub grouping_display_overrides: Option<Vec<ModelStaffGroupingDisplayOverride>>,
    pub staff_meters: Option<Vec<ModelStaffMeterChange>>,
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
        });
        serde_json::from_value(synthetic).unwrap_or_default()
    } else {
        raw_viritura::PartMeasureExtensions::default()
    };
    PartMeasureVendor {
        pedals: vec_or_none(raw_ext.pedals.into_iter().map(promote_pedal).collect()),
        grouping_display_overrides: vec_or_none(
            raw_ext
                .grouping_display_overrides
                .into_iter()
                .map(promote_grouping_display_override)
                .collect(),
        ),
        condensing_override: raw_ext.condensing_override.map(|o| o.to_string()),
        staff_meters: vec_or_none(
            raw_ext
                .staff_meters
                .into_iter()
                .map(promote_staff_meter_change)
                .collect(),
        ),
    }
}

/// Vendor extensions hoisted off a raw `MeasureGlobal._x.viritura`.
///
#[derive(Default)]
pub(crate) struct GlobalMeasureVendor {
    pub rehearsal_mark: Option<ModelRehearsalMark>,
    pub marker_text: Option<ModelMarkerTexts>,
    pub senza_misura: Option<bool>,
    pub chord_symbols: Option<Vec<ModelChordSymbol>>,
}

pub(crate) fn extract_global_measure_vendor(
    x: Option<&raw::VendorExtensions>,
) -> Result<GlobalMeasureVendor, PromoteError> {
    let Some(json) = read_viritura_ext(x) else {
        return Ok(GlobalMeasureVendor::default());
    };
    // Other extensions have their own decoders; typify cannot represent every
    // schema-valid system tempo union in the generated global extension type.
    let mut owned = json
        .iter()
        .filter(|(name, _)| {
            matches!(
                name.as_str(),
                "rehearsalMark" | "markerText" | "senzaMisura" | "chordSymbols"
            )
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect::<serde_json::Map<_, _>>();
    if let Some(rehearsal_mark) = owned
        .get_mut("rehearsalMark")
        .and_then(serde_json::Value::as_object_mut)
    {
        if let Some(text) = rehearsal_mark
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
        {
            rehearsal_mark.insert("text".into(), serde_json::json!([{"text": text}]));
        }
    }
    let raw_ext: raw_viritura::MeasureGlobalExtensions =
        serde_json::from_value(serde_json::Value::Object(owned))
            .map_err(|error| PromoteError::InvalidGlobalMeasureExtensions(error.to_string()))?;
    Ok(GlobalMeasureVendor {
        rehearsal_mark: raw_ext.rehearsal_mark.map(promote_rehearsal_mark),
        marker_text: raw_ext.marker_text.map(promote_marker_texts),
        senza_misura: raw_ext.senza_misura,
        chord_symbols: vec_or_none(
            raw_ext
                .chord_symbols
                .into_iter()
                .map(promote_chord_symbol)
                .collect::<Result<Vec<_>, _>>()?,
        ),
    })
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

fn promote_staff_meter(r: raw_viritura::StaffMeter) -> ModelStaffMeter {
    ModelStaffMeter {
        count: u32::try_from(r.count).unwrap_or(4),
        unit: u32::try_from(*r.unit).unwrap_or(4),
        beat_structure: (!r.beat_structure.is_empty()).then(|| {
            r.beat_structure
                .into_iter()
                .filter_map(|group| u32::try_from(group).ok())
                .collect()
        }),
    }
}

fn promote_staff_meter_synchronization(
    r: raw_viritura::StaffMeterSynchronization,
) -> ModelStaffMeterSynchronization {
    match r {
        raw_viritura::StaffMeterSynchronization::SharedDuration => {
            ModelStaffMeterSynchronization::SharedDuration
        }
        raw_viritura::StaffMeterSynchronization::FitMeasure => {
            ModelStaffMeterSynchronization::FitMeasure
        }
    }
}

fn promote_staff_meter_change(r: raw_viritura::StaffMeterChange) -> ModelStaffMeterChange {
    match r {
        raw_viritura::StaffMeterChange::Set(set) => ModelStaffMeterChange::Set {
            staff: u32::try_from(set.staff).unwrap_or(1),
            meter: promote_staff_meter(set.meter),
            synchronization: promote_staff_meter_synchronization(set.synchronization),
        },
        raw_viritura::StaffMeterChange::Reset(reset) => ModelStaffMeterChange::Reset {
            staff: u32::try_from(reset.staff).unwrap_or(1),
        },
    }
}

fn promote_grouping_display_override(
    r: raw_viritura::StaffGroupingDisplayOverride,
) -> ModelStaffGroupingDisplayOverride {
    ModelStaffGroupingDisplayOverride {
        staff: u32::try_from(r.staff).unwrap_or(1),
        grouping_display: crate::promote::time::promote_grouping_display(r.grouping_display),
    }
}

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

pub(crate) fn promote_positioned_text(
    r: raw::PositionedText,
) -> Result<ModelTextExpression, PromoteError> {
    let text = r
        .text
        .0
        .into_iter()
        .map(|item| {
            if let Some(run) = item.subtype_0 {
                let style = positioned_text_style(run.x.as_ref(), "style")?;
                return Ok(ModelTextContentChunk::Text(ModelTextRun {
                    text: run.text.to_string(),
                    style,
                }));
            }
            if let Some(run) = item.subtype_1 {
                let style = positioned_text_style(run.x.as_ref(), "style")?;
                let smufl_style = positioned_text_style(run.x.as_ref(), "smuflStyle")?;
                return Ok(ModelTextContentChunk::Glyph(ModelGlyphRun {
                    glyphs: run
                        .glyphs
                        .into_iter()
                        .map(|glyph| glyph.to_string())
                        .collect(),
                    style,
                    smufl_style,
                }));
            }
            Err(PromoteError::UnsupportedTextContent(
                "formatted text chunk has no text or SMuFL variant".into(),
            ))
        })
        .collect::<Result<Vec<_>, PromoteError>>()?;
    let extensions = positioned_text_extensions(r.x.as_ref());
    let frame = extensions
        .and_then(|x| x.get("frame"))
        .map(|value| {
            serde_json::from_value::<raw_viritura::StaffTextFramePresentation>(value.clone())
                .map(super::staff_text_frame::promote_presentation)
                .map_err(|error| PromoteError::UnsupportedTextContent(error.to_string()))
        })
        .transpose()?;
    let manual_offset = extensions
        .and_then(|x| x.get("manualOffset"))
        .map(|value| {
            serde_json::from_value::<raw_viritura::SpDelta>(value.clone())
                .map(|delta| delta.0)
                .map_err(|error| PromoteError::UnsupportedTextContent(error.to_string()))
        })
        .transpose()?;
    let avoid_collisions = extensions
        .and_then(|x| x.get("avoidCollisions"))
        .and_then(serde_json::Value::as_bool);
    Ok(ModelTextExpression {
        text: ModelTextContent(text),
        id: r.id.map(String::from),
        text_type: match r.type_.unwrap_or(raw::TextType::General) {
            raw::TextType::Expression => ModelPositionedTextType::Expression,
            raw::TextType::General => ModelPositionedTextType::General,
        },
        frame,
        position: r
            .position
            .map(super::clef::promote_rhythmic_position)
            .unwrap_or(crate::model::clef::RhythmicPosition { fraction: (0, 1) }),
        placement: match r.placement {
            Some(raw::Placement::Above) => Some(raw_viritura::ExpressionPlacement::Above),
            Some(raw::Placement::Below) => Some(raw_viritura::ExpressionPlacement::Below),
            Some(raw::Placement::Auto) | None => None,
        },
        staff: r.staff.map(|staff| u32::try_from(staff.0).unwrap_or(1)),
        voice: r.voice.map(String::from),
        source_part_index: None,
        source_expression_index: None,
        instrument_reminder: false,
        manual_offset,
        avoid_collisions,
    })
}

fn positioned_text_style(
    x: Option<&raw::VendorExtensions>,
    field: &str,
) -> Result<Option<crate::model::text::TextRunStyle>, PromoteError> {
    let Some(value) = positioned_text_extensions(x).and_then(|extensions| extensions.get(field))
    else {
        return Ok(None);
    };
    serde_json::from_value::<raw_viritura::TextRunStyle>(value.clone())
        .map(Into::into)
        .map(Some)
        .map_err(|error| PromoteError::UnsupportedTextContent(error.to_string()))
}

fn positioned_text_extensions(
    x: Option<&raw::VendorExtensions>,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    let key = raw::VendorExtensionsKey::try_from("viritura")
        .expect("the Viritura extension key is valid");
    x.and_then(|extensions| extensions.0.get(&key))
        .map(|extensions| &extensions.0)
}

fn promote_chord_symbol(r: raw_viritura::ChordSymbol) -> Result<ModelChordSymbol, PromoteError> {
    let fretboards: Vec<crate::model::chord_symbol::Fretboard> =
        r.fretboards.into_iter().map(Into::into).collect();
    let mut parts = std::collections::HashSet::new();
    for frame in &fretboards {
        frame
            .validate()
            .map_err(|message| PromoteError::InvalidGlobalMeasureExtensions(message.into()))?;
        if !parts.insert(&frame.part_id) {
            return Err(PromoteError::InvalidGlobalMeasureExtensions(
                "Duplicate fretboard instrument".into(),
            ));
        }
    }
    Ok(ModelChordSymbol {
        position: promote_rhythmic_position_local(r.position),
        source_index: None,
        source_part_index: None,
        root: r.root.map(promote_chord_root),
        quality: r.quality,
        raw_text: r.raw_text,
        kind_text: r.kind_text,
        bass: r.bass.map(promote_chord_root),
        extension: r.extension.and_then(|e| u32::try_from(*e).ok()),
        text_override: r.text_override,
        fretboards,
    })
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
        text: ModelTextContent::from_raw(r.text),
        style: r.style,
        manual_offset: r.manual_offset.map(|d| d.0),
        avoid_collisions: r.avoid_collisions,
    }
}

fn promote_marker_texts(r: raw_viritura::MarkerTexts) -> ModelMarkerTexts {
    ModelMarkerTexts {
        segno: r.segno.map(promote_marker_text),
        coda: r.coda.map(promote_marker_text),
        fine: r.fine.map(promote_marker_text),
        jump: r.jump.map(promote_marker_text),
    }
}

fn promote_marker_text(r: raw_viritura::MarkerText) -> ModelMarkerText {
    ModelMarkerText {
        content: ModelTextContent::from_raw(r.content),
        placement: match r.placement {
            raw_viritura::MarkerTextPlacement::Before => ModelMarkerTextPlacement::Before,
            raw_viritura::MarkerTextPlacement::After => ModelMarkerTextPlacement::After,
            raw_viritura::MarkerTextPlacement::Replace => ModelMarkerTextPlacement::Replace,
        },
    }
}

fn promote_glissando(r: raw_viritura::Glissando) -> ModelGlissando {
    ModelGlissando {
        target: r.target,
        style: match r.style {
            Some(raw_viritura::GlissandoStyle::Straight) | None => ModelGlissandoStyle::Straight,
            Some(raw_viritura::GlissandoStyle::Wavy) => ModelGlissandoStyle::Wavy,
        },
        text: if r.show_text == Some(false) {
            None
        } else {
            r.text
        },
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
    fn extracts_condensing_override_string() {
        let x = vendor_ext_from_json(r#"{"viritura":{"condensingOverride":"divisi"}}"#);
        let v = extract_part_measure_vendor(Some(&x));
        assert_eq!(v.condensing_override.as_deref(), Some("divisi"));
    }

    #[test]
    fn extracts_global_harmony_without_guessing_missing_fields() {
        let x = vendor_ext_from_json(
            r#"{"viritura":{"chordSymbols":[
                {"position":{"fraction":[0,1]},"rawText":"N.C."},
                {"position":{"fraction":[1,4]},"rawText":"  H#?!  "},
                {"position":{"fraction":[1,2]},"root":{"step":"D"}},
                {"position":{"fraction":[3,4]},"root":{"step":"B","alter":-1},
                 "quality":"minor","rawText":"B♭m7/F","kindText":"min",
                 "extension":7,"bass":{"step":"F"},"textOverride":"Bbmin7/F"}
            ]}} "#,
        );
        let vendor = extract_global_measure_vendor(Some(&x)).unwrap();
        let chords = vendor.chord_symbols.expect("global harmony");
        assert_eq!(chords.len(), 4);
        for (index, text) in ["N.C.", "  H#?!  "].iter().enumerate() {
            assert!(chords[index].root.is_none());
            assert!(chords[index].quality.is_none());
            assert_eq!(chords[index].raw_text.as_deref(), Some(*text));
            assert_eq!(chords[index].display_text(), *text);
        }
        assert_eq!(chords[1].position.fraction, (1, 4));
        assert_eq!(chords[2].root.as_ref().unwrap().step, "D");
        assert!(chords[2].quality.is_none());
        assert!(chords[2].raw_text.is_none());
        assert_eq!(chords[3].root.as_ref().unwrap().alter, Some(-1));
        assert_eq!(chords[3].quality, Some(raw_viritura::ChordQuality::Minor));
        assert_eq!(chords[3].raw_text.as_deref(), Some("B♭m7/F"));
        assert_eq!(chords[3].kind_text.as_deref(), Some("min"));
        assert_eq!(chords[3].extension, Some(7));
        assert_eq!(chords[3].bass.as_ref().unwrap().step, "F");
        assert_eq!(chords[3].text_override.as_deref(), Some("Bbmin7/F"));
    }

    #[test]
    fn reports_invalid_owned_global_extensions() {
        let measure = serde_json::json!({
            "_x": {"viritura": {"rehearsalMark": {"text": 42}}}
        });
        assert!(matches!(
            crate::promote::promote_global_measure_json(&measure),
            Err(PromoteError::InvalidGlobalMeasureExtensions(_))
        ));
    }

    #[test]
    fn widens_legacy_rehearsal_mark_text() {
        let measure = serde_json::json!({
            "_x": {"viritura": {"rehearsalMark": {"text": "E"}}}
        });
        let promoted = crate::promote::promote_global_measure_json(&measure).unwrap();
        assert_eq!(promoted.rehearsal_mark().unwrap().text.plain_text(), "E");
    }

    #[test]
    fn extracts_staff_meter_set_and_reset() {
        let x = vendor_ext_from_json(
            r#"{"viritura":{"staffMeters":[
                {"staff":2,"meter":{"count":6,"unit":8},"synchronization":"fitMeasure"},
                {"staff":3,"useGlobal":true}
            ]}}"#,
        );
        let v = extract_part_measure_vendor(Some(&x));
        let changes = v.staff_meters.expect("staff meters decoded");
        assert_eq!(changes.len(), 2);
        match &changes[0] {
            ModelStaffMeterChange::Set {
                staff,
                meter,
                synchronization,
            } => {
                assert_eq!(*staff, 2);
                assert_eq!(meter.count, 6);
                assert_eq!(meter.unit, 8);
                assert_eq!(*synchronization, ModelStaffMeterSynchronization::FitMeasure);
            }
            ModelStaffMeterChange::Reset { .. } => panic!("expected a Set change"),
        }
        match &changes[1] {
            ModelStaffMeterChange::Reset { staff } => assert_eq!(*staff, 3),
            ModelStaffMeterChange::Set { .. } => panic!("expected a Reset change"),
        }
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

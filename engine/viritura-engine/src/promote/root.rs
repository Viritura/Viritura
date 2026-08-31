//! Top-level promote entry: `promote_root(raw_json) -> ModelScore`.
//!
//! Takes raw JSON because subordinate types (sequences, layouts) need
//! to peek past typify's broken flatten-union dispatch.

use crate::model::part::Part as ModelPart;
use crate::model::score::{
    Global as ModelGlobal, GlobalLyrics as ModelGlobalLyrics,
    LyricLineMetadataEntry as ModelLyricLineMetadataEntry, MnxMeta as ModelMnxMeta,
    RootVendorExtension as ModelRootVendorExtension,
    RootVirituraExtension as ModelRootVirituraExtension, Score as ModelScore,
    ScoreMetadata as ModelScoreMetadata, Support as ModelSupport,
};
use crate::model::time::TimeSignatureStyles as ModelTimeSignatureStyles;
use crate::promote::kit::promote_sound;
use crate::promote::layout::promote_system_layout;
use crate::promote::measure::promote_global_measure_with_json;
use crate::promote::part::promote_part;
use crate::promote::score::promote_score_definition;
use crate::promote::vendor_ext::read_viritura_ext;
use crate::promote::PromoteError;
use crate::raw;
use std::collections::HashMap;

fn promote_support(r: raw::Support) -> ModelSupport {
    ModelSupport {
        use_accidental_display: r.use_accidental_display,
        use_beams: r.use_beams,
    }
}

fn promote_mnx_meta(r: raw::Mnx) -> ModelMnxMeta {
    ModelMnxMeta {
        version: u32::try_from(r.version.0).unwrap_or(0),
        support: r.support.map(promote_support),
    }
}

fn promote_global_lyrics(r: raw::LyricsGlobal) -> ModelGlobalLyrics {
    let line_metadata = r.line_metadata.map(|lm| {
        lm.0.into_iter()
            .map(|(k, v)| {
                (
                    String::from(k),
                    ModelLyricLineMetadataEntry {
                        label: v.label.map(|l| l.0),
                        lang: v.lang.map(|l| l.0),
                    },
                )
            })
            .collect::<HashMap<_, _>>()
    });
    let line_order = r
        .line_order
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
    ModelGlobalLyrics {
        line_metadata,
        line_order: (!line_order.is_empty()).then_some(line_order),
    }
}

fn promote_global(
    r: raw::Global,
    original_json: Option<&serde_json::Value>,
) -> Result<ModelGlobal, PromoteError> {
    let measures_json = original_json
        .and_then(|g| g.get("measures").and_then(|m| m.as_array()))
        .cloned()
        .unwrap_or_default();
    let measures = r
        .measures
        .into_iter()
        .enumerate()
        .map(|(idx, m)| promote_global_measure_with_json(m, measures_json.get(idx)))
        .collect::<Result<Vec<_>, _>>()?;
    let sounds = r.sounds.map(|s| {
        s.0.into_iter()
            .map(|(k, v)| (String::from(k), promote_sound(v)))
            .collect::<HashMap<_, _>>()
    });
    Ok(ModelGlobal {
        measures,
        lyrics: r.lyrics.map(promote_global_lyrics),
        sounds,
    })
}

fn promote_root_vendor(x: Option<&raw::VendorExtensions>) -> Option<ModelRootVendorExtension> {
    let json = read_viritura_ext(x)?;
    let metadata = json
        .get("metadata")
        .cloned()
        .and_then(|v| serde_json::from_value::<ModelScoreMetadata>(v).ok());
    let text_styles = json.get("textStyles").cloned();
    let placement = json.get("placement").cloned();
    let time_signatures = json
        .get("timeSignatures")
        .cloned()
        .and_then(|v| serde_json::from_value::<ModelTimeSignatureStyles>(v).ok());
    if metadata.is_none()
        && text_styles.is_none()
        && placement.is_none()
        && time_signatures.is_none()
    {
        return None;
    }
    Some(ModelRootVendorExtension {
        viritura: Some(ModelRootVirituraExtension {
            metadata,
            text_styles,
            placement,
            time_signatures,
        }),
    })
}

/// Convert a full MNX document JSON value into a [`ModelScore`].
pub fn promote_root(root_json: serde_json::Value) -> Result<ModelScore, PromoteError> {
    // Normalise pre-spec aliases (e.g. `dotted-half` → `half` + dots) once,
    // so both raw deserialisation and our per-event content dispatch see
    // schema-conformant shapes.
    let mut root_json = root_json;
    normalise_durations(&mut root_json);
    let raw_root: raw::Root = serde_json::from_value(prepare_root_for_raw(&root_json))
        .map_err(|e| PromoteError::UnsupportedNoteValueBase(format!("root parse: {e}")))?;

    let mnx = promote_mnx_meta(raw_root.mnx);
    let global = promote_global(raw_root.global, root_json.get("global"))?;

    // Parts: pass original JSON for each part.
    let parts_json = root_json
        .get("parts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut parts: Vec<ModelPart> = Vec::with_capacity(raw_root.parts.len());
    for (idx, raw_part) in raw_root.parts.into_iter().enumerate() {
        let pj = parts_json
            .get(idx)
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        parts.push(promote_part(raw_part, &pj)?);
    }

    // Layouts: pass per-layout JSON for content dispatch.
    let layouts_json = root_json
        .get("layouts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let layouts = raw_root
        .layouts
        .into_iter()
        .enumerate()
        .map(|(idx, layout)| {
            let layout_json = layouts_json
                .get(idx)
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            promote_system_layout(layout, &layout_json)
        })
        .collect();

    let scores = raw_root
        .scores
        .into_iter()
        .map(promote_score_definition)
        .collect();

    let vendor_ext = promote_root_vendor(raw_root.x.as_ref());

    Ok(ModelScore {
        mnx,
        global,
        parts,
        layouts,
        scores,
        vendor_ext,
    })
}

/// Strip content/sequences from raw JSON so typify's broken anyOf-union
/// types deserialize successfully. We carry the original JSON separately
/// for the actual content dispatch.
///
/// Also normalises a handful of pre-spec aliases the engine accepted
/// historically:
///   * `{"base": "dotted-X"}` / `{"base": "dotted X"}` → `{"base": "X",
///     "dots": <existing dots or 0> + 1}`.
///   * `{"base": "long"}` (used by some legacy fixtures) →
///     `{"base": "longa"}`.
fn prepare_root_for_raw(root: &serde_json::Value) -> serde_json::Value {
    let mut root = root.clone();
    if let Some(parts) = root.get_mut("parts").and_then(|v| v.as_array_mut()) {
        for p in parts.iter_mut() {
            if let Some(measures) = p.get_mut("measures").and_then(|v| v.as_array_mut()) {
                for m in measures.iter_mut() {
                    if let Some(seqs) = m.get_mut("sequences").and_then(|v| v.as_array_mut()) {
                        for s in seqs.iter_mut() {
                            if let serde_json::Value::Object(so) = s {
                                so.insert("content".into(), serde_json::Value::Array(Vec::new()));
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some(layouts) = root.get_mut("layouts").and_then(|v| v.as_array_mut()) {
        for l in layouts.iter_mut() {
            if let serde_json::Value::Object(lo) = l {
                lo.insert("content".into(), serde_json::Value::Array(Vec::new()));
            }
        }
    }
    root
}

fn normalise_durations(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            if let Some(base_v) = map.get("base").cloned() {
                if let Some(base_s) = base_v.as_str() {
                    let stripped = base_s
                        .strip_prefix("dotted-")
                        .or_else(|| base_s.strip_prefix("dotted "));
                    if let Some(rest) = stripped {
                        map.insert("base".into(), serde_json::Value::String(rest.to_string()));
                        let prior = map.get("dots").and_then(|d| d.as_u64()).unwrap_or(0);
                        map.insert("dots".into(), serde_json::Value::Number((prior + 1).into()));
                    } else if base_s == "long" {
                        map.insert(
                            "base".into(),
                            serde_json::Value::String("longa".to_string()),
                        );
                    }
                }
            }
            for (_k, child) in map.iter_mut() {
                normalise_durations(child);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                normalise_durations(item);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_minimal_score() {
        let json = serde_json::json!({
            "mnx": {"version": 1},
            "global": {"measures": [{"number": 1}]},
            "parts": [{"name": "Piano", "measures": [{"sequences": []}]}]
        });
        let s = promote_root(json).unwrap();
        assert_eq!(s.mnx.version, 1);
        assert_eq!(s.global.measures.len(), 1);
        assert_eq!(s.parts.len(), 1);
        assert_eq!(s.parts[0].name, "Piano");
    }

    #[test]
    fn promotes_root_metadata_from_vendor() {
        let json = serde_json::json!({
            "mnx": {"version": 1},
            "global": {"measures": []},
            "parts": [],
            "_x": {"viritura": {"metadata": {"title": "Symphony 1", "composer": "X"}}}
        });
        let s = promote_root(json).unwrap();
        let md = s.metadata().expect("metadata");
        assert_eq!(md.title.as_deref(), Some("Symphony 1"));
        assert_eq!(md.composer.as_deref(), Some("X"));
    }

    /// The Viritura extensions schema (copied next to the generated raw types
    /// by `pnpm gen:raw:rust`) is the published, validated source of truth for
    /// the `_x.viritura` wire shape. The root `metadata`/`textStyles` dicts are
    /// hand-decoded (not codegen-consumed) because they are flat and partially
    /// opaque, so nothing forces the hand-written model to stay in sync with
    /// the schema. These tests are that guard: every serde field the model can
    /// emit must be a property the schema documents, otherwise a future field
    /// would round-trip through the engine but fail `validate_mnx.py`.
    fn extensions_schema() -> serde_json::Value {
        serde_json::from_str(include_str!("../viritura-extensions-schema.json"))
            .expect("embedded viritura-extensions schema is valid JSON")
    }

    fn schema_property_keys(schema: &serde_json::Value, def: &str) -> Vec<String> {
        schema["$defs"][def]["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("schema $defs.{def}.properties is an object"))
            .keys()
            .cloned()
            .collect()
    }

    /// Serialize a value with every field populated and return its JSON keys.
    fn serialized_keys<T: serde::Serialize>(value: &T) -> Vec<String> {
        match serde_json::to_value(value).expect("serializes") {
            serde_json::Value::Object(map) => map.keys().cloned().collect(),
            other => panic!("expected a JSON object, got {other:?}"),
        }
    }

    #[test]
    fn score_metadata_fields_are_all_in_schema() {
        let schema = extensions_schema();
        let schema_keys = schema_property_keys(&schema, "score-metadata");

        // Fully-populated model: forces every serde field name into the JSON.
        let model = ModelScoreMetadata {
            title: Some(String::new()),
            subtitle: Some(String::new()),
            composer: Some(String::new()),
            lyricist: Some(String::new()),
            arranger: Some(String::new()),
            copyright: Some(String::new()),
        };
        for key in serialized_keys(&model) {
            assert!(
                schema_keys.contains(&key),
                "model ScoreMetadata field `{key}` is missing from \
                 viritura-extensions.json `score-metadata` (schema keys: {schema_keys:?}). \
                 Add it to the schema and re-run `pnpm gen:raw:rust`."
            );
        }
    }

    #[test]
    fn root_vendor_fields_are_all_in_schema() {
        let schema = extensions_schema();
        let schema_keys = schema_property_keys(&schema, "root-extensions");

        let model = ModelRootVirituraExtension {
            metadata: Some(ModelScoreMetadata::default()),
            text_styles: Some(serde_json::json!({})),
            placement: Some(serde_json::json!({})),
            time_signatures: Some(ModelTimeSignatureStyles::default()),
        };
        for key in serialized_keys(&model) {
            assert!(
                schema_keys.contains(&key),
                "model RootVirituraExtension field `{key}` is missing from \
                 viritura-extensions.json `root-extensions` (schema keys: {schema_keys:?})."
            );
        }
    }
}

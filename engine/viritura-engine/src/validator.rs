//! Runtime MNX-schema validator for the Rust engine.
//!
//! Rust mirror of `packages/format/src/mnx/validator.ts`. Compiles the MNX
//! JSON Schema once (lazily) and exposes guard / validate / assert helpers
//! that narrow `serde_json::Value` to a schema-conformant `RawScore`.
//!
//! The schema source is `src/mnx-schema.json`, copied next to `raw.rs` by
//! `viritura-codegen` so the engine is self-contained at compile time
//! (no runtime file IO, no need to ship the schema separately).
//!
//! Once `promote(raw: RawScore) -> Score` exists, the full type-safe
//! pipeline becomes:
//!
//! ```text
//! Value ──assert_raw_score──▶ RawScore ──promote──▶ Score
//! ```
//!
//! …matching the TS `assertRawScore → promote` sandwich.

mod extensions;

use std::collections::HashSet;
use std::fmt;
use std::sync::OnceLock;

use jsonschema::JSONSchema;
use serde_json::Value;

use crate::raw;

/// Raw MNX schema JSON, embedded at compile time. Updated by
/// `pnpm gen:raw:rust` alongside `raw.rs`.
const MNX_SCHEMA_JSON: &str = include_str!("mnx-schema.json");

/// Type alias for clarity: the typify-generated root schema type.
///
/// typify names the MNX document `Root` (the top-level schema has no
/// `title`). We re-export it as `RawScore` so the Rust API matches the TS
/// shape (`RawScore` in `@viritura/format`) and consumers don't have to
/// reach into `raw::` for the most common type.
pub type RawScore = raw::Root;

/// A single schema-validation error, normalised for downstream display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawScoreValidationError {
    /// JSON pointer into the input value, e.g. "/parts/0/measures/2/clefs".
    /// Empty string when the error applies at the root.
    pub pointer: String,
    /// Human-readable description of what went wrong.
    pub message: String,
    /// The schema keyword that triggered the error (e.g. "required", "enum").
    pub keyword: String,
}

impl fmt::Display for RawScoreValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pointer = if self.pointer.is_empty() {
            "(root)"
        } else {
            &self.pointer
        };
        write!(f, "{pointer}: {} [{}]", self.message, self.keyword)
    }
}

/// Result of a non-throwing validation check.
#[derive(Debug, Clone)]
pub enum RawScoreValidationResult {
    /// The value matches the MNX schema.
    Ok,
    /// The value failed validation; one error per offending field.
    Err(Vec<RawScoreValidationError>),
}

/// Thrown by `assert_raw_score` when validation fails. Carries every error
/// the schema reported (not just the first), so callers can render a full
/// problem report.
#[derive(Debug, Clone)]
pub struct RawScoreValidationFailure {
    pub errors: Vec<RawScoreValidationError>,
}

impl fmt::Display for RawScoreValidationFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Match the TS formatter: show the count plus the first 8 errors.
        writeln!(
            f,
            "MNX schema validation failed ({} error{}):",
            self.errors.len(),
            if self.errors.len() == 1 { "" } else { "s" }
        )?;
        for err in self.errors.iter().take(8) {
            writeln!(f, "  {err}")?;
        }
        if self.errors.len() > 8 {
            writeln!(f, "  … and {} more", self.errors.len() - 8)?;
        }
        Ok(())
    }
}

impl std::error::Error for RawScoreValidationFailure {}

/// Lazily-compiled MNX schema validator. Compilation walks the entire MNX
/// schema graph and is non-trivial (~a few ms), so we do it once.
fn schema() -> &'static JSONSchema {
    static COMPILED: OnceLock<JSONSchema> = OnceLock::new();
    COMPILED.get_or_init(|| {
        let value: Value = serde_json::from_str(MNX_SCHEMA_JSON)
            .expect("embedded MNX schema is valid JSON (checked at codegen time)");
        JSONSchema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .compile(&value)
            .expect("embedded MNX schema compiles as a valid JSON Schema (draft 2020-12)")
    })
}

/// Map a `jsonschema::ValidationError` into our normalised shape.
fn normalise_error(err: jsonschema::ValidationError<'_>) -> RawScoreValidationError {
    let pointer = err.instance_path.to_string();
    let keyword = format!("{:?}", err.kind);
    RawScoreValidationError {
        pointer,
        message: err.to_string(),
        // `kind` is an enum; its Debug representation is sufficient for
        // discriminating errors downstream. Renderable display goes through
        // `message`.
        keyword,
    }
}

fn dynamic_error(
    pointer: String,
    message: impl Into<String>,
    keyword: &str,
) -> RawScoreValidationError {
    RawScoreValidationError {
        pointer,
        message: message.into(),
        keyword: keyword.into(),
    }
}

fn semantic_dynamic_errors(value: &Value) -> Vec<RawScoreValidationError> {
    let measure_ids: HashSet<&str> = value
        .pointer("/global/measures")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|measure| measure.get("id").and_then(Value::as_str))
        .collect();
    let mut ids = HashSet::new();
    let mut errors = Vec::new();
    let Some(parts) = value.get("parts").and_then(Value::as_array) else {
        return errors;
    };
    for (part_index, part) in parts.iter().enumerate() {
        let staves = part.get("staves").and_then(Value::as_u64).unwrap_or(1);
        let Some(measures) = part.get("measures").and_then(Value::as_array) else {
            continue;
        };
        for (measure_index, measure) in measures.iter().enumerate() {
            let Some(groups) = measure.get("dynamics").and_then(Value::as_array) else {
                continue;
            };
            for (group_index, group) in groups.iter().enumerate() {
                let pointer =
                    format!("/parts/{part_index}/measures/{measure_index}/dynamics/{group_index}");
                let group_type = group.get("type").and_then(Value::as_str);
                let required = match group_type {
                    Some("immediate" | "accent") => &["value"][..],
                    Some("gradual") => &["end", "wedgeType"][..],
                    Some("relative") => &["relativeValue"][..],
                    _ => &[][..],
                };
                for field in required {
                    if group.get(*field).is_none() {
                        errors.push(dynamic_error(
                            format!("{pointer}/{field}"),
                            format!(
                                "dynamic group type {} requires {field}",
                                group_type.unwrap_or("unknown")
                            ),
                            "semantic-required",
                        ));
                    }
                }
                if let Some(id) = group.get("id").and_then(Value::as_str) {
                    if !ids.insert(id) {
                        errors.push(dynamic_error(
                            format!("{pointer}/id"),
                            format!("duplicate dynamic-group id {id}"),
                            "unique-id",
                        ));
                    }
                }
                if let Some(end_measure) = group.pointer("/end/measure").and_then(Value::as_str) {
                    if !measure_ids.contains(end_measure) {
                        errors.push(dynamic_error(
                            format!("{pointer}/end/measure"),
                            format!("unknown gradual end measure {end_measure}"),
                            "reference",
                        ));
                    }
                }
                let staff = group.get("staff").and_then(Value::as_u64);
                if staff.is_some_and(|number| number == 0 || number > staves) {
                    errors.push(dynamic_error(
                        format!("{pointer}/staff"),
                        format!("staff must address one of the part's {staves} staves"),
                        "range",
                    ));
                }
                if group.get("orient").and_then(Value::as_str) == Some("between") {
                    let valid = match staff {
                        Some(number) => number < staves,
                        None => staves == 2,
                    };
                    if !valid {
                        errors.push(dynamic_error(
                            format!("{pointer}/orient"),
                            "between orientation requires an adjacent staff pair",
                            "orientation",
                        ));
                    }
                }
                if let Some(glyphs) = group.get("glyphs").and_then(Value::as_array) {
                    for (glyph_index, glyph) in glyphs.iter().enumerate() {
                        if glyph.as_str().is_none_or(|name| {
                            crate::render::smufl::smufl::smufl_name_to_codepoint(name).is_none()
                        }) {
                            errors.push(dynamic_error(
                                format!("{pointer}/glyphs/{glyph_index}"),
                                "unknown SMuFL dynamic glyph name",
                                "glyph",
                            ));
                        }
                    }
                }
            }
        }
    }
    errors
}

fn collect_kit_note_errors(
    content: &[Value],
    component_ids: &HashSet<&str>,
    pointer: &str,
    errors: &mut Vec<RawScoreValidationError>,
) {
    for (item_index, item) in content.iter().enumerate() {
        let item_pointer = format!("{pointer}/{item_index}");
        if let Some(notes) = item.get("kitNotes").and_then(Value::as_array) {
            for (note_index, note) in notes.iter().enumerate() {
                let Some(component) = note.get("kitComponent").and_then(Value::as_str) else {
                    continue;
                };
                if !component_ids.contains(component) {
                    errors.push(dynamic_error(
                        format!("{item_pointer}/kitNotes/{note_index}/kitComponent"),
                        format!("unknown kit component {component}"),
                        "reference",
                    ));
                }
            }
        }
        if let Some(inner) = item.get("content").and_then(Value::as_array) {
            collect_kit_note_errors(
                inner,
                component_ids,
                &format!("{item_pointer}/content"),
                errors,
            );
        }
    }
}

fn semantic_kit_errors(value: &Value) -> Vec<RawScoreValidationError> {
    let sound_ids: HashSet<&str> = value
        .pointer("/global/sounds")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|sounds| sounds.keys().map(String::as_str))
        .collect();
    let mut errors = Vec::new();
    let Some(parts) = value.get("parts").and_then(Value::as_array) else {
        return errors;
    };
    for (part_index, part) in parts.iter().enumerate() {
        let kit = part.get("kit").and_then(Value::as_object);
        let component_ids: HashSet<&str> = kit
            .into_iter()
            .flat_map(|components| components.keys().map(String::as_str))
            .collect();
        if let Some(components) = kit {
            for (component_id, component) in components {
                if let Some(sound) = component.get("sound").and_then(Value::as_str) {
                    if !sound_ids.contains(sound) {
                        errors.push(dynamic_error(
                            format!("/parts/{part_index}/kit/{component_id}/sound"),
                            format!("unknown global sound {sound}"),
                            "reference",
                        ));
                    }
                }
            }
        }
        let Some(measures) = part.get("measures").and_then(Value::as_array) else {
            continue;
        };
        for (measure_index, measure) in measures.iter().enumerate() {
            let Some(sequences) = measure.get("sequences").and_then(Value::as_array) else {
                continue;
            };
            for (sequence_index, sequence) in sequences.iter().enumerate() {
                let Some(content) = sequence.get("content").and_then(Value::as_array) else {
                    continue;
                };
                collect_kit_note_errors(
                    content,
                    &component_ids,
                    &format!(
                        "/parts/{part_index}/measures/{measure_index}/sequences/{sequence_index}/content"
                    ),
                    &mut errors,
                );
            }
        }
    }
    errors
}

/// Validate a JSON value against the MNX schema, returning a structured
/// result. Does not throw.
#[must_use]
pub fn validate_raw_score(value: &Value) -> RawScoreValidationResult {
    let mut errors = schema()
        .validate(value)
        .err()
        .map(|reported| reported.map(normalise_error).collect::<Vec<_>>())
        .unwrap_or_default();
    errors.extend(semantic_dynamic_errors(value));
    errors.extend(semantic_kit_errors(value));
    errors.extend(extensions::extension_errors(value));
    if errors.is_empty() {
        RawScoreValidationResult::Ok
    } else {
        RawScoreValidationResult::Err(errors)
    }
}

/// Cheap boolean check: does `value` conform to the MNX schema?
///
/// Use this when you only care about pass/fail and don't need error details.
#[must_use]
pub fn is_raw_score(value: &Value) -> bool {
    schema().is_valid(value)
        && semantic_dynamic_errors(value).is_empty()
        && semantic_kit_errors(value).is_empty()
        && extensions::extension_errors(value).is_empty()
}

/// Validate `value` against the MNX schema, returning the parsed `RawScore`
/// on success or a `RawScoreValidationFailure` carrying every schema error
/// on failure.
///
/// This is the strict entry point — equivalent to TS `assertRawScore` +
/// the implicit narrowing that follows it. Once `promote(raw)` exists, it
/// will form the first half of the validate→promote sandwich.
///
/// # Errors
///
/// Returns `RawScoreValidationFailure` when the value does not match the
/// MNX schema. The failure carries every error reported (not just the first).
pub fn assert_raw_score(value: &Value) -> Result<RawScore, RawScoreValidationFailure> {
    let errors: Vec<_> = match schema().validate(value) {
        Ok(()) => Vec::new(),
        Err(es) => es.map(normalise_error).collect(),
    };
    let mut errors = errors;
    errors.extend(semantic_dynamic_errors(value));
    errors.extend(semantic_kit_errors(value));
    errors.extend(extensions::extension_errors(value));
    if !errors.is_empty() {
        return Err(RawScoreValidationFailure { errors });
    }
    // Schema-validated value deserialises into RawScore by construction; a
    // failure here would indicate a bug in the codegen (typify-generated
    // structs not matching the schema they were generated from).
    serde_json::from_value::<RawScore>(value.clone()).map_err(|e| RawScoreValidationFailure {
        errors: vec![RawScoreValidationError {
            pointer: String::new(),
            message: format!("internal: schema-valid MNX failed to decode into RawScore: {e}"),
            keyword: "deserialize".to_string(),
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_valid_mnx() -> Value {
        serde_json::json!({
            "mnx": { "version": 1 },
            "global": { "measures": [] },
            "parts": []
        })
    }

    #[test]
    fn schema_compiles() {
        // Compiling the schema is the most fragile part of this module —
        // if the embedded schema drifts into something jsonschema can't
        // handle, this test catches it before any consumer does.
        let _ = schema();
    }

    #[test]
    fn minimal_mnx_validates() {
        assert!(is_raw_score(&minimal_valid_mnx()));
    }

    #[test]
    fn empty_object_does_not_validate() {
        assert!(!is_raw_score(&serde_json::json!({})));
    }

    #[test]
    fn assert_returns_raw_score_for_valid_input() {
        let raw = assert_raw_score(&minimal_valid_mnx()).expect("minimal MNX is valid");
        // VersionNumber is a typify newtype around i64; deref for comparison.
        assert_eq!(*raw.mnx.version, 1);
    }

    #[test]
    fn assert_returns_errors_for_invalid_input() {
        let err = assert_raw_score(&serde_json::json!({}))
            .expect_err("empty object should fail validation");
        assert!(
            !err.errors.is_empty(),
            "expected at least one validation error"
        );
    }

    #[test]
    fn rejects_unknown_nested_viritura_extension_property() {
        let value = serde_json::json!({
            "mnx": { "version": 1 },
            "global": { "measures": [{}] },
            "parts": [{ "measures": [{ "sequences": [{ "content": [{
                "duration": { "base": "quarter" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }],
                "_x": { "viritura": { "inventedProperty": true } }
            }] }] }] }]
        });
        let RawScoreValidationResult::Err(errors) = validate_raw_score(&value) else {
            panic!("unknown nested extension property should fail validation");
        };
        assert!(errors.iter().any(|error| {
            error.pointer == "/parts/0/measures/0/sequences/0/content/0/_x/viritura"
        }));
    }

    #[test]
    fn rejects_viritura_extension_at_unsupported_location() {
        let value = serde_json::json!({
            "mnx": { "version": 1 },
            "global": { "measures": [{}] },
            "parts": [{ "measures": [{ "sequences": [{
                "content": [],
                "_x": { "viritura": { "inventedProperty": true } }
            }] }] }]
        });
        let RawScoreValidationResult::Err(errors) = validate_raw_score(&value) else {
            panic!("extension at unsupported location should fail validation");
        };
        assert!(errors.iter().any(|error| {
            error.pointer == "/parts/0/measures/0/sequences/0/_x/viritura"
                && error.keyword == "extensionLocation"
        }));
    }

    #[test]
    fn rejects_semantically_incomplete_dynamic_group() {
        let value = serde_json::json!({
            "mnx": { "version": 1 },
            "global": { "measures": [{ "id": "m1" }] },
            "parts": [{ "measures": [{
                "sequences": [],
                "dynamics": [{
                    "id": "gradual-1",
                    "type": "gradual",
                    "position": { "fraction": [0, 1] }
                }]
            }] }]
        });
        let RawScoreValidationResult::Err(errors) = validate_raw_score(&value) else {
            panic!("incomplete gradual group should fail semantic validation");
        };
        assert!(errors.iter().any(|error| error.pointer.ends_with("/end")));
        assert!(errors
            .iter()
            .any(|error| error.pointer.ends_with("/wedgeType")));
    }

    #[test]
    fn rejects_invalid_dynamic_scope_reference_and_glyph() {
        let value = serde_json::json!({
            "mnx": { "version": 1 },
            "global": { "measures": [{ "id": "m1" }] },
            "parts": [{ "staves": 2, "measures": [{
                "sequences": [],
                "dynamics": [{
                    "id": "gradual-1",
                    "type": "gradual",
                    "position": { "fraction": [0, 1] },
                    "end": { "measure": "missing", "position": { "fraction": [1, 1] } },
                    "wedgeType": "increasing",
                    "staff": 2,
                    "orient": "between",
                    "glyphs": ["notARealSmuflGlyph"]
                }]
            }] }]
        });
        let RawScoreValidationResult::Err(errors) = validate_raw_score(&value) else {
            panic!("invalid dynamic semantics should fail validation");
        };
        assert!(errors.iter().any(|error| error.keyword == "reference"));
        assert!(errors.iter().any(|error| error.keyword == "orientation"));
        assert!(errors.iter().any(|error| error.keyword == "glyph"));
    }

    #[test]
    fn rejects_invalid_percussion_references() {
        let value = serde_json::json!({
            "mnx": { "version": 1 },
            "global": {
                "measures": [{ "id": "m1" }],
                "sounds": { "snare-sound": { "midiNumber": 38 } }
            },
            "parts": [{
                "kit": { "snare": { "staffPosition": 0, "sound": "missing-sound" } },
                "measures": [{ "sequences": [{ "content": [{
                    "duration": { "base": "quarter" },
                    "kitNotes": [{ "kitComponent": "missing-component" }]
                }] }] }]
            }]
        });
        let RawScoreValidationResult::Err(errors) = validate_raw_score(&value) else {
            panic!("invalid percussion references should fail validation");
        };
        assert!(errors.iter().any(|error| error.pointer.ends_with("/sound")));
        assert!(errors
            .iter()
            .any(|error| error.pointer.ends_with("/kitComponent")));
    }

    #[test]
    fn fixture_files_all_validate() {
        // The 71 MNX example files in packages/format/fixtures/mnx/ are
        // ground-truth conformance fixtures (validated by validate_mnx.py
        // in CI). They MUST all pass our embedded schema too — if they
        // don't, our Rust schema copy has drifted from the TS one.
        let workspace = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .expect("workspace root resolvable")
            .to_path_buf();
        let scores_dir = workspace.join("packages/format/fixtures/mnx");
        let entries = std::fs::read_dir(&scores_dir).expect("scores dir exists");
        let mut checked = 0usize;
        let mut failures: Vec<(String, RawScoreValidationFailure)> = Vec::new();
        for entry in entries {
            let entry = entry.expect("dir entry readable");
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("mnx") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("fixture readable");
            let value: Value = serde_json::from_str(&text).expect("fixture is JSON");
            if let Err(failure) = assert_raw_score(&value) {
                failures.push((
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    failure,
                ));
            }
            checked += 1;
        }
        assert!(checked >= 50, "expected ~71 fixtures, found {checked}");
        assert!(
            failures.is_empty(),
            "{} fixture(s) failed validation:\n{}",
            failures.len(),
            failures
                .iter()
                .map(|(name, f)| format!("  - {name}: {f}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}

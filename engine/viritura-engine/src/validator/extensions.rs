use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use jsonschema::JSONSchema;
use serde_json::Value;

use super::RawScoreValidationError;

const EXTENSIONS_SCHEMA_JSON: &str = include_str!("../viritura-extensions-schema.json");
const DEFINITIONS: &[&str] = &[
    "root-extensions",
    "measure-global-extensions",
    "key-extensions",
    "tempo-extensions",
    "part-extensions",
    "kit-component-extensions",
    "part-measure-extensions",
    "dynamic-group-extensions",
    "event-extensions",
    "event-markings-extensions",
    "note-extensions",
    "slur-extensions",
    "system-layout-extensions",
    "score-extensions",
];

fn schemas() -> &'static HashMap<&'static str, JSONSchema> {
    static COMPILED: OnceLock<HashMap<&'static str, JSONSchema>> = OnceLock::new();
    COMPILED.get_or_init(|| {
        let source: Value = serde_json::from_str(EXTENSIONS_SCHEMA_JSON)
            .expect("embedded Viritura extensions schema is valid JSON");
        DEFINITIONS
            .iter()
            .map(|definition| {
                let mut schema = source.clone();
                schema
                    .as_object_mut()
                    .expect("extensions schema root is an object")
                    .insert(
                        "$ref".into(),
                        Value::String(format!("#/$defs/{definition}")),
                    );
                let compiled = JSONSchema::options()
                    .with_draft(jsonschema::Draft::Draft202012)
                    .compile(&schema)
                    .unwrap_or_else(|error| {
                        panic!("Viritura extension definition '{definition}' compiles: {error}")
                    });
                (*definition, compiled)
            })
            .collect()
    })
}

fn pointer_token(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn array<'a>(object: &'a Value, key: &str) -> &'a [Value] {
    object
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn validate_at(
    object: Option<&Value>,
    pointer: &str,
    definition: &'static str,
    consumed: &mut HashSet<String>,
    errors: &mut Vec<RawScoreValidationError>,
) {
    let Some(extension) = object
        .and_then(|value| value.get("_x"))
        .and_then(|value| value.get("viritura"))
    else {
        return;
    };
    let extension_pointer = format!("{pointer}/_x/viritura");
    consumed.insert(extension_pointer.clone());
    let validator = schemas()
        .get(definition)
        .expect("every traversed extension definition is compiled");
    let Err(reported) = validator.validate(extension) else {
        return;
    };
    errors.extend(reported.map(|error| {
        let relative = error.instance_path.to_string();
        RawScoreValidationError {
            pointer: format!("{extension_pointer}{relative}"),
            message: error.to_string(),
            keyword: format!("{:?}", error.kind),
        }
    }));
}

fn visit_content(
    content: &[Value],
    pointer: &str,
    consumed: &mut HashSet<String>,
    errors: &mut Vec<RawScoreValidationError>,
) {
    for (index, item) in content.iter().enumerate() {
        let item_pointer = format!("{pointer}/{index}");
        let item_type = item.get("type").and_then(Value::as_str);
        if !matches!(item_type, Some("grace" | "tuplet" | "space" | "tremolo")) {
            validate_at(
                Some(item),
                &item_pointer,
                "event-extensions",
                consumed,
                errors,
            );
            validate_at(
                item.get("markings"),
                &format!("{item_pointer}/markings"),
                "event-markings-extensions",
                consumed,
                errors,
            );
            for (note_index, note) in array(item, "notes").iter().enumerate() {
                validate_at(
                    Some(note),
                    &format!("{item_pointer}/notes/{note_index}"),
                    "note-extensions",
                    consumed,
                    errors,
                );
            }
            for (slur_index, slur) in array(item, "slurs").iter().enumerate() {
                validate_at(
                    Some(slur),
                    &format!("{item_pointer}/slurs/{slur_index}"),
                    "slur-extensions",
                    consumed,
                    errors,
                );
            }
        }
        visit_content(
            array(item, "content"),
            &format!("{item_pointer}/content"),
            consumed,
            errors,
        );
    }
}

fn find_unsupported(
    value: &Value,
    pointer: &str,
    consumed: &HashSet<String>,
    errors: &mut Vec<RawScoreValidationError>,
) {
    match value {
        Value::Object(object) => {
            if object
                .get("_x")
                .and_then(|value| value.get("viritura"))
                .is_some()
            {
                let extension_pointer = format!("{pointer}/_x/viritura");
                if !consumed.contains(&extension_pointer) {
                    errors.push(RawScoreValidationError {
                        pointer: extension_pointer,
                        message:
                            "Viritura extensions are not supported at this MNX object location"
                                .into(),
                        keyword: "extensionLocation".into(),
                    });
                }
            }
            for (key, child) in object {
                if key != "_x" {
                    find_unsupported(
                        child,
                        &format!("{pointer}/{}", pointer_token(key)),
                        consumed,
                        errors,
                    );
                }
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                find_unsupported(item, &format!("{pointer}/{index}"), consumed, errors);
            }
        }
        _ => {}
    }
}

pub(super) fn extension_errors(root: &Value) -> Vec<RawScoreValidationError> {
    let mut consumed = HashSet::new();
    let mut errors = Vec::new();
    validate_at(
        Some(root),
        "",
        "root-extensions",
        &mut consumed,
        &mut errors,
    );

    if let Some(global) = root.get("global") {
        for (measure_index, measure) in array(global, "measures").iter().enumerate() {
            let pointer = format!("/global/measures/{measure_index}");
            validate_at(
                Some(measure),
                &pointer,
                "measure-global-extensions",
                &mut consumed,
                &mut errors,
            );
            validate_at(
                measure.get("key"),
                &format!("{pointer}/key"),
                "key-extensions",
                &mut consumed,
                &mut errors,
            );
            for (tempo_index, tempo) in array(measure, "tempos").iter().enumerate() {
                validate_at(
                    Some(tempo),
                    &format!("{pointer}/tempos/{tempo_index}"),
                    "tempo-extensions",
                    &mut consumed,
                    &mut errors,
                );
            }
        }
    }

    for (part_index, part) in array(root, "parts").iter().enumerate() {
        let part_pointer = format!("/parts/{part_index}");
        validate_at(
            Some(part),
            &part_pointer,
            "part-extensions",
            &mut consumed,
            &mut errors,
        );
        if let Some(kit) = part.get("kit").and_then(Value::as_object) {
            for (component_id, component) in kit {
                validate_at(
                    Some(component),
                    &format!("{part_pointer}/kit/{}", pointer_token(component_id)),
                    "kit-component-extensions",
                    &mut consumed,
                    &mut errors,
                );
            }
        }
        for (measure_index, measure) in array(part, "measures").iter().enumerate() {
            let measure_pointer = format!("{part_pointer}/measures/{measure_index}");
            validate_at(
                Some(measure),
                &measure_pointer,
                "part-measure-extensions",
                &mut consumed,
                &mut errors,
            );
            for (dynamic_index, dynamic) in array(measure, "dynamics").iter().enumerate() {
                validate_at(
                    Some(dynamic),
                    &format!("{measure_pointer}/dynamics/{dynamic_index}"),
                    "dynamic-group-extensions",
                    &mut consumed,
                    &mut errors,
                );
            }
            for (sequence_index, sequence) in array(measure, "sequences").iter().enumerate() {
                visit_content(
                    array(sequence, "content"),
                    &format!("{measure_pointer}/sequences/{sequence_index}/content"),
                    &mut consumed,
                    &mut errors,
                );
            }
        }
    }

    for (index, layout) in array(root, "layouts").iter().enumerate() {
        validate_at(
            Some(layout),
            &format!("/layouts/{index}"),
            "system-layout-extensions",
            &mut consumed,
            &mut errors,
        );
    }
    for (index, score) in array(root, "scores").iter().enumerate() {
        validate_at(
            Some(score),
            &format!("/scores/{index}"),
            "score-extensions",
            &mut consumed,
            &mut errors,
        );
    }

    find_unsupported(root, "", &consumed, &mut errors);
    errors
}

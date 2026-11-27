use super::{dynamic_error, RawScoreValidationError};
use serde_json::Value;
use std::collections::HashSet;

fn check(
    value: &Value,
    pointer: &str,
    part_ids: &HashSet<&str>,
    errors: &mut Vec<RawScoreValidationError>,
) {
    if let Some(target) = value
        .get("labelRef")
        .and_then(|reference| reference.get("target"))
        .and_then(Value::as_str)
    {
        if !part_ids.contains(target) {
            errors.push(dynamic_error(
                format!("{pointer}/labelRef/target"),
                format!("must reference a part ('{target}' was not found)"),
                "reference",
            ));
        }
    }
}

fn visit(
    content: &[Value],
    pointer: &str,
    part_ids: &HashSet<&str>,
    errors: &mut Vec<RawScoreValidationError>,
) {
    for (index, item) in content.iter().enumerate() {
        let item_pointer = format!("{pointer}/{index}");
        check(item, &item_pointer, part_ids, errors);
        if let Some(children) = item.get("content").and_then(Value::as_array) {
            visit(
                children,
                &format!("{item_pointer}/content"),
                part_ids,
                errors,
            );
        }
        if let Some(sources) = item.get("sources").and_then(Value::as_array) {
            for (source_index, source) in sources.iter().enumerate() {
                check(
                    source,
                    &format!("{item_pointer}/sources/{source_index}"),
                    part_ids,
                    errors,
                );
            }
        }
    }
}

pub(super) fn errors(value: &Value) -> Vec<RawScoreValidationError> {
    let part_ids: HashSet<_> = value
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("id").and_then(Value::as_str))
        .collect();
    let mut errors = Vec::new();
    for (index, layout) in value
        .get("layouts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        if let Some(content) = layout.get("content").and_then(Value::as_array) {
            visit(
                content,
                &format!("/layouts/{index}/content"),
                &part_ids,
                &mut errors,
            );
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_missing_label_targets_on_groups_staves_and_sources() {
        let document = json!({
            "parts": [{"id": "p1"}],
            "layouts": [{"content": [{
                "type": "group", "labelRef": {"target": "missing"},
                "content": [{
                    "type": "staff", "labelRef": {"target": "missing"},
                    "sources": [{"part": "p1", "labelRef": {"target": "missing"}}]
                }]
            }]}]
        });
        let errors = errors(&document);
        assert_eq!(errors.len(), 3);
        assert!(errors
            .iter()
            .all(|error| error.pointer.ends_with("/labelRef/target")));
    }
}

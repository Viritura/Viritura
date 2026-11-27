use super::{dynamic_error, RawScoreValidationError};
use serde_json::Value;
use std::collections::HashSet;

fn array(value: Option<&Value>) -> &[Value] {
    value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn pointer_token(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn visit_content(
    content: &[Value],
    pointer: &str,
    ordered_ids: &HashSet<&str>,
    has_global_lyrics: bool,
    has_event_lyrics: &mut bool,
    errors: &mut Vec<RawScoreValidationError>,
) {
    for (index, item) in content.iter().enumerate() {
        let item_pointer = format!("{pointer}/{index}");
        if let Some(lyrics) = item.get("lyrics") {
            *has_event_lyrics = true;
            if has_global_lyrics {
                if let Some(lines) = lyrics.get("lines").and_then(Value::as_object) {
                    for id in lines.keys() {
                        if !ordered_ids.contains(id.as_str()) {
                            errors.push(dynamic_error(
                                format!("{item_pointer}/lyrics/lines/{}", pointer_token(id)),
                                "must be listed in global.lyrics.lineOrder",
                                "reference",
                            ));
                        }
                    }
                }
            }
        }
        visit_content(
            array(item.get("content")),
            &format!("{item_pointer}/content"),
            ordered_ids,
            has_global_lyrics,
            has_event_lyrics,
            errors,
        );
    }
}

pub(super) fn errors(value: &Value) -> Vec<RawScoreValidationError> {
    let lyrics = value.pointer("/global/lyrics").and_then(Value::as_object);
    let ordered_ids: HashSet<_> = lyrics
        .and_then(|lyrics| lyrics.get("lineOrder"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let mut errors = Vec::new();
    if let Some(metadata) = lyrics
        .and_then(|lyrics| lyrics.get("lineMetadata"))
        .and_then(Value::as_object)
    {
        for id in metadata.keys() {
            if !ordered_ids.contains(id.as_str()) {
                errors.push(dynamic_error(
                    format!("/global/lyrics/lineMetadata/{}", pointer_token(id)),
                    "must be listed in global.lyrics.lineOrder",
                    "reference",
                ));
            }
        }
    }
    let mut has_event_lyrics = false;
    for (part_index, part) in array(value.get("parts")).iter().enumerate() {
        for (measure_index, measure) in array(part.get("measures")).iter().enumerate() {
            for (sequence_index, sequence) in array(measure.get("sequences")).iter().enumerate() {
                visit_content(
                    array(sequence.get("content")),
                    &format!(
                        "/parts/{part_index}/measures/{measure_index}/sequences/{sequence_index}/content"
                    ),
                    &ordered_ids,
                    lyrics.is_some(),
                    &mut has_event_lyrics,
                    &mut errors,
                );
            }
        }
    }
    if has_event_lyrics && lyrics.is_none() {
        errors.push(dynamic_error(
            "/global/lyrics".into(),
            "is required when any event has lyrics",
            "required",
        ));
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn requires_and_checks_lyric_line_order() {
        let mut document = json!({
            "mnx": {"version": 1},
            "global": {"measures": [{}]},
            "parts": [{"measures": [{"sequences": [{"content": [{
                "type": "grace",
                "content": [{
                    "duration": {"base": "quarter"},
                    "notes": [{"pitch": {"step": "C", "octave": 4}}],
                    "lyrics": {"lines": {"2/~": {"text": "Hi"}}}
                }]
            }]}]}]}]
        });
        assert!(errors(&document)
            .iter()
            .any(|error| error.pointer == "/global/lyrics"));
        document["global"]["lyrics"] = json!({"lineOrder": ["1"], "lineMetadata": {"3": {}}});
        let errors = errors(&document);
        assert!(errors
            .iter()
            .any(|error| error.pointer == "/global/lyrics/lineMetadata/3"));
        assert!(errors
            .iter()
            .any(|error| error.pointer.ends_with("/lyrics/lines/2~1~0")));
        document["global"]["lyrics"]["lineOrder"] = json!(["1", "2/~", "3"]);
        assert!(super::super::is_raw_score(&document));
    }
}

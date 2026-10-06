use super::PromoteError;
use crate::model::SystemText;
use crate::raw;
use std::collections::HashSet;

pub(super) fn extract_system_text(
    extensions: Option<&raw::VendorExtensions>,
) -> Result<Option<Vec<SystemText>>, PromoteError> {
    let Some(vendor) = super::vendor_ext::read_viritura_ext(extensions) else {
        return Ok(None);
    };
    let Some(value) = vendor.get("systemText") else {
        return Ok(None);
    };
    let error = PromoteError::InvalidSystemText;
    let values = value
        .as_array()
        .ok_or_else(|| error("expected an array".into()))?;
    let mut ids = HashSet::new();
    let mut texts = Vec::with_capacity(values.len());
    for value in values {
        crate::validator::validate_system_text(value).map_err(error)?;
        let text: SystemText =
            serde_json::from_value(value.clone()).map_err(|reason| error(reason.to_string()))?;
        if !ids.insert(text.id.clone()) {
            return Err(error(format!("duplicate id '{}'", text.id)));
        }
        if text.text.chunks().is_empty() {
            return Err(error("text content is empty".into()));
        }
        if text.position.fraction.1 == 0 {
            return Err(error(
                "rhythmic position denominator must be positive".into(),
            ));
        }
        texts.push(text);
    }
    Ok((!texts.is_empty()).then_some(texts))
}

#[cfg(test)]
mod tests {
    use crate::promote::promote_global_measure_json;
    use serde_json::json;

    #[test]
    fn round_trips_shared_system_text_without_part_ownership() {
        let text = json!({
            "id": "system-1",
            "text": [{"text": "Together\nThen freely"}, {"glyphs": ["dynamicPiano"]}],
            "position": {"fraction": [1, 4]},
            "placement": "above",
            "manualOffset": [2, -1],
            "avoidCollisions": false,
            "frame": {"width": {"unit": "staffSpaces", "value": 16}, "border": "solid", "eraseBackground": true}
        });
        let measure = json!({"_x": {"viritura": {"systemText": [text]}}});
        let promoted = promote_global_measure_json(&measure).unwrap();
        let texts = promoted.system_text().unwrap();
        assert_eq!(texts.len(), 1);
        assert_eq!(texts[0].id, "system-1");
        assert_eq!(texts[0].text.chunks().len(), 2);
        let saved = serde_json::to_value(&promoted).unwrap();
        let restored = promote_global_measure_json(&saved).unwrap();
        assert_eq!(restored.system_text(), promoted.system_text());
    }

    #[test]
    fn rejects_invalid_system_text_on_patch_paths() {
        let valid = json!({"id": "system-1", "text": "Together", "position": {"fraction": [0, 1]}});
        let mut values = vec![
            json!(null),
            json!({}),
            json!([valid.clone(), valid.clone()]),
        ];
        for (key, value) in [
            ("id", json!("")),
            ("staff", json!(1)),
            ("voice", json!("v1")),
            ("locator", json!({"type": "page", "pageIndex": 0})),
            ("text", json!([])),
            ("position", json!({"fraction": [0, 0]})),
            ("manualOffset", json!([1])),
            (
                "frame",
                json!({"width": {"unit": "textColumnFraction", "value": 0.5}}),
            ),
        ] {
            let mut text = valid.clone();
            text[key] = value;
            values.push(json!([text]));
        }
        for value in values {
            let measure = json!({"_x": {"viritura": {"systemText": value}}});
            assert!(promote_global_measure_json(&measure).is_err());
        }
    }
}

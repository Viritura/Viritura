use serde_json::{json, Value};

use crate::model::direction::DynamicGroup;
use crate::parse::{parse_mnx, parse_mnx_strict, parse_mnx_strict_value, ParseMnxStrictError};
use crate::raw::DynamicValue;
use crate::raw_viritura::DynamicGroupExtensions;
use crate::validator::{
    assert_raw_score, is_raw_score, validate_raw_score, RawScoreValidationResult,
};

const GROUP_KINDS: [&str; 4] = ["immediate", "relative", "accent", "gradual"];
const VELOCITY_POINTER: &str = "/parts/0/measures/0/dynamics/0/_x/viritura/playbackVelocity";

fn dynamic_score(kind: &str) -> Value {
    let mut group = json!({
        "id": "dynamic-1",
        "type": kind,
        "position": { "fraction": [0, 1] }
    });
    match kind {
        "immediate" | "accent" => group["value"] = json!("mf"),
        "relative" => group["relativeValue"] = json!("louder"),
        "gradual" => {
            group["end"] = json!({ "measure": "m1", "position": { "fraction": [1, 1] } });
            group["wedgeType"] = json!("increasing");
        }
        _ => panic!("unknown dynamic group kind"),
    }
    json!({
        "mnx": { "version": 1 },
        "global": { "measures": [{ "id": "m1", "time": { "count": 4, "unit": 4 } }] },
        "parts": [{ "measures": [{
            "dynamics": [group],
            "sequences": [{ "content": [{ "duration": { "base": "whole" }, "rest": {} }] }]
        }] }]
    })
}

#[test]
fn playback_velocity_round_trips_separately_from_written_mf() {
    let mut value = dynamic_score("immediate");
    let extension = json!({
        "playbackVelocity": 96,
        "manualOffset": [1.0, -2.0],
        "avoidCollisions": false
    });
    value["parts"][0]["measures"][0]["dynamics"][0]["_x"] = json!({ "viritura": extension });
    let raw_extension: DynamicGroupExtensions = serde_json::from_value(extension.clone()).unwrap();
    assert_eq!(raw_extension.playback_velocity, Some(96));
    assert_eq!(serde_json::to_value(raw_extension).unwrap(), extension);

    let raw = assert_raw_score(&value).unwrap();
    let wire = serde_json::to_value(raw).unwrap();
    assert_eq!(wire.pointer(VELOCITY_POINTER), Some(&json!(96)));
    assert_eq!(
        wire["parts"][0]["measures"][0]["dynamics"][0]["value"],
        "mf"
    );
    assert!(wire["parts"][0]["measures"][0]["dynamics"][0]
        .get("playbackVelocity")
        .is_none());

    let score = parse_mnx(&wire.to_string()).unwrap();
    let strict = parse_mnx_strict_value(&wire).unwrap();
    let group = &score.parts[0].measures[0].dynamics.as_ref().unwrap()[0];
    assert_eq!(
        group,
        &strict.parts[0].measures[0].dynamics.as_ref().unwrap()[0]
    );
    assert_eq!(group.value, Some(DynamicValue::Mf));
    assert_eq!(group.display_value(), "mf");
    assert_eq!(group.playback_velocity, Some(96));
    assert_eq!(group.manual_offset, Some([1.0, -2.0]));
    assert_eq!(group.avoid_collisions, Some(false));

    let native = serde_json::to_value(group).unwrap();
    assert_eq!(native["playbackVelocity"], 96);
    assert!(native.get("playback_velocity").is_none());
    assert_eq!(native["value"], "mf");
    assert_eq!(
        serde_json::from_value::<DynamicGroup>(native).unwrap(),
        *group
    );
}

#[test]
fn integral_float_playback_velocity_preserves_written_mf_and_placement() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "id": "m1", "time": { "count": 4, "unit": 4 } }] },
        "parts": [{ "measures": [{
            "dynamics": [{
                "id": "dynamic-1",
                "type": "immediate",
                "position": { "fraction": [0, 1] },
                "value": "mf",
                "_x": { "viritura": {
                    "playbackVelocity": 96.0,
                    "manualOffset": [1.0, -2.0],
                    "avoidCollisions": false
                } }
            }],
            "sequences": [{ "content": [{ "duration": { "base": "whole" }, "rest": {} }] }]
        }] }]
    }"#;
    for (literal, expected) in [
        ("96.0", 96),
        ("9.6e1", 96),
        ("1.0", 1),
        ("1e0", 1),
        ("127.0", 127),
        ("1.27e2", 127),
    ] {
        let text = json.replace("96.0", literal);
        let value: Value = serde_json::from_str(&text).unwrap();
        assert!(value.pointer(VELOCITY_POINTER).unwrap().is_f64());
        let wire = serde_json::to_value(assert_raw_score(&value).unwrap()).unwrap();
        assert_eq!(
            wire.pointer(VELOCITY_POINTER).unwrap().as_f64(),
            Some(expected as f64)
        );

        let strict = parse_mnx_strict(&text).unwrap();
        let group = &strict.parts[0].measures[0].dynamics.as_ref().unwrap()[0];
        assert_eq!(group.playback_velocity, Some(expected), "{literal}");
        assert_eq!(group.value, Some(DynamicValue::Mf));
        assert_eq!(group.display_value(), "mf");
        assert_eq!(group.manual_offset, Some([1.0, -2.0]));
        assert_eq!(group.avoid_collisions, Some(false));
        for score in [
            parse_mnx(&text).unwrap(),
            parse_mnx_strict_value(&wire).unwrap(),
            parse_mnx_strict(&wire.to_string()).unwrap(),
        ] {
            assert_eq!(
                &score.parts[0].measures[0].dynamics.as_ref().unwrap()[0],
                group
            );
        }

        let native = serde_json::to_value(group).unwrap();
        assert_eq!(native["playbackVelocity"].as_i64(), Some(expected));
        assert_eq!(
            serde_json::from_value::<DynamicGroup>(native).unwrap(),
            *group
        );
    }
}

#[test]
fn missing_playback_velocity_remains_absent_for_every_group_kind() {
    for kind in GROUP_KINDS {
        let value = dynamic_score(kind);
        let raw = assert_raw_score(&value).unwrap();
        let wire = serde_json::to_value(raw).unwrap();
        assert!(wire.pointer(VELOCITY_POINTER).is_none(), "{kind}");
        let score = parse_mnx(&wire.to_string()).unwrap();
        let group = &score.parts[0].measures[0].dynamics.as_ref().unwrap()[0];
        assert_eq!(group.playback_velocity, None, "{kind}");
        let native = serde_json::to_value(group).unwrap();
        assert!(native.get("playbackVelocity").is_none(), "{kind}");
        assert_eq!(
            serde_json::from_value::<DynamicGroup>(native).unwrap(),
            *group
        );
    }
    let extension: DynamicGroupExtensions = serde_json::from_value(json!({})).unwrap();
    assert_eq!(extension.playback_velocity, None);
    assert_eq!(serde_json::to_value(extension).unwrap(), json!({}));
}

#[test]
fn playback_velocity_accepts_boundaries_on_every_group_kind_without_engraving_changes() {
    for kind in GROUP_KINDS {
        for velocity in [1, 96, 127] {
            for velocity_value in [json!(velocity), json!(velocity as f64)] {
                let mut value = dynamic_score(kind);
                let original = parse_mnx_strict_value(&value).unwrap();
                let original_group = &original.parts[0].measures[0].dynamics.as_ref().unwrap()[0];
                value["parts"][0]["measures"][0]["dynamics"][0]["_x"] =
                    json!({ "viritura": { "playbackVelocity": velocity_value } });
                assert!(is_raw_score(&value), "{kind}: {velocity}");
                assert!(matches!(
                    validate_raw_score(&value),
                    RawScoreValidationResult::Ok
                ));
                let strict = parse_mnx_strict_value(&value).unwrap();
                let lenient = parse_mnx(&value.to_string()).unwrap();
                let group = &strict.parts[0].measures[0].dynamics.as_ref().unwrap()[0];
                assert_eq!(
                    group,
                    &lenient.parts[0].measures[0].dynamics.as_ref().unwrap()[0]
                );
                assert_eq!(group.playback_velocity, Some(velocity));
                assert_eq!(group.display_value(), original_group.display_value());
                assert!(group.same_semantics(original_group));
                let mut without_velocity = group.clone();
                without_velocity.playback_velocity = None;
                assert_eq!(&without_velocity, original_group);
            }
        }
    }
}

#[test]
fn validator_rejects_invalid_playback_velocity_on_every_group_kind() {
    for kind in GROUP_KINDS {
        for velocity in [
            json!(0),
            json!(128),
            json!(0.0),
            json!(128.0),
            json!(-1.0),
            json!(96.5),
            json!(9.65e1),
            json!(1e100),
            json!("96"),
            Value::Null,
        ] {
            let mut value = dynamic_score(kind);
            value["parts"][0]["measures"][0]["dynamics"][0]["_x"] =
                json!({ "viritura": { "playbackVelocity": velocity } });
            assert!(!is_raw_score(&value), "{kind}: {velocity}");
            let RawScoreValidationResult::Err(errors) = validate_raw_score(&value) else {
                panic!("{kind}: {velocity} must fail validation");
            };
            assert!(errors.iter().any(|error| error.pointer == VELOCITY_POINTER));
            let failure = assert_raw_score(&value).unwrap_err();
            assert!(failure
                .errors
                .iter()
                .any(|error| error.pointer == VELOCITY_POINTER));
            assert!(matches!(
                parse_mnx_strict_value(&value),
                Err(ParseMnxStrictError::Validation(_))
            ));
            assert!(matches!(
                parse_mnx_strict(&value.to_string()),
                Err(ParseMnxStrictError::Validation(_))
            ));
        }
    }
}

#[test]
fn playback_velocity_is_not_a_top_level_mnx_dynamic_property() {
    for kind in GROUP_KINDS {
        let mut value = dynamic_score(kind);
        value["parts"][0]["measures"][0]["dynamics"][0]["playbackVelocity"] = json!(96);
        assert!(!is_raw_score(&value), "{kind}");
        assert!(matches!(
            parse_mnx_strict_value(&value),
            Err(ParseMnxStrictError::Validation(_))
        ));
        let score = parse_mnx(&value.to_string()).unwrap();
        assert_eq!(
            score.parts[0].measures[0].dynamics.as_ref().unwrap()[0].playback_velocity,
            None
        );
    }
}

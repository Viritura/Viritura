//! Promote [`crate::raw::Beam`] → [`crate::model::beam::Beam`].

use crate::model::beam::{Beam, BeamHookDirection};
use crate::raw;

pub(crate) fn promote_beam(raw: raw::Beam) -> Beam {
    Beam {
        events: raw.events.into_iter().map(|id| id.to_string()).collect(),
        beams: raw
            .beams
            .map(|bl| bl.0.into_iter().map(promote_beam).collect())
            .unwrap_or_default(),
        direction: raw.direction.map(promote_beam_hook_direction),
    }
}

pub(crate) fn promote_beam_hook_direction(raw: raw::BeamHookDirection) -> BeamHookDirection {
    match raw {
        raw::BeamHookDirection::Left => BeamHookDirection::Left,
        raw::BeamHookDirection::Right => BeamHookDirection::Right,
        raw::BeamHookDirection::Auto => BeamHookDirection::Auto,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_flat_beam() {
        let json = r#"{"events":["e1","e2","e3"]}"#;
        let raw: raw::Beam = serde_json::from_str(json).unwrap();
        let direct: Beam = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_beam(raw));
    }

    #[test]
    fn promotes_nested_beam_with_hook() {
        let json = r#"{
            "events": ["e1","e2"],
            "beams": [{"events":["e1"], "direction":"left"}]
        }"#;
        let raw: raw::Beam = serde_json::from_str(json).unwrap();
        let direct: Beam = serde_json::from_str(json).unwrap();
        assert_eq!(direct, promote_beam(raw));
    }
}

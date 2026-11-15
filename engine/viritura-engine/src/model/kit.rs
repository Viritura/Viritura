//! Drum-kit / unpitched percussion model (MNX `kit`, `sound`, `kit-component`,
//! `kit-note`, `perform-options`).
//!
//! MNX has no `notehead` field on `note` or `kit-component` — see W3C MNX
//! issue #249. We carry notehead shape on `KitComponent` as a Viritura vendor
//! extension serialized under `_x.viritura.notehead`.

use serde::{Deserialize, Serialize};

/// A GM MIDI sound entry (MNX `sound`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    /// GM MIDI program/note number (drum keys are MIDI numbers on channel 10).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub midi_number: Option<i32>,
    /// Human-readable name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// MNX `perform-options` — currently a stub object. Round-tripped only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerformOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// Notehead shape for a drum-kit component (Viritura vendor extension).
/// Stored under `_x.viritura.notehead`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NoteheadShape {
    #[default]
    Normal,
    X,
    CircleX,
    Diamond,
    Slash,
    TriangleUp,
    TriangleDown,
    Plus,
    Square,
    /// Native MNX custom notehead resolved to a Bravura codepoint; zero means
    /// the glyph is unsupported and the standard duration notehead is used.
    Custom(u32),
}

impl Serialize for NoteheadShape {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(match self {
            Self::Normal => "normal",
            Self::X => "x",
            Self::CircleX => "circleX",
            Self::Diamond => "diamond",
            Self::Slash => "slash",
            Self::TriangleUp => "triangleUp",
            Self::TriangleDown => "triangleDown",
            Self::Plus => "plus",
            Self::Square => "square",
            Self::Custom(_) => "custom",
        })
    }
}

impl<'de> Deserialize<'de> for NoteheadShape {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "normal" => Ok(Self::Normal),
            "x" => Ok(Self::X),
            "circleX" => Ok(Self::CircleX),
            "diamond" => Ok(Self::Diamond),
            "slash" => Ok(Self::Slash),
            "triangleUp" => Ok(Self::TriangleUp),
            "triangleDown" => Ok(Self::TriangleDown),
            "plus" => Ok(Self::Plus),
            "square" => Ok(Self::Square),
            "custom" => Ok(Self::Custom(0)),
            _ => Err(serde::de::Error::unknown_variant(
                &value,
                &[
                    "normal",
                    "x",
                    "circleX",
                    "diamond",
                    "slash",
                    "triangleUp",
                    "triangleDown",
                    "plus",
                    "square",
                    "custom",
                ],
            )),
        }
    }
}

/// Wrapper for `_x.viritura` vendor block on a `kit-component`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
struct KitComponentVirituraExt {
    #[serde(skip_serializing_if = "Option::is_none")]
    notehead: Option<NoteheadShape>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
struct KitComponentVendorExt {
    #[serde(skip_serializing_if = "Option::is_none")]
    viritura: Option<KitComponentVirituraExt>,
}

/// A single drum/percussion instrument on a staff (MNX `kit-component`).
/// The component ID is the key in the `Part.kit` HashMap — not a field here.
#[derive(Debug, Clone, PartialEq)]
pub struct KitComponent {
    pub name: Option<String>,
    pub sound: Option<String>,
    pub staff_position: i32,
    /// Viritura vendor extension `_x.viritura.notehead`.
    pub notehead: Option<NoteheadShape>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KitComponentRaw {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sound: Option<String>,
    staff_position: i32,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_x")]
    vendor_ext: Option<KitComponentVendorExt>,
}

impl Serialize for KitComponent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let vendor_ext = self.notehead.map(|nh| KitComponentVendorExt {
            viritura: Some(KitComponentVirituraExt { notehead: Some(nh) }),
        });
        let raw = KitComponentRaw {
            name: self.name.clone(),
            sound: self.sound.clone(),
            staff_position: self.staff_position,
            vendor_ext,
        };
        raw.serialize(serializer)
    }
}

// KitComponent: model-internal type. Construction goes through
// `promote::kit::promote_kit_component`. See `docs/spec/data-model-pipeline.md`.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_kit_component_notehead() {
        let c = KitComponent {
            name: Some("Kick".into()),
            sound: Some("snd-kick".into()),
            staff_position: -4,
            notehead: Some(NoteheadShape::Diamond),
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains(r#""_x":{"viritura":{"notehead":"diamond"}}"#));
    }

    #[test]
    fn parse_sound() {
        let json = r#"{"midiNumber":35,"name":"Bass Drum 1"}"#;
        let s: Sound = serde_json::from_str(json).unwrap();
        assert_eq!(s.midi_number, Some(35));
        assert_eq!(s.name.as_deref(), Some("Bass Drum 1"));
    }
}

use super::{Caesura, Duration, Fermata};
use serde::{Deserialize, Serialize};

/// Visual duration for a full-measure rest (MNX fullMeasure).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FullMeasure {
    /// Stable identifier of the rest, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// The visual duration to display (e.g., whole rest).
    #[serde(rename = "visualDuration")]
    pub visual_duration: Duration,
    /// Explicit staff position override (MNX staffPosition).
    /// 0 = middle line, positive = up, negative = down.
    #[serde(skip_serializing_if = "Option::is_none", rename = "staffPosition")]
    pub staff_position: Option<i32>,
    /// Fermata attached to this meter-independent bar rest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fermata: Option<Fermata>,
    /// A local caesura at the end of the measure.
    #[serde(
        rename = "_x",
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_full_measure_caesura",
        deserialize_with = "deserialize_full_measure_caesura"
    )]
    pub caesura: Option<Caesura>,
}

fn serialize_full_measure_caesura<S>(
    caesura: &Option<Caesura>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    #[derive(Serialize)]
    struct Extensions<'a> {
        viritura: Vendor<'a>,
    }
    #[derive(Serialize)]
    struct Vendor<'a> {
        caesura: &'a Option<Caesura>,
    }
    Extensions {
        viritura: Vendor { caesura },
    }
    .serialize(serializer)
}

fn deserialize_full_measure_caesura<'de, D>(deserializer: D) -> Result<Option<Caesura>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct Extensions {
        viritura: Option<Vendor>,
    }
    #[derive(Deserialize)]
    struct Vendor {
        caesura: Option<Caesura>,
    }
    Ok(Extensions::deserialize(deserializer)?
        .viritura
        .and_then(|vendor| vendor.caesura))
}

use serde::{Deserialize, Serialize};

pub type SlideInType = crate::raw::SlideIntoNoteType;
pub type SlideOutType = crate::raw::SlideOutOfNoteType;

/// MNX slide-in annotation for a single note.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlideInMarking {
    #[serde(rename = "type")]
    pub type_: SlideInType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "_c", skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(rename = "_x", skip_serializing_if = "Option::is_none")]
    pub vendor_extensions: Option<serde_json::Value>,
}

/// MNX slide-out annotation for a single note.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlideOutMarking {
    #[serde(rename = "type")]
    pub type_: SlideOutType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "_c", skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(rename = "_x", skip_serializing_if = "Option::is_none")]
    pub vendor_extensions: Option<serde_json::Value>,
}

/// Note-scoped MNX markings. They are intentionally distinct from event
/// articulations so chord members can carry independent markings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteMarkings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "_c", skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(rename = "_x", skip_serializing_if = "Option::is_none")]
    pub vendor_extensions: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_in: Option<SlideInMarking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_out: Option<SlideOutMarking>,
}

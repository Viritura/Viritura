use serde::{Deserialize, Serialize};

/// Repeat-start marker on a global measure (MNX `repeatStart`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepeatStart {
    /// Number of times to play the repeated section (omit for default of 2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub times: Option<u32>,
}

/// Repeat-end marker on a global measure (MNX `repeatEnd`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepeatEnd {
    /// Number of times to play the repeated section (omit for default of 2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub times: Option<u32>,
}

/// Volta bracket / alternate ending on a global measure (MNX `ending`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ending {
    /// Number of measures this ending spans.
    pub duration: u32,
    /// Which repeat passes this ending applies to (e.g., [1], [2], [1, 3]).
    pub numbers: Vec<u32>,
    /// If true, the ending is "open" (no right hook). Default false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open: Option<bool>,
    /// Optional rendering color (MNX `color`, e.g. "#ff0000").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

use serde::{Deserialize, Serialize};

/// Direction of a beam hook (beamlet) — MNX leaf enum aliased from codegen.
/// `Auto` lets the engraver choose based on rhythmic context (per MNX spec).
pub use crate::raw::BeamHookDirection;

/// A beam group connecting two or more events (MNX beam object).
///
/// MNX beams are recursive: a top-level beam defines the primary beam
/// (level 1), and inner `beams` define sub-beams at higher levels.
/// Inner beams with a `direction` field are beamlets (partial beams).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Beam {
    /// Event IDs included in this beam group.
    pub events: Vec<String>,
    /// Inner beams (sub-beams at higher levels).
    #[serde(default)]
    pub beams: Vec<Beam>,
    /// Hook direction — present when this beam is a beamlet.
    #[serde(default)]
    pub direction: Option<BeamHookDirection>,
}

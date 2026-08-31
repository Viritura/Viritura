//! MNX JSON parser — promote MNX JSON into the [`Score`] model.
//!
//! Two entry points:
//!
//! - [`parse_mnx`] / [`parse_mnx_bytes`] — lenient. The JSON is walked by
//!   [`crate::promote::root::promote_root`], which dispatches typify's
//!   broken anyOf-union content lists by peeking at discriminant fields
//!   and produces the engine's [`Score`] model. Anything the walker
//!   tolerates (missing optional fields, unknown extras) flows through.
//! - [`parse_mnx_strict`] / [`parse_mnx_strict_value`] — strict. The input
//!   is first validated against the embedded MNX JSON Schema via
//!   [`crate::validator::assert_raw_score`], then handed to the walker. A
//!   failure on either leg surfaces a [`ParseMnxStrictError`] that
//!   distinguishes "didn't match the spec" from "matched the spec but the
//!   engine model can't represent it".
//!
//! `model::*` deliberately has no `Deserialize` impls; the only way to
//! construct a [`Score`] from JSON is through this module. See
//! `docs/spec/data-model-pipeline.md` for the design.

use serde_json::Value;

use crate::model::Score;
use crate::promote::root::promote_root;
use crate::promote::PromoteError;
use crate::validator::{assert_raw_score, RawScoreValidationFailure};

/// Errors produced by the lenient parse path.
#[derive(Debug)]
pub enum ParseMnxError {
    /// The bytes are not valid JSON.
    Json(serde_json::Error),
    /// The JSON parsed but the engine model could not represent it.
    Promote(PromoteError),
}

impl std::fmt::Display for ParseMnxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Json(e) => write!(f, "MNX JSON parse failed: {e}"),
            Self::Promote(e) => write!(f, "MNX promote failed: {e:?}"),
        }
    }
}

impl std::error::Error for ParseMnxError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(e) => Some(e),
            Self::Promote(_) => None,
        }
    }
}

impl From<serde_json::Error> for ParseMnxError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<PromoteError> for ParseMnxError {
    fn from(value: PromoteError) -> Self {
        Self::Promote(value)
    }
}

/// Parse an MNX JSON string into a [`Score`] via the promote walker.
///
/// Lenient: no schema validation. Use [`parse_mnx_strict`] when you want
/// the input gated by the MNX schema.
pub fn parse_mnx(json: &str) -> Result<Score, ParseMnxError> {
    let value: Value = serde_json::from_str(json)?;
    Ok(promote_root(value)?)
}

/// Parse MNX JSON from bytes. Lenient; see [`parse_mnx`].
pub fn parse_mnx_bytes(bytes: &[u8]) -> Result<Score, ParseMnxError> {
    let value: Value = serde_json::from_slice(bytes)?;
    Ok(promote_root(value)?)
}

/// Errors produced by the strict parse path.
///
/// Distinguishes the failure modes so callers can present meaningful
/// diagnostics:
///
/// - [`ParseMnxStrictError::Validation`] — the JSON does not conform to
///   the MNX schema. Carries every validation error.
/// - [`ParseMnxStrictError::Deserialize`] — the JSON validated against
///   the schema but serde couldn't decode it into [`crate::raw::Root`].
/// - [`ParseMnxStrictError::Promote`] — raw types decoded successfully
///   but the engine model can't represent something in the score.
#[derive(Debug)]
pub enum ParseMnxStrictError {
    /// The JSON failed schema validation.
    Validation(RawScoreValidationFailure),
    /// The JSON validated but couldn't be decoded into the raw types.
    Deserialize(serde_json::Error),
    /// The raw types decoded but the engine model can't represent them.
    Promote(PromoteError),
}

impl std::fmt::Display for ParseMnxStrictError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(e) => write!(f, "{e}"),
            Self::Deserialize(e) => {
                write!(f, "MNX deserialise failed after schema validation: {e}")
            }
            Self::Promote(e) => write!(f, "MNX promote failed: {e:?}"),
        }
    }
}

impl std::error::Error for ParseMnxStrictError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Validation(e) => Some(e),
            Self::Deserialize(e) => Some(e),
            Self::Promote(_) => None,
        }
    }
}

impl From<RawScoreValidationFailure> for ParseMnxStrictError {
    fn from(value: RawScoreValidationFailure) -> Self {
        Self::Validation(value)
    }
}

impl From<serde_json::Error> for ParseMnxStrictError {
    fn from(value: serde_json::Error) -> Self {
        Self::Deserialize(value)
    }
}

impl From<PromoteError> for ParseMnxStrictError {
    fn from(value: PromoteError) -> Self {
        Self::Promote(value)
    }
}

/// Strict parse: validate against the MNX schema, then deserialise into
/// [`Score`].
///
/// Rust mirror of TypeScript `promoteUnknown` — the explicit
/// "validate → narrow → promote" pipeline. Use this on document boundaries
/// (file load, network payload, etc.) where you want to reject malformed
/// MNX up front rather than relying on serde's best-effort decoding.
///
/// # Errors
///
/// Returns [`ParseMnxStrictError::Validation`] when the JSON does not
/// conform to the MNX schema; returns [`ParseMnxStrictError::Deserialize`]
/// in the rare case the schema is looser than the engine's [`Score`] model.
pub fn parse_mnx_strict(json: &str) -> Result<Score, ParseMnxStrictError> {
    let value: Value = serde_json::from_str(json)?;
    parse_mnx_strict_value(&value)
}

/// Strict parse from a pre-parsed [`Value`]. See [`parse_mnx_strict`].
///
/// # Errors
///
/// Same as [`parse_mnx_strict`].
pub fn parse_mnx_strict_value(value: &Value) -> Result<Score, ParseMnxStrictError> {
    let _raw = assert_raw_score(value)?;
    let score = promote_root(value.clone())?;
    Ok(score)
}

#[cfg(test)]
mod tests;

use super::{vendor_ext::read_viritura_ext, PromoteError};
use crate::model::{GlobalFermata, RhythmicPosition};
use crate::{raw, raw_viritura};
use std::collections::HashSet;

pub(super) fn extract_fermatas(
    extensions: Option<&raw::VendorExtensions>,
) -> Result<Option<Vec<GlobalFermata>>, PromoteError> {
    let Some(value) = read_viritura_ext(extensions).and_then(|vendor| vendor.get("fermatas"))
    else {
        return Ok(None);
    };
    let raw: Vec<raw_viritura::GlobalFermata> = serde_json::from_value(value.clone())
        .map_err(|error| PromoteError::InvalidGlobalFermata(error.to_string()))?;
    let mut ids = HashSet::new();
    let fermatas = raw
        .into_iter()
        .map(|fermata| {
            let id = String::from(fermata.id);
            let multiplier = fermata.multiplier.unwrap_or(2.0);
            if !multiplier.is_finite() || multiplier < 1.0 {
                return Err(PromoteError::InvalidGlobalFermata(
                    "multiplier must be finite and at least 1".into(),
                ));
            }
            if !ids.insert(id.clone()) {
                return Err(PromoteError::InvalidGlobalFermata(format!(
                    "duplicate id '{id}'"
                )));
            }
            let [num, den] = fermata.position.fraction;
            let fraction = match (u32::try_from(num), u32::try_from(den)) {
                (Ok(num), Ok(den)) if den > 0 => (num, den),
                _ => {
                    return Err(PromoteError::InvalidGlobalFermata(
                        "position requires a nonnegative numerator and positive denominator".into(),
                    ))
                }
            };
            Ok(GlobalFermata {
                id,
                position: RhythmicPosition { fraction },
                multiplier,
                click_behavior: fermata.click_behavior,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(fermatas))
}

//! Shared helpers for reading MNX vendor extensions out of raw types.

use crate::raw;

/// Borrow the `viritura` vendor dict from a raw `_x` extensions field.
///
/// Returns `None` if `_x` is absent, doesn't contain a `viritura` key, or
/// the value is not an object. The `viritura` key is the engine's reserved
/// namespace under MNX's open `_x` vendor-extensions object.
pub(crate) fn read_viritura_ext(
    x: Option<&raw::VendorExtensions>,
) -> Option<&serde_json::Map<String, serde_json::Value>> {
    let ve = x?;
    // VendorExtensions wraps HashMap<VendorExtensionsKey, VendorDict>; the
    // key type doesn't impl Borrow<str>, so iterate.
    ve.0.iter()
        .find(|(k, _)| k.as_str() == "viritura")
        .map(|(_, v)| &v.0)
}

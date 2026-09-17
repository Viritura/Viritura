use std::collections::HashSet;

use super::LuaMapperError;

/// Output voices share one namespace for the mapper's lifetime, including keyswitches.
/// Allocate before constructing the on/off pair: time sorting cannot recover voice pairing
/// from score IDs reused by repeats or overlapping Lua layers.
#[derive(Default)]
pub(super) struct OutputNoteIds {
    used: HashSet<String>,
    next_generated: u64,
}

impl OutputNoteIds {
    pub(super) fn allocate(&mut self, requested: Option<String>) -> Result<String, mlua::Error> {
        if let Some(id) = requested.filter(|id| !id.is_empty()) {
            if self.used.insert(id.clone()) {
                return Ok(id);
            }
        }

        loop {
            let next = self.next_generated;
            self.next_generated = next.checked_add(1).ok_or_else(|| {
                mlua::Error::external(LuaMapperError::Contract(
                    "generated note id counter overflowed".to_owned(),
                ))
            })?;
            let id = format!("generated-note-{next}");
            if self.used.insert(id.clone()) {
                return Ok(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::OutputNoteIds;

    #[test]
    fn generated_ids_skip_explicit_reservations() {
        let mut ids = OutputNoteIds::default();
        for index in 0..3 {
            let id = format!("generated-note-{index}");
            assert_eq!(ids.allocate(Some(id.clone())).unwrap(), id);
        }
        assert_eq!(ids.allocate(None).unwrap(), "generated-note-3");
        assert_eq!(
            ids.allocate(Some("generated-note-3".to_owned())).unwrap(),
            "generated-note-4"
        );
    }

    #[test]
    fn exhausted_counter_errors_without_wrapping_or_reusing_an_id() {
        let mut ids = OutputNoteIds {
            next_generated: u64::MAX - 1,
            ..OutputNoteIds::default()
        };
        let last = ids.allocate(None).unwrap();
        assert_eq!(last, format!("generated-note-{}", u64::MAX - 1));
        for requested in [None, Some(last), Some(String::new())] {
            let error = ids.allocate(requested).unwrap_err();
            assert!(error.to_string().contains("note id counter overflowed"));
            assert_eq!(ids.next_generated, u64::MAX);
            assert_eq!(ids.used.len(), 1);
        }
    }
}

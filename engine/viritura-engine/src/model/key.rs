use serde::Serialize;

/// Key signature (MNX-aligned).
///
/// Model-internal type — construction goes through
/// `promote::key::promote_key`. See `docs/spec/data-model-pipeline.md`.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct KeySignature {
    /// Circle of fifths: positive = sharps, negative = flats
    pub fifths: i32,
    /// Optional rendering color (MNX `color`, e.g. "#ff0000").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// When true, key stays at 0 fifths even when transposing instruments
    /// switch to written pitch mode. Stored as `_x.viritura.atonal` in MNX.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub atonal: Option<bool>,
}

impl KeySignature {
    /// Whether this is an open/atonal key signature. An open signature shows no
    /// accidentals and applies no key alteration to notes, regardless of any
    /// `fifths` value left on the struct (e.g. a transposed value carried in
    /// from a written-pitch pipeline).
    pub fn is_open(&self) -> bool {
        self.atonal == Some(true)
    }

    /// Number of accidentals to display.
    pub fn accidental_count(&self) -> u32 {
        if self.is_open() {
            return 0;
        }
        self.fifths.unsigned_abs()
    }

    /// Whether this key has sharps (true) or flats (false).
    pub fn is_sharps(&self) -> bool {
        !self.is_open() && self.fifths > 0
    }

    /// Returns the alteration (in semitones) that the key signature
    /// applies to a given note step ("C", "D", "E", "F", "G", "A", "B").
    /// Returns 0 if the step is not altered by this key.
    ///
    /// Sharp keys (fifths > 0): F, C, G, D, A, E, B (order of sharps)
    /// Flat keys (fifths < 0):  B, E, A, D, G, C, F (order of flats)
    pub fn alteration_for_step(&self, step: &str) -> i32 {
        if self.is_open() {
            0
        } else if self.fifths > 0 {
            // Sharps: F C G D A E B
            let sharp_steps = ["F", "C", "G", "D", "A", "E", "B"];
            let count = self.fifths.min(7) as usize;
            for s in &sharp_steps[..count] {
                if *s == step {
                    return 1;
                }
            }
            0
        } else if self.fifths < 0 {
            // Flats: B E A D G C F
            let flat_steps = ["B", "E", "A", "D", "G", "C", "F"];
            let count = (-self.fifths).min(7) as usize;
            for s in &flat_steps[..count] {
                if *s == step {
                    return -1;
                }
            }
            0
        } else {
            0
        }
    }

    /// Number of cancellation naturals to draw when this key signature (the
    /// one previously in effect) is replaced by `new` at a key change.
    ///
    /// Standard engraving practice: a new key signature
    /// simply replaces the old one — the new accidentals are sufficient to
    /// imply the cancellation of any that are dropped, so courtesy naturals are
    /// *not* drawn between two sounding keys. Naturals are only used when the
    /// new key has no accidentals of its own (C major / A minor / open/atonal),
    /// where there would otherwise be nothing to signal the change. The older
    /// convention of cancelling on a sign flip or partial drop is intentionally
    /// not followed.
    pub fn cancellation_count(&self, new: &KeySignature) -> u32 {
        let prev_n = self.accidental_count();
        if prev_n == 0 {
            return 0;
        }
        if new.accidental_count() == 0 {
            // Change to C major / A minor / open / atonal: cancel the whole
            // outgoing set, since the new key shows no accidentals of its own.
            prev_n
        } else {
            // New key carries its own accidentals: it replaces the old one
            // directly, no courtesy naturals.
            0
        }
    }

    /// Transpose key signature by a chromatic interval.
    /// Maps half_steps to circle-of-fifths offset, applying keyFifthsFlipAt if needed.
    /// Enharmonic spelling follows the configured fifths flip threshold.
    pub fn transpose(&self, half_steps: i32, key_fifths_flip_at: Option<i32>) -> KeySignature {
        // Map chromatic half steps to fifths offset:
        // Each semitone up = +7 fifths mod 12, but we use a lookup for clarity.
        // Going up N semitones in circle of fifths: (N * 7) mod 12, adjusted to [-6..6].
        let fifths_delta = ((half_steps * 7) % 12 + 18) % 12 - 6;
        let mut new_fifths = self.fifths + fifths_delta;

        // Apply keyFifthsFlipAt: enharmonic respelling when fifths exceeds threshold
        if let Some(flip) = key_fifths_flip_at {
            if flip >= 0 && new_fifths >= flip {
                new_fifths -= 12;
            } else if flip < 0 && new_fifths <= flip {
                new_fifths += 12;
            }
        }

        // Clamp to reasonable range
        new_fifths = new_fifths.clamp(-7, 7);

        KeySignature {
            fifths: new_fifths,
            color: self.color.clone(),
            atonal: self.atonal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(fifths: i32) -> KeySignature {
        KeySignature {
            fifths,
            ..Default::default()
        }
    }

    #[test]
    fn test_cancellation_only_when_new_key_is_empty() {
        // Modern practice: naturals are drawn only when changing TO C major /
        // A minor / open. Between two sounding keys the new signature replaces
        // the old one with no courtesy naturals.
        // 2 sharps -> C major: cancel all 2.
        assert_eq!(key(2).cancellation_count(&key(0)), 2);
        // 3 flats -> C major: cancel all 3.
        assert_eq!(key(-3).cancellation_count(&key(0)), 3);
        // 4 sharps -> 2 sharps (drop two): no naturals.
        assert_eq!(key(4).cancellation_count(&key(2)), 0);
        // 2 sharps -> 3 flats (sign flip): no naturals.
        assert_eq!(key(2).cancellation_count(&key(-3)), 0);
        // 2 flats -> 4 sharps (sign flip): no naturals.
        assert_eq!(key(-2).cancellation_count(&key(4)), 0);
        // 1 sharp -> 3 sharps (adding): no naturals.
        assert_eq!(key(1).cancellation_count(&key(3)), 0);
        // C major -> anything: nothing to cancel.
        assert_eq!(key(0).cancellation_count(&key(3)), 0);
    }

    #[test]
    fn test_cancellation_to_atonal_cancels_whole_set() {
        let atonal = KeySignature {
            fifths: 2,
            atonal: Some(true),
            ..Default::default()
        };
        // Open/atonal key shows no accidentals, so the outgoing set is cancelled.
        assert_eq!(key(2).cancellation_count(&atonal), 2);
    }

    #[test]
    fn test_key_transpose_bb_clarinet() {
        // C major (0 fifths) for Bb clarinet (halfSteps=2) → D major (2 sharps)
        let c_major = KeySignature {
            fifths: 0,
            ..Default::default()
        };
        let transposed = c_major.transpose(2, None);
        assert_eq!(transposed.fifths, 2);
    }

    #[test]
    fn test_key_transpose_f_horn() {
        // C major for F horn (halfSteps=7) → G major (1 sharp)
        let c_major = KeySignature {
            fifths: 0,
            ..Default::default()
        };
        let transposed = c_major.transpose(7, None);
        assert_eq!(transposed.fifths, 1);
    }

    #[test]
    fn test_key_transpose_flat_key() {
        // Eb major (-3 fifths) for Bb clarinet (halfSteps=2) → F major (-1 flat)
        let eb_major = KeySignature {
            fifths: -3,
            ..Default::default()
        };
        let transposed = eb_major.transpose(2, None);
        assert_eq!(transposed.fifths, -1);
    }

    #[test]
    fn test_key_transpose_with_flip() {
        // B major (5 sharps) for Bb clarinet → 7 sharps before flip, keyFifthsFlipAt=7
        // flips to 7-12 = -5 → Db major (5 flats)
        let b_major = KeySignature {
            fifths: 5,
            ..Default::default()
        };
        let transposed = b_major.transpose(2, Some(7));
        assert_eq!(transposed.fifths, -5);
    }

    #[test]
    fn test_key_transpose_clamp() {
        // Extreme case that would exceed 7 → clamped
        let key = KeySignature {
            fifths: 6,
            ..Default::default()
        };
        let transposed = key.transpose(5, None);
        assert!(transposed.fifths >= -7 && transposed.fifths <= 7);
    }
}

use serde::{Deserialize, Serialize};

/// A musical pitch (MNX-aligned).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Pitch {
    /// Note step: C, D, E, F, G, A, B
    pub step: String,
    /// Octave in scientific pitch notation (C4 = middle C)
    pub octave: i32,
    /// Chromatic alteration in semitones (1 = sharp, -1 = flat)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alter: Option<i32>,
}

impl Pitch {
    /// Compute the diatonic position (C0=0, D0=1, ..., B0=6, C1=7, ...).
    pub fn diatonic_position(&self) -> i32 {
        let step_pos = match self.step.as_str() {
            "C" => 0,
            "D" => 1,
            "E" => 2,
            "F" => 3,
            "G" => 4,
            "A" => 5,
            "B" => 6,
            _ => 0,
        };
        step_pos + self.octave * 7
    }

    /// Compute MIDI note number.
    pub fn to_midi(&self) -> i32 {
        let step_semitones = match self.step.as_str() {
            "C" => 0,
            "D" => 2,
            "E" => 4,
            "F" => 5,
            "G" => 7,
            "A" => 9,
            "B" => 11,
            _ => 0,
        };
        (self.octave + 1) * 12 + step_semitones + self.alter.unwrap_or(0)
    }

    /// Transpose this pitch by a diatonic staff distance and chromatic half steps.
    /// Returns a new Pitch with the transposed step, octave, and alteration.
    /// Convention (MNX): sounding + interval = written.
    ///
    /// The diatonic component selects the written staff position; the
    /// chromatic component then determines the alteration needed at that
    /// position.
    pub fn transpose(&self, staff_distance: i32, half_steps: i32, diatonic_delta: i32) -> Pitch {
        let steps = ["C", "D", "E", "F", "G", "A", "B"];
        let step_semitones = [0, 2, 4, 5, 7, 9, 11];

        let cur_step_idx = match self.step.as_str() {
            "C" => 0,
            "D" => 1,
            "E" => 2,
            "F" => 3,
            "G" => 4,
            "A" => 5,
            "B" => 6,
            _ => 0,
        };
        let cur_semitone = step_semitones[cur_step_idx] + self.alter.unwrap_or(0);

        // Apply diatonic transposition + per-note delta
        let total_diatonic = staff_distance + diatonic_delta;
        let new_diatonic = self.diatonic_position() + total_diatonic;
        let new_octave = new_diatonic.div_euclid(7);
        let new_step_idx = new_diatonic.rem_euclid(7) as usize;

        // Compute expected chromatic position from the interval
        let target_midi = (self.octave + 1) * 12 + cur_semitone + half_steps;
        let natural_midi = (new_octave + 1) * 12 + step_semitones[new_step_idx];
        let new_alter = target_midi - natural_midi;

        Pitch {
            step: steps[new_step_idx].to_string(),
            octave: new_octave,
            alter: if new_alter != 0 {
                Some(new_alter)
            } else {
                None
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diatonic_position() {
        let c4 = Pitch {
            step: "C".into(),
            octave: 4,
            alter: None,
        };
        assert_eq!(c4.diatonic_position(), 28);

        let g4 = Pitch {
            step: "G".into(),
            octave: 4,
            alter: None,
        };
        assert_eq!(g4.diatonic_position(), 32);
    }

    #[test]
    fn test_midi() {
        let c4 = Pitch {
            step: "C".into(),
            octave: 4,
            alter: None,
        };
        assert_eq!(c4.to_midi(), 60);

        let a4 = Pitch {
            step: "A".into(),
            octave: 4,
            alter: None,
        };
        assert_eq!(a4.to_midi(), 69);
    }

    #[test]
    fn test_transpose_bb_clarinet() {
        // Bb clarinet: sounding C4 → written D4 (staffDistance=1, halfSteps=2)
        let c4 = Pitch {
            step: "C".into(),
            octave: 4,
            alter: None,
        };
        let written = c4.transpose(1, 2, 0);
        assert_eq!(written.step, "D");
        assert_eq!(written.octave, 4);
        assert_eq!(written.alter, None);
    }

    #[test]
    fn test_transpose_f_horn() {
        // F horn: sounding C4 → written G4 (staffDistance=4, halfSteps=7)
        let c4 = Pitch {
            step: "C".into(),
            octave: 4,
            alter: None,
        };
        let written = c4.transpose(4, 7, 0);
        assert_eq!(written.step, "G");
        assert_eq!(written.octave, 4);
        assert_eq!(written.alter, None);
    }

    #[test]
    fn test_transpose_piccolo() {
        // Piccolo: sounding C5 → written C4 (staffDistance=-7, halfSteps=-12)
        let c5 = Pitch {
            step: "C".into(),
            octave: 5,
            alter: None,
        };
        let written = c5.transpose(-7, -12, 0);
        assert_eq!(written.step, "C");
        assert_eq!(written.octave, 4);
        assert_eq!(written.alter, None);
    }

    #[test]
    fn test_transpose_with_diatonic_delta() {
        // Transposition that results in enharmonic respelling
        // Sounding Bb3 in Bb clarinet: normally → C4, but with diatonicDelta=-1 → B3
        let bb3 = Pitch {
            step: "B".into(),
            octave: 3,
            alter: Some(-1),
        };
        let written = bb3.transpose(1, 2, -1);
        // Without delta: B3+1 diatonic = C4, C4 midi=60, Bb3 midi=58+2=60 → C4 natural
        // With delta -1: one diatonic step lower → B3, midi 60 → B3 natural midi=59, alter=1
        assert_eq!(written.step, "B");
        assert_eq!(written.octave, 3);
    }
}

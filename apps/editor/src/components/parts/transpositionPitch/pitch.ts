const PITCH_LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
export interface SoundingPitch {
  letter: (typeof PITCH_LETTERS)[number];
  accidental: number;
  octave: number;
}

const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** MNX intervals run from sounding to written; anchor their inverse at written C4. */
export function soundingPitchFor(halfSteps: number, staffDistance: number): SoundingPitch {
  const position = 28 - staffDistance;
  const octave = Math.floor(position / 7);
  const letterIndex = ((position % 7) + 7) % 7;
  const natural = (octave + 1) * 12 + NATURAL_SEMITONES[letterIndex]!;
  return { letter: PITCH_LETTERS[letterIndex]!, accidental: 60 - halfSteps - natural, octave };
}

export function intervalForSoundingPitch(pitch: SoundingPitch) {
  const letterIndex = PITCH_LETTERS.indexOf(pitch.letter);
  return {
    halfSteps: 60 - ((pitch.octave + 1) * 12 + NATURAL_SEMITONES[letterIndex]! + pitch.accidental),
    staffDistance: 28 - (pitch.octave * 7 + letterIndex),
  };
}

export function pitchSpelling(pitch: Pick<SoundingPitch, "letter" | "accidental">): string {
  const { letter, accidental } = pitch;
  if (accidental === 0) return letter;
  if (Math.abs(accidental) > 4) {
    return `${letter} (${Math.abs(accidental)} ${accidental > 0 ? "sharps" : "flats"})`;
  }
  return letter + (accidental > 0 ? "♯" : "♭").repeat(Math.abs(accidental));
}

export function soundingPitchLabel(halfSteps: number, staffDistance: number): string {
  const pitch = soundingPitchFor(halfSteps, staffDistance);
  return `${pitchSpelling(pitch)}${pitch.octave}`;
}

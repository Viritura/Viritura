export class MidiChordCapture {
  private readonly heldCounts = new Map<number, number>();
  private readonly pendingNotes = new Set<number>();

  noteOn(midiNote: number): void {
    this.heldCounts.set(midiNote, (this.heldCounts.get(midiNote) ?? 0) + 1);
    this.pendingNotes.add(midiNote);
  }

  noteOff(midiNote: number): readonly number[] | null {
    const heldCount = this.heldCounts.get(midiNote);
    if (heldCount === undefined) return null;
    if (heldCount > 1) {
      this.heldCounts.set(midiNote, heldCount - 1);
      return null;
    }

    this.heldCounts.delete(midiNote);
    if (this.heldCounts.size > 0) return null;
    const chord = [...this.pendingNotes].sort((a, b) => a - b);
    this.pendingNotes.clear();
    return chord;
  }

  reset(): void {
    this.heldCounts.clear();
    this.pendingNotes.clear();
  }
}

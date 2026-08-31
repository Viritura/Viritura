import { useEffect, useState } from "react";

const DEMO_INTERVAL_MS = 900;

interface DemoSound {
  readonly id: string;
  readonly name: string;
  readonly notehead: string;
  readonly midiKey: number;
}

const DEMO_SOUNDS: readonly DemoSound[] = [
  { id: "crash", name: "Crash Cymbal", notehead: "×", midiKey: 49 },
  { id: "hihat", name: "Hi-Hat Closed", notehead: "×", midiKey: 42 },
  { id: "tom-high", name: "High Tom", notehead: "●", midiKey: 50 },
  { id: "snare", name: "Snare", notehead: "●", midiKey: 38 },
  { id: "tom-mid", name: "Mid Tom", notehead: "●", midiKey: 48 },
  { id: "kick", name: "Kick", notehead: "●", midiKey: 36 },
];

export default function PercussionPaletteSnippet() {
  const [userInteracted, setUserInteracted] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [selectedSound, setSelectedSound] = useState("snare");

  useEffect(() => {
    if (userInteracted) return;
    const timer = window.setInterval(() => setDemoStep((step) => (step + 1) % 3), DEMO_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [userInteracted]);

  function stopDemo() {
    setUserInteracted(true);
  }

  return (
    <div className="docs-embed-stage docs-embed-stage--palette" onFocusCapture={stopDemo} onPointerDown={stopDemo}>
      {!userInteracted && (
        <div className={`docs-demo-cursor docs-demo-cursor--step-${demoStep}`} aria-hidden="true">
          <span />
        </div>
      )}
      <section className="docs-percussion-workbench" aria-label="Percussion mapping example">
        <header>
          <div>
            <strong>Drum kit</strong>
            <span>Percussion</span>
          </div>
          <label>
            Preset
            <select defaultValue="full">
              <option value="full">Full Drum Kit</option>
              <option value="orchestral">Orchestral Percussion</option>
              <option value="minimal">Minimal</option>
            </select>
          </label>
        </header>
        <div className="docs-percussion-list">
          {DEMO_SOUNDS.map((sound) => (
            <button
              key={sound.id}
              type="button"
              className={selectedSound === sound.id ? "is-selected" : undefined}
              onClick={() => setSelectedSound(sound.id)}
            >
              <span className="docs-percussion-notehead" aria-hidden="true">
                {sound.notehead}
              </span>
              <span>{sound.name}</span>
              <small>MIDI {sound.midiKey}</small>
            </button>
          ))}
        </div>
      </section>
      <p className="docs-embed-caption">
        {userInteracted ? "Try mapping a percussion sound yourself." : "Watch the palette, then choose a sound."}
      </p>
    </div>
  );
}

import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceShell, type WorkspaceInsets } from "./WorkspaceShell";
import { Panel } from "../Panel/Panel";
import { Tabs, type TabDef } from "../Tabs/Tabs";
import { ListRow } from "../ListRow/ListRow";
import { Section } from "../Section/Section";
import { FormField, FormInput } from "../FormField/FormField";
import { Select } from "../Select/Select";

const DURATION_OPTIONS = [
  { value: "whole", label: "Whole" },
  { value: "half", label: "Half" },
  { value: "quarter", label: "Quarter" },
  { value: "eighth", label: "Eighth" },
  { value: "16th", label: "Sixteenth" },
  { value: "32nd", label: "Thirty-second" },
];
const STEM_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const BEAM_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "begin", label: "Begin" },
  { value: "continue", label: "Continue" },
  { value: "end", label: "End" },
  { value: "break", label: "Break" },
];
import { Slider } from "../Slider/Slider";
import { Button } from "../Button/Button";
import { Checkbox } from "../Checkbox/Checkbox";
import { Separator } from "../Separator/Separator";

const meta: Meta<typeof WorkspaceShell> = {
  title: "UI Components/WorkspaceShell",
  component: WorkspaceShell,
  parameters: {
    layout: "fullscreen",
    // WorkspaceShell paints its own mesh background — skip the storybook
    // glass decorator that wraps other components.
    surface: "canvas",
  },
};

export default meta;
type Story = StoryObj<typeof WorkspaceShell>;

// Fill a known-size frame so the absolute-positioned shell has bounds.
const SHELL_FRAME_STYLE: CSSProperties = { display: "flex", width: "100vw", height: "100vh" };

const CANVAS_PLACEHOLDER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "monospace",
  fontSize: 13,
  color: "rgba(60, 60, 80, 0.7)",
  textAlign: "center",
  padding: 24,
};

const STATUS_PILL_STYLE: CSSProperties = {
  background: "rgba(28, 30, 42, 0.92)",
  color: "rgba(255, 255, 255, 0.85)",
  borderRadius: 14,
  padding: "8px 18px",
  fontSize: 12,
  fontFamily: "monospace",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
};

const PLACEHOLDER_HEADING_STYLE: CSSProperties = { marginBottom: 8 };
const PLACEHOLDER_INSETS_STYLE: CSSProperties = { opacity: 0.6 };

function CanvasPlaceholder({ insets }: { insets: WorkspaceInsets }) {
  return (
    <div style={CANVAS_PLACEHOLDER_STYLE}>
      <div>
        <div style={PLACEHOLDER_HEADING_STYLE}>canvas placeholder</div>
        <div style={PLACEHOLDER_INSETS_STYLE}>
          safe area insets&nbsp;=&nbsp;{`{ left: ${insets.left}, right: ${insets.right} }`}
        </div>
      </div>
    </div>
  );
}

export const TwoPanels: Story = {
  render: () => {
    const [leftW, setLeftW] = useState(280);
    const [rightW, setRightW] = useState(320);
    const [leftOpen, setLeftOpen] = useState(true);
    return (
      <div style={SHELL_FRAME_STYLE}>
        <WorkspaceShell
          canvas={(insets) => <CanvasPlaceholder insets={insets} />}
          statusVisible
          statusBar={<div style={STATUS_PILL_STYLE}>workspace status pill</div>}
          showPanelHandle={!leftOpen}
          onTogglePanels={() => setLeftOpen(true)}
        >
          {leftOpen && (
            <Panel
              side="left"
              width={leftW}
              onResize={setLeftW}
              min={220}
              max={500}
              onCollapse={() => setLeftOpen(false)}
              title="Parts"
              subtitle="String Quartet in D · 24 measures"
              scrollBody
            >
              <PartsPanelBody />
            </Panel>
          )}
          <Panel
            side="right"
            width={rightW}
            onResize={setRightW}
            min={260}
            max={520}
            title="Inspector"
            subtitle="Quarter note · m. 4 · beat 1"
            scrollBody
          >
            <InspectorPanelBody />
          </Panel>
        </WorkspaceShell>
      </div>
    );
  },
};

export const StackedRightPanels: Story = {
  render: () => {
    const [leftW, setLeftW] = useState(260);
    const [rightW, setRightW] = useState(300);
    const [sourceW, setSourceW] = useState(360);
    const [aiW, setAiW] = useState(340);
    const [showSource, setShowSource] = useState(true);
    const [showAi, setShowAi] = useState(true);
    return (
      <div style={SHELL_FRAME_STYLE}>
        <WorkspaceShell
          canvas={(insets) => <CanvasPlaceholder insets={insets} />}
          statusVisible
          statusBar={<div style={STATUS_PILL_STYLE}>workspace status pill</div>}
        >
          <Panel
            side="left"
            width={leftW}
            onResize={setLeftW}
            title="Parts"
            subtitle="String Quartet in D"
            scrollBody
            min={220}
            max={500}
          >
            <PartsPanelBody />
          </Panel>
          <Panel
            side="right"
            width={rightW}
            onResize={setRightW}
            title="Inspector"
            subtitle="Quarter note · m. 4 · beat 1"
            scrollBody
            min={260}
            max={520}
          >
            <InspectorPanelBody />
          </Panel>
          {showSource && (
            <Panel
              side="right"
              width={sourceW}
              onResize={setSourceW}
              min={280}
              max={700}
              title="MNX Source"
              subtitle="JSON · read-only"
              onClose={() => setShowSource(false)}
              scrollBody
            >
              <SourcePanelBody />
            </Panel>
          )}
          {showAi && (
            <Panel
              side="right"
              width={aiW}
              onResize={setAiW}
              min={280}
              max={600}
              title="AI Assistant"
              subtitle="Claude · ready"
              onClose={() => setShowAi(false)}
              scrollBody
            >
              <AIPanelBody />
            </Panel>
          )}
        </WorkspaceShell>
      </div>
    );
  },
};

// ── Demo panel contents ─────────────────────────────────────────

const PARTS_TABS: TabDef[] = [
  { id: "parts", label: "Parts" },
  { id: "groups", label: "Groups" },
  { id: "mixer", label: "Mixer" },
];

const INSTRUMENTS: Array<{ id: string; name: string; staves: number; visible: boolean }> = [
  { id: "vln1", name: "Violin I", staves: 1, visible: true },
  { id: "vln2", name: "Violin II", staves: 1, visible: true },
  { id: "vla", name: "Viola", staves: 1, visible: true },
  { id: "vc", name: "Violoncello", staves: 1, visible: true },
  { id: "fl", name: "Flute", staves: 1, visible: true },
  { id: "ob", name: "Oboe", staves: 1, visible: true },
  { id: "cl", name: "Clarinet in B♭", staves: 1, visible: true },
  { id: "bsn", name: "Bassoon", staves: 1, visible: false },
  { id: "hn", name: "Horn in F", staves: 1, visible: true },
  { id: "tpt", name: "Trumpet in C", staves: 1, visible: true },
  { id: "tbn", name: "Trombone", staves: 1, visible: true },
  { id: "tba", name: "Tuba", staves: 1, visible: false },
  { id: "timp", name: "Timpani", staves: 1, visible: true },
  { id: "perc", name: "Percussion", staves: 2, visible: true },
  { id: "hrp", name: "Harp", staves: 2, visible: true },
  { id: "pno", name: "Piano", staves: 2, visible: true },
  { id: "sop", name: "Soprano", staves: 1, visible: false },
  { id: "alt", name: "Alto", staves: 1, visible: false },
  { id: "ten", name: "Tenor", staves: 1, visible: false },
  { id: "bas", name: "Bass", staves: 1, visible: false },
];

const PARTS_TABS_WRAP_STYLE: CSSProperties = { padding: "8px 4px 0", marginBottom: 8 };
const LIST_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--accent, #7a8fff)",
  display: "inline-block",
};
const DOT_DIM_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "rgba(120, 120, 140, 0.4)",
  display: "inline-block",
};
const TRAILING_STYLE: CSSProperties = { fontSize: 11, opacity: 0.6 };
const SECTION_STACK_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 14, paddingTop: 8 };
const FIELD_STACK_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const ROW_LABEL_STYLE: CSSProperties = { fontSize: 12, color: "var(--text-muted, #666)" };
const ROW_VALUE_STYLE: CSSProperties = {
  fontSize: 11,
  fontFamily: "monospace",
  opacity: 0.7,
  minWidth: 36,
  textAlign: "right",
};
const SLIDER_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const SLIDER_LABEL_STYLE: CSSProperties = { fontSize: 12, width: 64, color: "var(--text-muted, #666)" };
const ACTIONS_ROW_STYLE: CSSProperties = { display: "flex", gap: 8, paddingTop: 4 };
const PRE_STYLE: CSSProperties = {
  margin: 0,
  padding: 12,
  fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
  fontSize: 11,
  lineHeight: 1.55,
  color: "var(--text, #1a1a22)",
  background: "rgba(20, 20, 28, 0.04)",
  borderRadius: 10,
  whiteSpace: "pre",
  overflow: "auto",
};
const AI_MSG_STACK_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 };
const AI_BUBBLE_USER: CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "85%",
  padding: "8px 12px",
  borderRadius: 14,
  background: "var(--accent, #7a8fff)",
  color: "#fff",
  fontSize: 12.5,
  lineHeight: 1.45,
};
const AI_BUBBLE_AI: CSSProperties = {
  alignSelf: "flex-start",
  maxWidth: "90%",
  padding: "8px 12px",
  borderRadius: 14,
  background: "rgba(20, 20, 28, 0.06)",
  fontSize: 12.5,
  lineHeight: 1.45,
};
const AI_INPUT_WRAP_STYLE: CSSProperties = { display: "flex", gap: 8, paddingTop: 12 };
const AI_INPUT_STYLE: CSSProperties = { flex: 1 };

function PartsPanelBody() {
  const [activeId, setActiveId] = useState("vln1");
  return (
    <>
      <div style={PARTS_TABS_WRAP_STYLE}>
        <Tabs tabs={PARTS_TABS} defaultTab="parts" />
      </div>
      <div style={LIST_STYLE}>
        {INSTRUMENTS.map((inst) => (
          <ListRow
            key={inst.id}
            density="compact"
            selected={inst.id === activeId}
            onClick={() => setActiveId(inst.id)}
            leading={<span style={inst.visible ? DOT_STYLE : DOT_DIM_STYLE} />}
            trailing={<span style={TRAILING_STYLE}>{inst.staves}st</span>}
          >
            {inst.name}
          </ListRow>
        ))}
      </div>
    </>
  );
}

function InspectorPanelBody() {
  const [pitch, setPitch] = useState("C5");
  const [duration, setDuration] = useState("quarter");
  const [velocity, setVelocity] = useState(80);
  const [pan, setPan] = useState(0);
  const [tie, setTie] = useState(false);
  const [slur, setSlur] = useState(true);
  const [grace, setGrace] = useState(false);
  return (
    <div style={SECTION_STACK_STYLE}>
      <Section title="Note">
        <div style={FIELD_STACK_STYLE}>
          <FormField label="Pitch">
            <FormInput value={pitch} onChange={(e) => setPitch(e.target.value)} />
          </FormField>
          <FormField label="Duration">
            <Select value={duration} onValueChange={setDuration} options={DURATION_OPTIONS} />
          </FormField>
        </div>
      </Section>

      <Section title="Articulation">
        <div style={FIELD_STACK_STYLE}>
          <Checkbox checked={tie} onChange={(e) => setTie(e.target.checked)} label="Tie to next" />
          <Checkbox checked={slur} onChange={(e) => setSlur(e.target.checked)} label="Slur" />
          <Checkbox checked={grace} onChange={(e) => setGrace(e.target.checked)} label="Grace note" />
        </div>
      </Section>

      <Section title="Playback">
        <div style={FIELD_STACK_STYLE}>
          <div style={SLIDER_ROW_STYLE}>
            <span style={SLIDER_LABEL_STYLE}>Velocity</span>
            <Slider min={0} max={127} value={velocity} onChange={setVelocity} ariaLabel="Velocity" />
            <span style={ROW_VALUE_STYLE}>{velocity}</span>
          </div>
          <div style={SLIDER_ROW_STYLE}>
            <span style={SLIDER_LABEL_STYLE}>Pan</span>
            <Slider min={-100} max={100} value={pan} onChange={setPan} center={0} ariaLabel="Pan" />
            <span style={ROW_VALUE_STYLE}>{pan > 0 ? `R${pan}` : pan < 0 ? `L${-pan}` : "C"}</span>
          </div>
          <Separator />
          <div style={ROW_STYLE}>
            <span style={ROW_LABEL_STYLE}>Measure</span>
            <span style={ROW_VALUE_STYLE}>4 · beat 1</span>
          </div>
          <div style={ROW_STYLE}>
            <span style={ROW_LABEL_STYLE}>Tick</span>
            <span style={ROW_VALUE_STYLE}>1920</span>
          </div>
          <div style={ROW_STYLE}>
            <span style={ROW_LABEL_STYLE}>Channel</span>
            <span style={ROW_VALUE_STYLE}>1</span>
          </div>
        </div>
      </Section>

      <Section title="Layout">
        <div style={FIELD_STACK_STYLE}>
          <FormField label="Stem direction">
            <Select value="auto" onValueChange={() => {}} options={STEM_OPTIONS} />
          </FormField>
          <FormField label="Beam">
            <Select value="auto" onValueChange={() => {}} options={BEAM_OPTIONS} />
          </FormField>
        </div>
      </Section>

      <div style={ACTIONS_ROW_STYLE}>
        <Button variant="primary">Apply</Button>
        <Button variant="ghost">Reset</Button>
      </div>
    </div>
  );
}

const SOURCE_JSON = `{
  "mnx": { "version": 1 },
  "global": {
    "measures": [
      {
        "time": { "count": 4, "unit": 4 },
        "tempos": [{ "bpm": 120, "value": { "base": "quarter" } }]
      },
      { "barline": { "type": "regular" } },
      { "barline": { "type": "regular" } },
      { "barline": { "type": "final" } }
    ]
  },
  "parts": [
    {
      "id": "p1",
      "name": "Violin I",
      "staves": 1,
      "measures": [
        {
          "sequences": [
            {
              "content": [
                {
                  "type": "event",
                  "duration": { "base": "quarter" },
                  "notes": [{ "pitch": { "step": "C", "octave": 5 } }]
                },
                {
                  "type": "event",
                  "duration": { "base": "quarter" },
                  "notes": [{ "pitch": { "step": "D", "octave": 5 } }]
                },
                {
                  "type": "event",
                  "duration": { "base": "quarter" },
                  "notes": [{ "pitch": { "step": "E", "octave": 5 } }]
                },
                {
                  "type": "event",
                  "duration": { "base": "quarter" },
                  "notes": [{ "pitch": { "step": "F", "octave": 5 } }]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}`;

function SourcePanelBody() {
  return <pre style={PRE_STYLE}>{SOURCE_JSON}</pre>;
}

function AIPanelBody() {
  const [draft, setDraft] = useState("");
  return (
    <div style={AI_MSG_STACK_STYLE}>
      <div style={AI_BUBBLE_AI}>
        Hi! I&apos;m here to help with your score. Ask me to add a part, transpose a passage, or explain notation.
      </div>
      <div style={AI_BUBBLE_USER}>Add a clarinet doubling the violin I line, but down an octave.</div>
      <div style={AI_BUBBLE_AI}>
        I&apos;ll add a Clarinet in B♭ part that doubles Violin I at the octave below. Since the clarinet is a
        transposing instrument, the written pitch will be a major second above sounding.
      </div>
      <div style={AI_BUBBLE_AI}>Preview the change, or should I apply it directly?</div>
      <div style={AI_BUBBLE_USER}>Preview first.</div>
      <div style={AI_BUBBLE_AI}>
        Done — open the diff view on the canvas to compare. Let me know if you want to keep, tweak, or discard.
      </div>
      <div style={AI_INPUT_WRAP_STYLE}>
        <div style={AI_INPUT_STYLE}>
          <FormInput placeholder="Ask the assistant…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <Button variant="primary">Send</Button>
      </div>
    </div>
  );
}

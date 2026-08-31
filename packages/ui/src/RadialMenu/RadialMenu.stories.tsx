import React, { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RadialMenu, type RadialMenuItem } from "./RadialMenu";

const DEMO_WRAP_STYLE: CSSProperties = {
  width: "100%",
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
};
const DEMO_BUTTON_STYLE: CSSProperties = { padding: "8px 20px", fontSize: 14, cursor: "pointer" };
const DEMO_RESULT_STYLE: CSSProperties = { fontSize: 13, opacity: 0.7 };
const BRAVURA_INLINE_STYLE: CSSProperties = { fontFamily: "Bravura, system-ui", letterSpacing: 2 };

// ── Sample item sets (content-neutral) ──

const FRUIT_ITEMS: RadialMenuItem[] = [
  { id: "apple", icon: "🍎", label: "Apple" },
  { id: "banana", icon: "🍌", label: "Banana" },
  { id: "cherry", icon: "🍒", label: "Cherry" },
  { id: "grape", icon: "🍇", label: "Grape" },
  { id: "lemon", icon: "🍋", label: "Lemon" },
  { id: "peach", icon: "🍑", label: "Peach" },
];

const MANY_ITEMS: RadialMenuItem[] = [
  { id: "grinning", icon: "\u{1F600}", label: "Grinning" },
  { id: "beaming", icon: "\u{1F601}", label: "Beaming" },
  { id: "laughing", icon: "\u{1F602}", label: "Laughing" },
  { id: "smiley", icon: "\u{1F603}", label: "Smiley" },
  { id: "grin", icon: "\u{1F604}", label: "Grin" },
  { id: "sweat", icon: "\u{1F605}", label: "Sweat" },
  { id: "squinting", icon: "\u{1F606}", label: "Squinting" },
  { id: "innocent", icon: "\u{1F607}", label: "Innocent" },
  { id: "imp", icon: "\u{1F608}", label: "Imp" },
  { id: "wink", icon: "\u{1F609}", label: "Wink" },
  { id: "blush", icon: "\u{1F60A}", label: "Blush" },
  { id: "yum", icon: "\u{1F60B}", label: "Yum" },
];

// ── Interactive wrapper ──

function RadialMenuDemo(props: { items: RadialMenuItem[]; title?: string; maxItemsPerPage?: number }) {
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState({ x: 300, y: 300 });
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <div style={DEMO_WRAP_STYLE}>
      <button
        type="button"
        onClick={(e) => {
          setPos({ x: e.clientX, y: e.clientY });
          setOpen(true);
        }}
        style={DEMO_BUTTON_STYLE}
      >
        Click to open radial menu
      </button>
      {lastSelected && (
        <div style={DEMO_RESULT_STYLE}>
          Last selected: <strong>{lastSelected}</strong>
        </div>
      )}
      <RadialMenu
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(id) => {
          setLastSelected(id);
          setOpen(false);
        }}
        items={props.items}
        position={pos}
        title={props.title}
        maxItemsPerPage={props.maxItemsPerPage}
      />
    </div>
  );
}

// ── Meta ──

const meta: Meta<typeof RadialMenu> = {
  title: "UI Components/RadialMenu",
  component: RadialMenu,
  // RadialMenu is a Tier-3 floating selection wheel anchored to the
  // cursor over the score canvas. Carries its own surface.
  parameters: { layout: "fullscreen", surface: "canvas" },
};

export default meta;
type Story = StoryObj<typeof RadialMenu>;

// ── Stories ──

export const Default: Story = {
  render: () => <RadialMenuDemo items={FRUIT_ITEMS} title="Pick" />,
};

export const ManyItems: Story = {
  render: () => <RadialMenuDemo items={MANY_ITEMS} title="12 items" />,
};

export const Paginated: Story = {
  render: () => <RadialMenuDemo items={MANY_ITEMS} title="Paged" maxItemsPerPage={6} />,
};

export const NoTitle: Story = {
  render: () => <RadialMenuDemo items={FRUIT_ITEMS} />,
};

// ── Expression builder demo ──

const DYNAMICS: RadialMenuItem[] = [
  { id: "ppp", icon: "\uE52A", label: "Pianississimo", hint: "F1" },
  { id: "pp", icon: "\uE52B", label: "Pianissimo", hint: "F2" },
  { id: "p", icon: "\uE520", label: "Piano", hint: "F3" },
  { id: "mp", icon: "\uE52C", label: "Mezzo piano", hint: "F4" },
  { id: "mf", icon: "\uE52D", label: "Mezzo forte", hint: "F5" },
  { id: "f", icon: "\uE522", label: "Forte", hint: "F6" },
  { id: "ff", icon: "\uE52F", label: "Fortissimo", hint: "F7" },
  { id: "fff", icon: "\uE530", label: "Fortississimo", hint: "F8" },
];

/** Minimal expression parser for story demonstration */
function demoRenderExpression(input: string): React.ReactNode | null {
  if (!input.includes("<") && !input.includes(">")) return null;
  // Simple validation: only allow p, f, m, s, n, <, >
  if (!/^[pfmsnr<>z]+$/.test(input)) return null;
  const GLYPH: Record<string, string> = {
    p: "\uE520",
    f: "\uE522",
    pp: "\uE52B",
    ff: "\uE52F",
    mp: "\uE52C",
    mf: "\uE52D",
    ppp: "\uE52A",
    fff: "\uE530",
    sfz: "\uE539",
    fp: "\uE534",
  };
  const parts: string[] = [];
  let pos = 0;
  while (pos < input.length) {
    if (input[pos] === "<") {
      parts.push("\uE53E");
      pos++;
      continue;
    }
    if (input[pos] === ">") {
      parts.push("\uE53F");
      pos++;
      continue;
    }
    let matched = false;
    for (const tok of ["ppp", "pp", "fff", "ff", "sfz", "mp", "mf", "fp", "p", "f"]) {
      if (input.startsWith(tok, pos)) {
        parts.push(GLYPH[tok]!);
        pos += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return <span style={BRAVURA_INLINE_STYLE}>{parts.join("")}</span>;
}

function ExpressionDemo() {
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState({ x: 300, y: 300 });
  const [lastResult, setLastResult] = useState<string | null>(null);

  return (
    <div style={DEMO_WRAP_STYLE}>
      <button
        type="button"
        onClick={(e) => {
          setPos({ x: e.clientX, y: e.clientY });
          setOpen(true);
        }}
        style={DEMO_BUTTON_STYLE}
      >
        Open Dynamics (try typing p&lt;f or mf&gt;pp)
      </button>
      {lastResult && (
        <div style={DEMO_RESULT_STYLE}>
          Last result: <strong>{lastResult}</strong>
        </div>
      )}
      <RadialMenu
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(id) => {
          setLastResult(`item: ${id}`);
          setOpen(false);
        }}
        items={DYNAMICS}
        position={pos}
        title="Dyn."
        startAlign="start"
        renderExpression={demoRenderExpression}
        onSubmitExpression={(expr) => {
          setLastResult(`expression: ${expr}`);
          setOpen(false);
        }}
      />
    </div>
  );
}

export const ExpressionBuilder: Story = {
  render: () => <ExpressionDemo />,
};

export const ThreeItems: Story = {
  render: () => (
    <RadialMenuDemo
      items={[
        { id: "yes", icon: "✓", label: "Yes", hint: "Y" },
        { id: "no", icon: "✗", label: "No", hint: "N" },
        { id: "maybe", icon: "?", label: "Maybe", hint: "M" },
      ]}
      title="Choose"
    />
  ),
};

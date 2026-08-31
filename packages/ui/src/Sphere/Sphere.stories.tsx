import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { Sphere } from "./Sphere";

const SPHERE_DECORATOR_STYLE: CSSProperties = {
  width: 280,
  height: 220,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background:
    "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(var(--accent-rgb), 0.08), transparent 70%), var(--surface)",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border)",
};
const PALETTE_ROW_STYLE: CSSProperties = { display: "flex", gap: 28, alignItems: "center" };
const DRAG_BUTTON_STYLE: CSSProperties = {
  all: "unset",
  width: 120,
  height: 120,
  cursor: "grab",
  display: "grid",
  placeItems: "center",
};
const SIZE_ROW_STYLE: CSSProperties = { display: "flex", gap: 24, alignItems: "flex-end" };

const meta: Meta<typeof Sphere> = {
  title: "UI Components/Sphere",
  component: Sphere,
  parameters: {
    layout: "centered",
    // Sphere is a volumetric object material — demonstrated standalone
    // against the workspace, not as a panel inhabitant.
    surface: "canvas",
    docs: {
      description: {
        component:
          "Volumetric 'object' material — a glossy 3D sphere lit from the top-left. " +
          "Pass `color` (any CSS colour, including `var(--accent)`) and `size` (diameter in px). " +
          "Drive hover / drag elevation with `lift` (0..1); the sphere scales up, translates upward, " +
          "and the separate ground shadow widens and softens — all together over 160 ms.",
      },
    },
  },
  argTypes: {
    color: { control: "color" },
    size: { control: { type: "range", min: 16, max: 200, step: 4 } },
    lift: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
  },
  decorators: [
    (Story) => (
      <div style={SPHERE_DECORATOR_STYLE}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Sphere>;

export const Default: Story = {
  args: { color: "#83c8b3", size: 80, lift: 0 },
};

export const Lifted: Story = {
  args: { color: "#83c8b3", size: 80, lift: 1 },
};

export const Accent: Story = {
  args: { color: "var(--accent)", size: 80, lift: 0 },
};

export const Palette: Story = {
  name: "Color palette",
  render: () => (
    <div style={PALETTE_ROW_STYLE}>
      {[
        "#e07a4f", // woodwind
        "#f4c95d", // brass
        "#a370db", // percussion
        "#83c8b3", // strings
        "#5b9bd5", // ensemble
      ].map((c) => (
        <Sphere key={c} color={c} size={56} />
      ))}
    </div>
  ),
};

export const HoverInteractive: Story = {
  name: "Hover to lift",
  render: () => {
    const [hover, setHover] = useState(false);
    const [drag, setDrag] = useState(false);
    const lift = drag ? 1 : hover ? 0.5 : 0;
    return (
      <button
        type="button"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false);
          setDrag(false);
        }}
        onMouseDown={() => setDrag(true)}
        onMouseUp={() => setDrag(false)}
        style={DRAG_BUTTON_STYLE}
      >
        <Sphere color="#83c8b3" size={80} lift={lift} />
      </button>
    );
  },
};

export const SizeScale: Story = {
  name: "Size scale",
  render: () => (
    <div style={SIZE_ROW_STYLE}>
      {[24, 40, 64, 96, 140].map((s) => (
        <Sphere key={s} color="var(--accent)" size={s} />
      ))}
    </div>
  ),
};

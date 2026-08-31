import { useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { ListRow } from "./ListRow";

const STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, width: 260 };
const DOT_STYLE: CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#4a90d9",
};

const meta: Meta<typeof ListRow> = {
  title: "UI Components/ListRow",
  component: ListRow,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof ListRow>;

export const Comfortable: Story = {
  render: () => {
    const [selected, setSelected] = useState("violin");
    return (
      <div style={STACK}>
        <ListRow
          leading={<span style={DOT_STYLE} />}
          selected={selected === "violin"}
          onClick={() => setSelected("violin")}
        >
          Violin
        </ListRow>
        <ListRow
          leading={<span style={DOT_STYLE} />}
          selected={selected === "viola"}
          onClick={() => setSelected("viola")}
        >
          Viola
        </ListRow>
        <ListRow
          leading={<span style={DOT_STYLE} />}
          selected={selected === "cello"}
          onClick={() => setSelected("cello")}
        >
          Cello
        </ListRow>
      </div>
    );
  },
};

export const WithTrailing: Story = {
  render: () => (
    <div style={STACK}>
      <ListRow trailing={<Plus size={12} />}>Flute</ListRow>
      <ListRow trailing={<Plus size={12} />}>Oboe</ListRow>
      <ListRow trailing={<Plus size={12} />}>Clarinet</ListRow>
    </div>
  ),
};

export const Nested: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <div style={STACK}>
        <ListRow
          leading={open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          trailing="12"
          onClick={() => setOpen(!open)}
        >
          Strings
        </ListRow>
        {open && (
          <>
            <ListRow density="compact" indent trailing={<Plus size={10} />}>
              Violin I
            </ListRow>
            <ListRow density="compact" indent trailing={<Plus size={10} />}>
              Violin II
            </ListRow>
            <ListRow density="compact" indent trailing={<Plus size={10} />}>
              Viola
            </ListRow>
          </>
        )}
      </div>
    );
  },
};

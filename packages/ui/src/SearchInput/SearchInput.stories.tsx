import { useMemo, useState, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchInput } from "./SearchInput";
import { ListRow } from "../ListRow/ListRow";

const STACK: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, width: 300 };
const RESULTS: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const EMPTY: CSSProperties = { fontSize: "0.8125rem", opacity: 0.6, padding: "8px 4px", margin: 0 };

const INSTRUMENTS = ["Violin", "Viola", "Cello", "Flute", "Oboe", "Clarinet", "Trumpet", "Timpani"];

const meta: Meta<typeof SearchInput> = {
  title: "UI Components/SearchInput",
  component: SearchInput,
  parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof SearchInput>;

export const Default: Story = {
  render: () => {
    const [query, setQuery] = useState("");
    return (
      <div style={STACK}>
        <SearchInput value={query} onValueChange={setQuery} />
      </div>
    );
  },
};

export const Sizes: Story = {
  render: () => {
    const [md, setMd] = useState("reverb");
    const [sm, setSm] = useState("reverb");
    return (
      <div style={STACK}>
        <SearchInput value={md} onValueChange={setMd} placeholder="Search settings" />
        <SearchInput size="sm" value={sm} onValueChange={setSm} placeholder="Search settings" />
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => <SearchInput value="" onValueChange={() => {}} disabled placeholder="Search settings" />,
};

/** Escape clears the field without blurring — the expected filter gesture. */
export const FilteringAList: Story = {
  render: () => {
    const [query, setQuery] = useState("");
    const matches = useMemo(() => {
      const needle = query.trim().toLowerCase();
      return needle === "" ? INSTRUMENTS : INSTRUMENTS.filter((n) => n.toLowerCase().includes(needle));
    }, [query]);

    return (
      <div style={STACK}>
        <SearchInput value={query} onValueChange={setQuery} clearOnEscape placeholder="Search instruments" />
        <div style={RESULTS}>
          {matches.map((name) => (
            <ListRow key={name}>{name}</ListRow>
          ))}
          {matches.length === 0 && <p style={EMPTY}>No instruments match “{query}”.</p>}
        </div>
      </div>
    );
  },
};

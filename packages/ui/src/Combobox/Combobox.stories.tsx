import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FileMusic, FolderGit2 } from "lucide-react";
import { Combobox } from "./Combobox";
import styles from "./Combobox.module.css";

const OPTIONS = [
  { id: "quartet", label: "orchestra/string-quartet", icon: <FileMusic size={14} />, trailingLabel: "Private" },
  { id: "suite", label: "orchestra/concert-suite", icon: <FolderGit2 size={14} />, trailingLabel: "Public" },
  { id: "sketches", label: "composer/sketches", icon: <FileMusic size={14} />, trailingLabel: "Private" },
];

const meta: Meta<typeof Combobox> = {
  title: "UI Components/Combobox",
  component: Combobox,
  parameters: { layout: "centered", surface: "modal" },
};

export default meta;
type Story = StoryObj<typeof Combobox>;

export const Searchable: Story = {
  render: () => {
    const [value, setValue] = useState("");
    return (
      <div className={styles.storyFrame}>
        <Combobox
          value={value}
          options={OPTIONS}
          onValueChange={setValue}
          ariaLabel="Project repository"
          placeholder="Search repositories"
        />
      </div>
    );
  },
};

export const Loading: Story = {
  args: {
    value: "",
    options: [],
    onValueChange: () => {},
    ariaLabel: "Project repository",
    placeholder: "Search repositories",
    loading: true,
    loadingMessage: "Loading repositories",
  },
};

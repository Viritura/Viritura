import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, type ButtonProps } from "./Button";

const BUTTON_ROW_STYLE: CSSProperties = { display: "flex", gap: 4, alignItems: "center" };

const GALLERY_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto repeat(3, auto)",
  rowGap: 12,
  columnGap: 16,
  alignItems: "center",
};

const GALLERY_LABEL_STYLE: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  color: "var(--text-muted)",
};

const GALLERY_HEADER_STYLE: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 10,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const SIZES_ROW_STYLE: CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
const PADDED_RAIL_STYLE: CSSProperties = {
  width: 240,
  paddingInline: "var(--space-2)",
  border: "1px solid var(--border)",
};

const GUIDELINES_ROOT_STYLE: CSSProperties = {
  maxWidth: 720,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text)",
};

const GUIDELINES_TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 8,
  fontSize: 12,
};

const GUIDELINES_TH_STYLE: CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: "1px solid var(--border)",
  fontWeight: 600,
  color: "var(--text-bright)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const GUIDELINES_TD_STYLE: CSSProperties = {
  padding: "10px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

const GUIDELINES_RULE_STYLE: CSSProperties = {
  marginTop: 24,
  padding: 14,
  borderRadius: 8,
  background: "rgba(var(--accent-rgb), 0.06)",
  border: "1px solid rgba(var(--accent-rgb), 0.25)",
  fontSize: 12,
};

const GUIDELINES_HEADING_STYLE: CSSProperties = { marginTop: 0, fontSize: 18, fontWeight: 600 };
const GUIDELINES_LEDE_STYLE: CSSProperties = { color: "var(--text-muted)", marginTop: 0 };
const GUIDELINES_TD_MUTED_STYLE: CSSProperties = {
  ...GUIDELINES_TD_STYLE,
  color: "var(--text-muted)",
};
const GUIDELINES_RULE_LIST_STYLE: CSSProperties = {
  marginTop: 8,
  marginBottom: 0,
  paddingLeft: 18,
};
const GALLERY_GROUP_STYLE: CSSProperties = { display: "contents" };

const VARIANT_GUIDELINES: ReadonlyArray<{
  variant: NonNullable<ButtonProps["variant"]>;
  use: string;
  avoid: string;
  example: string;
}> = [
  {
    variant: "default",
    use: "Everyday actions in toolbars, inspectors, and panels. The neutral baseline — pick this unless a stronger reason demands otherwise.",
    avoid: "Primary dialog confirmation (use primary), destructive actions (use danger).",
    example: 'Toolbar mode toggles, "Apply", "Cancel" in inline panels.',
  },
  {
    variant: "ghost",
    use: "Inside dense surfaces where chrome would compete with content — toolbars-within-toolbars, row hover actions, popover footers.",
    avoid: "Standalone calls-to-action. With no resting border the affordance is too quiet for primary tasks.",
    example: "Inline row icon-actions, toolbar grouping.",
  },
  {
    variant: "primary",
    use: "Exactly one per surface — the single most important action. Solid viridian fill draws the eye first.",
    avoid: "Multiple primaries on the same screen, destructive confirmations, frequent toolbar actions.",
    example: '"Open folder…", "Sign in", banner CTAs, dialog confirm.',
  },
  {
    variant: "cta",
    use: "A text-led activation action in onboarding or an empty state, supported by nearby explanatory copy.",
    avoid: "Routine confirmations, dense toolbars, or a leading icon that merely repeats the label.",
    example: '"Create project" in a first-run workspace.',
  },
  {
    variant: "link",
    use: "Inline secondary navigation that doesn't deserve a button affordance. Reads as text.",
    avoid: "Anything that changes state on the current page (use ghost or default instead).",
    example: '"Don\'t show again", "Learn more", footer text-links.',
  },
  {
    variant: "link-row",
    use: "Full-width tertiary navigation where the content should read as a link but keyboard focus must span the containing row.",
    avoid: "Inline prose links (use link), row actions that need a resting button affordance (use ghost).",
    example: '"Open standalone file" below a primary action stack.',
  },
  {
    variant: "utility-row",
    use: "Full-width neutral utilities and disclosures in padded rails, including account menus and secondary settings rows.",
    avoid: "Navigation that should read as a link (use link-row), primary actions, or dense toolbar icons.",
    example: '"Account", "Preferences", and similar footer utilities.',
  },
  {
    variant: "danger",
    use: "Destructive actions that delete data, remove items, or are otherwise irreversible. Always paired with text — never a bare icon.",
    avoid: "Reversible cancel/dismiss actions (use default).",
    example: '"Remove instrument", "Delete part", "Discard changes".',
  },
];

const VARIANTS: ReadonlyArray<{ variant: NonNullable<ButtonProps["variant"]>; label: string }> = [
  { variant: "default", label: "Default" },
  { variant: "ghost", label: "Ghost" },
  { variant: "primary", label: "Open folder…" },
  { variant: "cta", label: "Create project" },
  { variant: "link", label: "Don’t show again" },
  { variant: "link-row", label: "Open standalone file" },
  { variant: "utility-row", label: "Account" },
  { variant: "danger", label: "Remove" },
];

const meta: Meta<typeof Button> = {
  title: "UI Components/Button",
  component: Button,
  parameters: { layout: "centered" },
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
    variant: {
      control: "select",
      options: ["default", "ghost", "primary", "cta", "link", "link-row", "utility-row", "danger"],
    },
    active: { control: "boolean" },
    disabled: { control: "boolean" },
    useBravura: { control: "boolean" },
    fullWidth: { control: "boolean" },
    bleedInline: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const LinkRowInPaddedRail: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={PADDED_RAIL_STYLE}>
      <Button variant="link-row" size="sm" bleedInline>
        Open standalone file
      </Button>
    </div>
  ),
};

export const UtilityRowsInPaddedRail: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={PADDED_RAIL_STYLE}>
      <Button variant="utility-row" size="sm" bleedInline>
        Account
      </Button>
      <Button variant="link-row" size="sm" bleedInline>
        Open standalone file
      </Button>
    </div>
  ),
};

export const Guidelines: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={GUIDELINES_ROOT_STYLE}>
      <h2 style={GUIDELINES_HEADING_STYLE}>When to use which variant</h2>
      <p style={GUIDELINES_LEDE_STYLE}>
        Pick the lowest-emphasis variant that still communicates the action&rsquo;s importance. The default variant
        covers the vast majority of cases; the rest exist for specific signal.
      </p>
      <table style={GUIDELINES_TABLE_STYLE}>
        <thead>
          <tr>
            <th style={GUIDELINES_TH_STYLE}>Variant</th>
            <th style={GUIDELINES_TH_STYLE}>Use for</th>
            <th style={GUIDELINES_TH_STYLE}>Avoid</th>
            <th style={GUIDELINES_TH_STYLE}>Example</th>
          </tr>
        </thead>
        <tbody>
          {VARIANT_GUIDELINES.map(({ variant, use, avoid, example }) => (
            <tr key={variant}>
              <td style={GUIDELINES_TD_STYLE}>
                <Button variant={variant} label={variant} />
              </td>
              <td style={GUIDELINES_TD_STYLE}>{use}</td>
              <td style={GUIDELINES_TD_MUTED_STYLE}>{avoid}</td>
              <td style={GUIDELINES_TD_MUTED_STYLE}>{example}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={GUIDELINES_RULE_STYLE}>
        <strong>House rules</strong>
        <ul style={GUIDELINES_RULE_LIST_STYLE}>
          <li>
            <strong>One primary per surface.</strong> Two primaries split the user&rsquo;s attention and erase the
            meaning of the variant.
          </li>
          <li>
            <strong>CTA stays text-led.</strong> Use an icon only when it adds information the action label cannot
            carry.
          </li>
          <li>
            <strong>Active state communicates a toggle, not a state of being.</strong> Use <code>active</code> only for
            buttons that meaningfully alternate (note input on/off, voice 1/2/3/4); never as a &ldquo;I&rsquo;m
            currently highlighted&rdquo; decoration.
          </li>
          <li>
            <strong>Size convention.</strong> <code>md</code> is the default. <code>sm</code> is reserved for
            badge-adjacent toolbars and dense inspectors. <code>lg</code> is reserved for unusually spacious actions;
            the <code>cta</code> variant already owns its activation sizing.
          </li>
          <li>
            <strong>Danger is always labeled.</strong> Never use a bare icon for destructive actions — pair red with an
            explicit verb so the action is impossible to misread.
          </li>
          <li>
            <strong>Bravura font is opt-in.</strong> Use <code>useBravura</code> only when the label is a SMuFL glyph
            (durations, accidentals, articulation). For text labels with adjacent glyphs, render the glyph as a sibling
            element.
          </li>
        </ul>
      </div>
    </div>
  ),
};

export const Playground: Story = {
  args: { label: "Click me", tooltip: "A button" },
};

export const AllVariants: Story = {
  parameters: { layout: "padded" },
  render: () => (
    <div style={GALLERY_STYLE}>
      <div />
      <div style={GALLERY_HEADER_STYLE}>idle</div>
      <div style={GALLERY_HEADER_STYLE}>active</div>
      <div style={GALLERY_HEADER_STYLE}>disabled</div>
      {VARIANTS.map(({ variant, label }) => (
        <div key={variant} style={GALLERY_GROUP_STYLE}>
          <code style={GALLERY_LABEL_STYLE}>{variant}</code>
          <Button variant={variant} label={label} />
          <Button variant={variant} label={label} active />
          <Button variant={variant} label={label} disabled />
        </div>
      ))}
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div style={SIZES_ROW_STYLE}>
      <Button label="Small" size="sm" />
      <Button label="Medium" size="md" />
      <Button label="Large" size="lg" />
    </div>
  ),
};

export const ButtonRow: Story = {
  render: () => (
    <div style={BUTTON_ROW_STYLE}>
      <Button label="N" tooltip="Note input" active activeColor="#0e639c" />
      <Button label={String.fromCodePoint(0xeca5)} useBravura tooltip="Quarter" active />
      <Button label={String.fromCodePoint(0xeca7)} useBravura tooltip="Eighth" />
      <Button label={String.fromCodePoint(0xeca9)} useBravura tooltip="16th" />
      <Button label="1" tooltip="Voice 1" active activeColor="#1565C0" />
      <Button label="2" tooltip="Voice 2" />
      <Button label="3" tooltip="Voice 3" />
      <Button label="4" tooltip="Voice 4" />
    </div>
  ),
};

export const BravuraGlyph: Story = {
  args: { label: String.fromCodePoint(0xeca5), useBravura: true, tooltip: "Quarter note" },
};

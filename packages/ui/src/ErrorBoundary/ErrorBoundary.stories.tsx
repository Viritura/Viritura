import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary";

const CUSTOM_FALLBACK_STYLE: CSSProperties = { padding: "1rem", border: "2px dashed red", borderRadius: 8 };

function BuggyChild() {
  throw new Error("Something went wrong while rendering!");
  return null;
}

const meta: Meta<ErrorBoundaryProps> = {
  title: "UI Components/ErrorBoundary",
  component: ErrorBoundary as unknown as React.ComponentType<ErrorBoundaryProps>,
  // ErrorBoundary owns its full-viewport error state — it isn't a
  // panel inhabitant, so render on the raw canvas.
  parameters: { layout: "centered", surface: "canvas" },
};

export default meta;
type Story = StoryObj<ErrorBoundaryProps>;

export const DefaultFallback: Story = {
  render: () => (
    <ErrorBoundary>
      <BuggyChild />
    </ErrorBoundary>
  ),
};

export const WithGitHubReport: Story = {
  render: () => (
    <ErrorBoundary reportUrl="https://github.com/peteryangio/viritura/issues/new">
      <BuggyChild />
    </ErrorBoundary>
  ),
};

export const CustomFallback: Story = {
  render: () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div style={CUSTOM_FALLBACK_STYLE}>
          <p>
            <strong>Custom fallback:</strong> {error.message}
          </p>
          <button onClick={reset}>Reset</button>
        </div>
      )}
    >
      <BuggyChild />
    </ErrorBoundary>
  ),
};

export const NoError: Story = {
  render: () => (
    <ErrorBoundary>
      <p>Everything is fine — no error here.</p>
    </ErrorBoundary>
  ),
};

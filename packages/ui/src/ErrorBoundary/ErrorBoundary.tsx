import { Component, type ErrorInfo, type ReactNode } from "react";
import { DefaultErrorFallback } from "./DefaultErrorFallback";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback to render when an error occurs */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** When this value changes, the error state is automatically cleared */
  resetKey?: string | number;
  /** Repository `.../issues/new` URL. When set, the default fallback shows a
   *  "Report on GitHub" link that opens a prefilled issue with debug info. */
  reportUrl?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** React component stack captured in `componentDidCatch`, surfaced in the
   *  default fallback's debug report. */
  componentStack: string | null;
}

/**
 * React Error Boundary — catches render-time errors (including WASM panics)
 * and displays an error message instead of crashing the entire page.
 * Automatically resets when `resetKey` changes.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState & { prevResetKey?: string | number },
  ): Partial<ErrorBoundaryState & { prevResetKey?: string | number }> | null {
    // Auto-reset when resetKey changes
    if (props.resetKey !== undefined && props.resetKey !== state.prevResetKey) {
      return { error: null, componentStack: null, prevResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <DefaultErrorFallback
          error={this.state.error}
          componentStack={this.state.componentStack}
          reset={this.reset}
          reportUrl={this.props.reportUrl}
        />
      );
    }
    return this.props.children;
  }
}
